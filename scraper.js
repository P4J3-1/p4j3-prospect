const { chromium } = require('playwright');
const CONFIG = require('./config');
const { extractBusinessData } = require('./utils/businessData');
const { geocodeAddress, isValidCoord } = require('./utils/geocode');
const { normalizeAddress } = require('./utils/address-normalizer');
const { normalizeText } = require('./utils/text-normalizer');
const {
  normalizeInstagram,
  normalizeLeadLinks,
  normalizePhoneDisplay,
  isSocialUrl,
  isAggregatorUrl,
} = require('./utils/lead-links');

function normalizePlaceText(place = {}) {
  const links = normalizeLeadLinks(place);
  return {
    ...place,
    name: normalizeText(place.name),
    category: normalizeText(place.category),
    description: normalizeText(place.description),
    openingHours: normalizeText(place.openingHours),
    address: normalizeAddress(place.address),
    phone: normalizePhoneDisplay(place.phone) || normalizeText(place.phone),
    website: links.website,
    instagram: links.instagram,
  };
}

/** Identificador estável do lugar no Google Maps (vem no link do resultado). */
function placeIdFromUrl(url) {
  const match = String(url || '').match(/!1s(0x[0-9a-f]+:0x[0-9a-f]+)/i);
  return match ? match[1].toLowerCase() : '';
}

/** Chave de nome para pular empresas já na base (redes/filiais contam como a mesma). */
function nameKey(name) {
  return String(name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Atributo de um resultado da lista; vazio se não der para ler. */
async function readAttr(el, name) {
  try {
    return (await el?.getAttribute?.(name)) || '';
  } catch {
    return '';
  }
}

function checkCancelled(cancelToken) {
  if (cancelToken?.cancelled) {
    const err = new Error('Scrape cancelled');
    err.code = 'SCRAPE_CANCELLED';
    throw err;
  }
}

function describeExtractedPlace(place, current, total) {
  const details = [];
  if (place.phone) details.push('telefone');
  if (place.website) details.push('site');
  if (place.instagram) details.push('Instagram');
  if (place.email) details.push('e-mail');
  const rating = Number(place.rating);
  const ratingText = Number.isFinite(rating) && rating > 0
    ? ` · nota ${String(place.rating).replace('.', ',')}`
    : '';
  const detailsText = details.length ? ` · ${details.join(', ')} encontrado${details.length > 1 ? 's' : ''}` : '';
  return `Empresa ${current} de ${total} extraída: ${place.name}${ratingText}${detailsText}.`;
}

/**
 * @param {object} [options]
 * @param {Set<string>} [options.skipKeys] placeIds e chaves de nome já conhecidos: pulados sem abrir.
 * @param {number} [options.maxNew] para ao atingir este número de empresas novas.
 * @param {{lat:number,lng:number}} [options.coords] busca centrada neste ponto do mapa.
 */
async function scrapeGoogleMaps(searchQuery, maxResults = 999, onProgress = console.log, cancelToken = null, options = {}) {
  const skipKeys = options.skipKeys instanceof Set ? options.skipKeys : new Set();
  const maxNew = Number(options.maxNew) > 0 ? Number(options.maxNew) : Infinity;
  let skippedKnown = 0;
  // O Maps repete a mesma empresa (anúncio + resultado orgânico): abre só uma vez.
  const seenInRun = new Set();
  onProgress('Abrindo o navegador para a extração…');
  let browser;
  const launchAttempts = [
    { headless: CONFIG.HEADLESS, channel: 'chrome' },
    { headless: CONFIG.HEADLESS },
  ];
  let launchError;
  for (const opts of launchAttempts) {
    try {
      browser = await chromium.launch(opts);
      break;
    } catch (e) {
      launchError = e;
      onProgress(`Não foi possível abrir o navegador (${opts.channel || 'integrado'}): ${e.message}`);
    }
  }
  if (!browser) {
    throw new Error(`Falha ao abrir navegador. Verifique se o Chrome está instalado. Detalhes: ${launchError?.message || 'unknown'}`);
  }
  const places = [];
  const statistics = { withPhone: 0, withWebsite: 0, withInstagram: 0, withEmail: 0, withRating: 0, withPhotos: 0 };
  let context;
  let page;
  const emailTasks = new Set();
  let emailCancelled = null;
  let emitted = 0;
  let closed = false;

  try {
    checkCancelled(cancelToken);
    context = await browser.newContext({
      userAgent: CONFIG.USER_AGENT,
      viewport: { width: 1366, height: 768 }
    });
    page = await context.newPage();

    if (CONFIG.REQUEST_BLOCK_TYPES.length > 0) {
      await page.route('**/*', (route) => {
        const type = route.request().resourceType();
        if (CONFIG.REQUEST_BLOCK_TYPES.includes(type)) {
          route.abort();
        } else {
          route.continue();
        }
      });
    }

    const encodedQuery = encodeURIComponent(searchQuery);
    const at = options.coords && Number.isFinite(options.coords.lat) && Number.isFinite(options.coords.lng)
      ? `/@${options.coords.lat},${options.coords.lng},14z`
      : '';
    checkCancelled(cancelToken);
    await gotoWithRetry(page, `https://www.google.com/maps/search/${encodedQuery}${at}`, onProgress);
    await page.waitForTimeout(CONFIG.INITIAL_WAIT);
    checkCancelled(cancelToken);

    try {
      const btn = page.locator('button:has-text("Accept all"), button:has-text("Aceitar todos")').first();
      if (await btn.isVisible({ timeout: 3000 })) { await btn.click(); await page.waitForTimeout(800); }
    } catch (e) {}

    try { await page.waitForSelector('div[role="feed"]', { timeout: 15000 }); }
    catch (e) { onProgress('Nenhum resultado foi encontrado no Google Maps.'); await browser.close(); return { success: false, error: 'Nenhum resultado encontrado.', data: [], count: 0, statistics }; }

    onProgress('Carregando os resultados encontrados…');
    let prev = 0, stuck = 0;
    while (stuck < CONFIG.SEARCH_DEPTH) {
      checkCancelled(cancelToken);
      await page.evaluate(() => { const f = document.querySelector('div[role="feed"]'); if (f) f.scrollTop = f.scrollHeight; });
      await page.waitForTimeout(CONFIG.SCROLL_DELAY);
      const count = await page.locator('a[href*="/maps/place/"]').count();
      onProgress({
        type: 'listing-count',
        found: count,
        message: `${count} empresa${count === 1 ? '' : 's'} encontrada${count === 1 ? '' : 's'} na lista do Google Maps.`,
      });
      if (count === prev) stuck++; else stuck = 0;
      prev = count;
      if (count >= maxResults) break;
    }

    const listings = await page.locator('a[href*="/maps/place/"]').all();
    const total = Math.min(listings.length, maxResults);
    onProgress(`Iniciando a extração de ${total} empresa${total === 1 ? '' : 's'}…`);

    for (let i = 0; i < total; i++) {
      if (places.length >= maxNew) {
        onProgress(`Meta de novos atingida nesta busca (${places.length}).`);
        break;
      }
      try {
        checkCancelled(cancelToken);
        // Já na base (ou já contatado): pula sem abrir, o que economiza tempo e resultados.
        const listingPid = placeIdFromUrl(await readAttr(listings[i], 'href'));
        if (listingPid) {
          if (seenInRun.has(listingPid)) continue;
          seenInRun.add(listingPid);
        }
        if (skipKeys.size) {
          const label = await readAttr(listings[i], 'aria-label');
          const pid = listingPid;
          if ((pid && skipKeys.has(`pid:${pid}`)) || (label && skipKeys.has(`name:${nameKey(label)}`))) {
            skippedKnown += 1;
            onProgress({ type: 'skipped-known', current: i + 1, total, found: places.length, message: `${label || 'Empresa'} já está na sua base; pulando.` });
            continue;
          }
        }
        await listings[i].click();
        try { await page.waitForSelector('h1.DUwDvf', { timeout: 3000 }); } catch {}
        await page.waitForTimeout(500);
        for (let attempt = 0; attempt < 4; attempt++) {
          const hasPoi = await page.evaluate(() => document.documentElement.innerHTML.includes('!3d-') || document.documentElement.innerHTML.includes('!3d')).catch(() => false);
          if (hasPoi) break;
          await page.waitForTimeout(400);
        }
        checkCancelled(cancelToken);

        let place = normalizePlaceText(await extractBusinessData(page));
        place.placeId = placeIdFromUrl(place.googleMapsUrl) || placeIdFromUrl(await readAttr(listings[i], 'href'));
        if (!place.latitude || place.coordSource === 'none') {
          await page.waitForTimeout(700);
          const retry = { ...normalizePlaceText(await extractBusinessData(page)), placeId: place.placeId };
          if (retry.latitude && retry.coordSource !== 'none') place = retry;
        }

        if (place.placeId && places.some((p) => p.placeId === place.placeId)) continue;
        if (place.name) {
          const lat = parseFloat(place.latitude);
          const lng = parseFloat(place.longitude);
          const hasPreciseCoord = isValidCoord(lat, lng) && (place.coordSource === 'poi' || place.coordSource === 'meta');
          const needsGeocode = !hasPreciseCoord && place.address && place.address.length > 5;
          if (needsGeocode) {
            try {
              checkCancelled(cancelToken);
              const geo = await geocodeAddress(place.address, searchQuery);
              if (geo && isValidCoord(geo.lat, geo.lng)) {
                place.latitude = geo.lat;
                place.longitude = geo.lng;
                place.geocodeConfidence = geo.confidence;
                place.geocodeSource = geo.source;
                place.geocodeDisplayName = geo.displayName;
                place.coordSource = 'nominatim';
              } else if (!isValidCoord(lat, lng)) {
                place.coordSource = 'none';
                place.latitude = '';
                place.longitude = '';
              }
            } catch (err) {
              if (err.code === 'SCRAPE_CANCELLED') throw err;
            }
          }
          // O Instagram já vem do painel do lugar. O fallback fica restrito ao
          // mesmo painel para não herdar a rede social de outro resultado.
          if (!place.instagram) {
            const ig = page.locator('div[role="main"] a[href*="instagram.com"]').first();
            if (await ig.count() > 0) place.instagram = normalizeInstagram(await ig.getAttribute('href'));
          }

          places.push(place);
          const current = i + 1;
          const finishPlace = () => {
            if (closed) return;
            if (place.phone) statistics.withPhone++;
            if (place.website) statistics.withWebsite++;
            if (place.instagram) statistics.withInstagram++;
            if (place.email) statistics.withEmail++;
            if (place.rating) statistics.withRating++;
            if (place.photos?.count > 0) statistics.withPhotos++;
            emitted++;
            onProgress({
              type: 'lead',
              current,
              total,
              found: emitted,
              lead: place,
              message: describeExtractedPlace(place, current, total),
            });
          };

          // E-mail só faz sentido em site próprio: rede social e agregador não
          // expõem contato da empresa de forma confiável. A visita ao site roda
          // em paralelo (pool limitado) para não travar a navegação no Maps.
          place.email = '';
          if (place.website && !isSocialUrl(place.website) && !isAggregatorUrl(place.website)) {
            while (emailTasks.size >= CONFIG.EMAIL_CONCURRENCY) await Promise.race(emailTasks);
            checkCancelled(cancelToken);
            const task = scrapeEmails(browser, place.website, onProgress, cancelToken)
              .then((email) => { place.email = email; finishPlace(); })
              .catch((err) => { if (err.code === 'SCRAPE_CANCELLED') emailCancelled = err; else finishPlace(); })
              .finally(() => emailTasks.delete(task));
            emailTasks.add(task);
          } else {
            finishPlace();
          }
        }
      } catch (err) {
        if (err.code === 'SCRAPE_CANCELLED') throw err;
        console.warn(`[scraper] empresa ${i + 1}/${total} ignorada:`, err.message);
        onProgress({
          type: 'skipped',
          current: i + 1,
          total,
          found: emitted,
          message: `Empresa ${i + 1} de ${total} ignorada por dados incompletos.`,
        });
      }
    }
    await Promise.all(emailTasks);
    if (emailCancelled) throw emailCancelled;
    await page.close();
    await context.close();
  } catch (e) {
    if (e.code === 'SCRAPE_CANCELLED') {
      onProgress('Extração cancelada.');
      throw e;
    }
    onProgress(`Erro durante a extração: ${e.message}`);
    await Promise.all(emailTasks);
    if (places.length === 0) {
      return { success: false, error: e.message, data: [], count: 0, statistics };
    }
    statistics.total = places.length;
    return { success: true, partial: true, warnings: [e.message], data: places, count: places.length, statistics };
  } finally {
    closed = true;
    await page?.close?.().catch(() => {});
    await context?.close?.().catch(() => {});
    await browser.close().catch(() => {});
  }

  onProgress(`Extração concluída: ${places.length} empresa${places.length === 1 ? '' : 's'} extraída${places.length === 1 ? '' : 's'}.`);
  statistics.total = places.length;
  statistics.skippedKnown = skippedKnown;
  return { success: true, data: places, count: places.length, statistics };
}

async function gotoWithRetry(page, url, onProgress) {
  for (let attempt = 1; attempt <= CONFIG.MAX_RETRIES; attempt++) {
    try {
      await page.goto(url, { timeout: CONFIG.PAGE_TIMEOUT, waitUntil: 'load' });
      return;
    } catch (e) {
      if (attempt === CONFIG.MAX_RETRIES) throw e;
      const delay = 2000 * Math.pow(2, attempt - 1);
      onProgress(`Nova tentativa ${attempt} de ${CONFIG.MAX_RETRIES - 1} em ${Math.round(delay / 1000)} s…`);
      await page.waitForTimeout(delay);
    }
  }
}

async function scrapeEmails(browser, url, onProgress, cancelToken = null) {
  const page = await browser.newPage();
  try {
    checkCancelled(cancelToken);
    await page.goto(url, { timeout: CONFIG.EMAIL_TIMEOUT, waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    checkCancelled(cancelToken);

    const emails = await page.evaluate(() => {
      const found = new Set();
      document.querySelectorAll('a[href^="mailto:"]').forEach(a => {
        const em = a.getAttribute('href').replace('mailto:', '').split('?')[0].trim();
        if (em.includes('@')) found.add(em.toLowerCase());
      });
      const text = document.body.innerText;
      const regex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
      let m;
      while ((m = regex.exec(text)) !== null) {
        const em = m[0].toLowerCase();
        if (!em.endsWith('.png') && !em.endsWith('.jpg') && !em.includes('example.com')) found.add(em);
      }
      return [...found].slice(0, 5);
    });

    await page.close();
    return emails.join(', ');
  } catch (e) {
    await page.close().catch(() => {});
    if (e.code === 'SCRAPE_CANCELLED') throw e;
    return '';
  }
}

module.exports = { scrapeGoogleMaps, placeIdFromUrl, nameKey };
