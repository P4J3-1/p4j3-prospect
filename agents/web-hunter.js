/**
 * Agente Radar Web: caça negócios com presença fraca fora do Google Maps.
 *
 * 1) procura na web empresas do nicho + cidade (sem diretórios e redes);
 * 2) abre cada site num Chrome invisível, em tamanho de celular, e mede o
 *    que o cliente dele sente: fora do ar, lento, sem HTTPS, sem versão de
 *    celular, sem WhatsApp, rodapé desatualizado;
 * 3) tira do site telefone, WhatsApp, Instagram e e-mail;
 * 4) devolve só quem tem problema, com o diagnóstico pronto.
 */
const { hostOf, isSocialUrl, isAggregatorUrl, normalizeInstagram } = require("../utils/lead-links");

// Diretórios, marketplaces e portais: listam empresas, mas não são a empresa.
const DIRECTORY_HOSTS = [
  "guiatelefone.com", "eguias.net", "applocal.com.br", "paginaamarela.com.br", "telelistas.net", "apontador.com.br",
  "doctoralia.com.br", "trinks.com", "booksy.com", "getninjas.com.br", "habitissimo.com.br", "reclameaqui.com.br",
  "tripadvisor.com.br", "tripadvisor.com", "ifood.com.br", "mercadolivre.com.br", "olx.com.br", "yelp.com",
  "wikipedia.org", "jusbrasil.com.br", "cnpj.biz", "econodata.com.br", "casadosdados.com.br", "solutudo.com.br",
  "cylex.com.br", "hotfrog.com.br", "infobel.com", "brasilcnpj.net", "empresaqui.com.br", "google.com", "maps.app.goo.gl",
  "boaconsulta.com", "zenklub.com.br", "psicologiaviva.com.br", "portaldovetor.com.br", "gympass.com", "wellhub.com",
];

function isDirectoryUrl(url) {
  const host = hostOf(url);
  if (!host) return false;
  if (DIRECTORY_HOSTS.some((d) => host === d || host.endsWith(`.${d}`))) return true;
  // Governo/educação e portais de listagem pelo nome do domínio.
  if (/\.(gov|jus|leg|mil|edu)\.br$/.test(host)) return true;
  return /(guia|negocios|locais|empresas|catalogo|diretorio|listagem|agende-?me|classificados)/.test(host.split(".")[0] + "." + (host.split(".")[1] || ""));
}

/** Resultados de busca → sites próprios de empresas, 1 por domínio. */
function pickCompanySites(results, knownHosts = new Set()) {
  const seen = new Set();
  const out = [];
  for (const r of results || []) {
    const host = hostOf(r?.url);
    if (!host || seen.has(host) || knownHosts.has(host)) continue;
    if (isSocialUrl(r.url) || isAggregatorUrl(r.url) || isDirectoryUrl(r.url)) continue;
    // Listas "10 melhores…" e matérias não são empresa.
    if (/\b(\d+\s+melhores|top\s*\d+|ranking|lista de)\b/i.test(r.title || "")) continue;
    seen.add(host);
    out.push({ url: r.url, host, title: r.title || "", snippet: r.snippet || "" });
  }
  return out;
}

const PHONE_RE = /(?:\+?55\s?)?\(?([1-9]\d)\)?\s?(9?\d{4})[-\s.]?(\d{4})\b/g;

function phonesIn(text) {
  const found = [];
  for (const m of String(text || "").matchAll(PHONE_RE)) {
    const digits = `${m[1]}${m[2]}${m[3]}`;
    if (digits.length >= 10 && !found.includes(digits)) found.push(digits);
  }
  return found;
}

/** Nome da empresa a partir do título da página ("Nome | Slogan" → "Nome"). */
function companyName(title, host) {
  const generic = /^(in[ií]cio|inicial|p[aá]gina inicial|home|home page|bem[- ]vindo[as]?|site|welcome)$/i;
  const parts = String(title || "").split(/\s[|\-–—:·]\s/).map((p) => p.trim()).filter((p) => p && !generic.test(p));
  const first = parts[0] || "";
  if (first.length >= 3 && first.length <= 70) return first;
  const base = String(host || "").replace(/^www\./, "").split(".")[0].replace(/[-_]/g, " ");
  return base.replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Diagnóstico a partir do que a página mostrou (função pura, testável).
 * @returns {{ issues: string[], score: number, weak: boolean }}
 */
function diagnose(audit) {
  const issues = [];
  if (!audit.ok) issues.push(audit.status ? `Site com erro (${audit.status})` : "Site fora do ar");
  else {
    if (!audit.https) issues.push("Sem HTTPS: o navegador mostra \"não seguro\"");
    if (audit.loadMs > 4000) issues.push(`Lento: ${Math.round(audit.loadMs / 100) / 10}s para abrir no celular`);
    if (!audit.viewport) issues.push("Não se adapta ao celular");
    if (!audit.whatsapp) issues.push("Sem botão de WhatsApp");
    if (!audit.title || audit.title.length < 10) issues.push("Sem título para o Google");
    if (!audit.description) issues.push("Sem descrição para o Google");
    if (audit.year && audit.year < new Date().getFullYear() - 2) issues.push(`Rodapé parado em ${audit.year}`);
    if (audit.textLength < 400) issues.push("Pouco conteúdo na página");
  }
  // Pesos: fora do ar e celular pesam mais.
  const weight = (i) => (/fora do ar|erro/i.test(i) ? 40 : /celular|Lento|HTTPS/.test(i) ? 20 : 10);
  const score = Math.min(100, issues.reduce((sum, i) => sum + weight(i), 0));
  return { issues, score, weak: score >= 30 };
}

/** Abre o site em tamanho de celular e coleta os sinais. */
async function auditSite(browser, url, { timeoutMs = 20000 } = {}) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36",
    locale: "pt-BR",
  });
  const page = await context.newPage();
  const started = Date.now();
  const audit = { url, ok: false, status: 0, https: /^https:/i.test(url), loadMs: 0 };
  try {
    const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    audit.loadMs = Date.now() - started;
    audit.status = res?.status() || 0;
    audit.ok = !!res && audit.status < 400;
    audit.finalUrl = page.url();
    audit.https = /^https:/i.test(audit.finalUrl);
    if (audit.ok) {
      await page.waitForTimeout(1200);
      Object.assign(audit, await page.evaluate(() => {
        const q = (s) => document.querySelector(s);
        const hrefs = [...document.querySelectorAll("a[href]")].map((a) => a.getAttribute("href") || "");
        const text = document.body?.innerText || "";
        const years = [...text.matchAll(/(?:©|copyright|todos os direitos)[^\n]{0,40}?(20\d{2})/gi)].map((m) => Number(m[1]));
        return {
          title: (q("meta[property='og:site_name']")?.content || document.title || "").trim().slice(0, 120),
          description: (q("meta[name='description']")?.content || "").trim().slice(0, 300),
          viewport: !!q("meta[name='viewport']"),
          whatsapp: hrefs.some((h) => /wa\.me|api\.whatsapp|whatsapp\.com\/send/i.test(h)),
          tel: hrefs.filter((h) => /^tel:/i.test(h)).map((h) => h.replace(/^tel:/i, "")).slice(0, 3),
          wa: hrefs.filter((h) => /wa\.me\/\d|phone=\d/i.test(h)).slice(0, 3),
          instagram: hrefs.find((h) => /instagram\.com\/[A-Za-z0-9_.]+/i.test(h)) || "",
          emails: [...new Set((text.match(/[\w.+-]+@[\w-]+\.[\w.]+/g) || []).slice(0, 3))],
          year: years.length ? Math.max(...years) : 0,
          textLength: text.length,
          // Começo e rodapé: o telefone quase sempre está no fim da página.
          sample: text.length > 7000 ? `${text.slice(0, 4000)}\n${text.slice(-3000)}` : text,
        };
      }));
    }
  } catch (error) {
    audit.error = String(error?.message || error).slice(0, 160);
    audit.loadMs = Date.now() - started;
  } finally {
    await context.close().catch(() => {});
  }
  return audit;
}

/** Melhor telefone do site: link de WhatsApp > tel: > texto. */
function bestPhone(audit) {
  for (const w of audit.wa || []) {
    const m = String(w).match(/(?:wa\.me\/|phone=)(\d{10,13})/);
    if (m) return m[1];
  }
  for (const t of audit.tel || []) {
    const d = String(t).replace(/\D/g, "");
    if (d.length >= 10) return d;
  }
  return phonesIn(audit.sample)[0] || "";
}

/** Site auditado → lead para a base. */
function toLead(site, audit, diagnosis, { niche, city }) {
  const phone = bestPhone(audit);
  return {
    name: companyName(audit.title || site.title, site.host),
    category: niche,
    city,
    address: "",
    phone: phone ? `+55 ${phone.replace(/^55/, "")}` : "",
    website: audit.finalUrl || site.url,
    instagram: audit.instagram ? normalizeInstagram(audit.instagram) : "",
    email: (audit.emails || [])[0] || "",
    source: "radar-web",
    webAudit: {
      at: Date.now(),
      score: diagnosis.score,
      issues: diagnosis.issues,
      loadMs: audit.loadMs,
      https: audit.https,
      mobile: audit.viewport,
      whatsapp: audit.whatsapp,
    },
  };
}

/**
 * Uma rodada do Radar: busca, audita e devolve os leads fracos.
 * @param {{ niche:string, city:string, neighborhoods?:string[] }} mission
 * @param {{ search:Function, launchBrowser:Function, knownHosts?:Set, knownPhones?:Set, phoneKey:Function, maxSites?:number, onProgress?:Function }} deps
 */
async function runRadar(mission, deps) {
  const { search, launchBrowser, knownHosts = new Set(), knownPhones = new Set(), phoneKey, maxSites = 8, onProgress = () => {} } = deps;
  const place = [mission.neighborhoods?.[0], mission.city].filter(Boolean).join(" ");
  const queries = [
    `${mission.niche} ${place}`,
    `${mission.niche} ${mission.city} agendamento`,
    `${mission.niche} ${mission.city} site oficial`,
  ];
  const results = [];
  for (const q of queries) {
    try { results.push(...(await search(q))); } catch { /* busca indisponível */ }
  }
  const sites = pickCompanySites(results, knownHosts).slice(0, maxSites);
  const leads = [];
  const checked = [];
  if (!sites.length) return { leads, checked, searched: results.length };
  const browser = await launchBrowser();
  try {
    for (let i = 0; i < sites.length; i += 1) {
      const site = sites[i];
      onProgress(i, sites.length, `Abrindo ${site.host}`);
      const audit = await auditSite(browser, site.url);
      const diagnosis = diagnose(audit);
      const lead = toLead(site, audit, diagnosis, mission);
      checked.push({ host: site.host, score: diagnosis.score, issues: diagnosis.issues, phone: lead.phone });
      if (!diagnosis.weak || !lead.phone) continue;
      if (knownPhones.has(phoneKey(lead.phone))) continue;
      leads.push(lead);
    }
  } finally {
    await browser.close().catch(() => {});
  }
  return { leads, checked, searched: results.length };
}

module.exports = { DIRECTORY_HOSTS, isDirectoryUrl, pickCompanySites, phonesIn, companyName, diagnose, auditSite, bestPhone, toLead, runRadar };
