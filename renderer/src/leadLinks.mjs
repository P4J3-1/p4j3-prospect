// Espelha utils/lead-links.js do processo principal. O renderer roda em ESM e
// não pode carregar o módulo CommonJS, mas as regras precisam ser as mesmas
// para importação, tela de extração e base de leads.

const TRACKING_PARAMS = new Set([
  'gclid', 'fbclid', 'igsh', 'igshid', 'mstparam', 'utm_source', 'utm_medium',
  'utm_campaign', 'utm_term', 'utm_content', 'utm_id', 'yclid', 'msclkid', 'mc_cid', 'mc_eid',
]);

const GOOGLE_HOST_SUFFIXES = [
  'google.com', 'google.com.br', 'google.co', 'goo.gl', 'g.co',
  'googleusercontent.com', 'gstatic.com', 'withgoogle.com', 'googlesyndication.com',
];

const SOCIAL_HOSTS = [
  'instagram.com', 'instagr.am', 'facebook.com', 'fb.com', 'fb.me', 'youtube.com',
  'youtu.be', 'tiktok.com', 'twitter.com', 'x.com', 'linkedin.com', 'wa.me', 'whatsapp.com',
];

const INSTAGRAM_RESERVED_SEGMENTS = new Set([
  'p', 'reel', 'reels', 'tv', 'stories', 'story', 'explore', 'explorar',
  'accounts', 'direct', 'about', 'invites', 'lite',
]);

// Evita confundir "@cafe.aurora" (handle com ponto) com domínio colado na
// coluna de Instagram.
const COMMON_DOMAIN_SUFFIXES = new Set([
  'com', 'com.br', 'net', 'net.br', 'org', 'org.br', 'io', 'dev', 'app',
  'co', 'br', 'site', 'online', 'store', 'shop', 'me', 'info', 'biz', 'com.mx',
]);

export function looksLikeDomain(value) {
  const parts = String(value || '').toLocaleLowerCase('en-US').split('.').filter(Boolean);
  if (parts.length < 2) return false;
  return COMMON_DOMAIN_SUFFIXES.has(parts[parts.length - 1])
    || COMMON_DOMAIN_SUFFIXES.has(parts.slice(-2).join('.'));
}

export function cleanText(value) {
  return String(value ?? '')
    .normalize('NFC')
    .replace(/[\p{Cc}\p{Cf}\p{Co}\u{FE0E}\u{FE0F}]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function hostOf(value) {
  const raw = cleanText(value).toLocaleLowerCase('en-US');
  if (!raw) return '';
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    return url.hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function matchesHost(host, suffixes) {
  return Boolean(host) && suffixes.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

export function isGoogleOwnedUrl(value) {
  return matchesHost(hostOf(value), GOOGLE_HOST_SUFFIXES);
}

export function isSocialUrl(value) {
  return matchesHost(hostOf(value), SOCIAL_HOSTS);
}

export function isInstagramUrl(value) {
  const host = hostOf(value);
  return host === 'instagram.com' || host.endsWith('.instagram.com') || host === 'instagr.am' || host.endsWith('.instagr.am');
}

function unwrapRedirect(value) {
  const raw = cleanText(value);
  if (!raw) return '';
  if (!isGoogleOwnedUrl(raw)) return raw;
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    const target = url.searchParams.get('q') || url.searchParams.get('url') || '';
    if (target && !isGoogleOwnedUrl(target)) return target;
  } catch {
    return '';
  }
  return '';
}

export function normalizeWebsite(value, options = {}) {
  const raw = unwrapRedirect(value);
  if (!raw) return '';
  let url;
  try {
    url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return '';
  }
  if (!['http:', 'https:'].includes(url.protocol)) return '';
  const host = url.hostname.toLocaleLowerCase('en-US').replace(/^www\./, '');
  if (!host || host === 'localhost' || !host.includes('.')) return '';
  if (isGoogleOwnedUrl(host)) return '';
  if (!options.allowInstagram && isInstagramUrl(host)) return '';
  for (const key of [...url.searchParams.keys()]) {
    const lowered = key.toLocaleLowerCase('en-US');
    if (TRACKING_PARAMS.has(lowered) || lowered.startsWith('utm_')) url.searchParams.delete(key);
  }
  url.hash = '';
  if (!url.searchParams.toString()) url.search = '';
  return url.href;
}

export function extractInstagramHandle(value) {
  const raw = unwrapRedirect(value);
  if (!raw) return '';
  const cleaned = cleanText(raw).replace(/^@+/, '');
  if (!cleaned) return '';
  if (!cleaned.includes('/')) {
    if (looksLikeDomain(cleaned)) return '';
    return /^[a-z0-9._]{1,30}$/i.test(cleaned) ? cleaned : '';
  }
  if (!isInstagramUrl(cleaned)) return '';
  let url;
  try {
    url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(cleaned) ? cleaned : `https://${cleaned}`);
  } catch {
    return '';
  }
  const segments = url.pathname.split('/').map((segment) => segment.trim()).filter(Boolean);
  const first = segments[0] || '';
  if (!first) return '';
  if (INSTAGRAM_RESERVED_SEGMENTS.has(first.toLocaleLowerCase('en-US'))) return '';
  const handle = decodeURIComponent(first).replace(/^@+/, '');
  return /^[a-z0-9._]{1,30}$/i.test(handle) ? handle : '';
}

export function normalizeInstagram(value) {
  const handle = extractInstagramHandle(value);
  return handle ? `@${handle}` : '';
}

export function instagramProfileUrl(value) {
  const handle = extractInstagramHandle(value);
  return handle ? `https://instagram.com/${handle}` : '';
}

/** Instagram nunca fica no campo site e link do Google nunca vira site. */
export function normalizeLeadLinks(raw = {}) {
  let instagram = normalizeInstagram(raw.instagram || raw.ig);
  let website = normalizeWebsite(raw.website || raw.site || raw.url, { allowInstagram: true });
  if (website && isInstagramUrl(website)) {
    if (!instagram) instagram = normalizeInstagram(website);
    website = '';
  }
  return { website, instagram };
}
