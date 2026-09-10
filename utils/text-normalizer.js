/**
 * Repara texto UTF-8 que foi interpretado como Windows-1252/Latin-1 uma ou
 * mais vezes (por exemplo, "ClÃ­nica" -> "Clínica"). A conversão só ocorre
 * quando há uma sequência inequívoca de mojibake; texto válido como
 * "Ângela" permanece intacto.
 */
const MOJIBAKE_SEQUENCE = /(?:[\u00c2\u00c3][\u0080-\u00bf]|\u00e2[\u0080-\u00bf]{1,2}|\u00f0[\u0080-\u00bf]{1,3})/u;
const MOJIBAKE_SEQUENCE_GLOBAL = /(?:[\u00c2\u00c3][\u0080-\u00bf]|\u00e2[\u0080-\u00bf]{1,2}|\u00f0[\u0080-\u00bf]{1,3})/gu;
const C1_CONTROL = /[\u0080-\u009f]/gu;
const REPLACEMENT_CHAR = /\ufffd/gu;

const DISPLAY_TEXT_KEYS = new Set([
  'name', 'company', 'companyname', 'category', 'cat', 'subcategory', 'subcategoria',
  'address', 'endereco', 'city', 'cidade', 'state', 'uf', 'neighborhood', 'bairro',
  'label', 'title', 'query', 'searchlabel', 'searchname', 'description', 'openinghours',
]);

function getTextDecoder() {
  if (typeof TextDecoder !== 'undefined') return TextDecoder;
  // Node versions that do not expose TextDecoder globally still provide it here.
  // This branch is never bundled into the renderer.
  return require('util').TextDecoder;
}

function mojibakeScore(value) {
  const text = String(value ?? '');
  return (text.match(MOJIBAKE_SEQUENCE_GLOBAL) || []).length * 10
    + (text.match(C1_CONTROL) || []).length * 3
    + (text.match(REPLACEMENT_CHAR) || []).length * 20;
}

function decodeLatin1AsUtf8(value) {
  const text = String(value ?? '');
  const points = Array.from(text, (character) => character.codePointAt(0));
  if (points.some((point) => point > 255)) return text;
  return new (getTextDecoder())('utf-8', { fatal: true }).decode(Uint8Array.from(points));
}

function repairMojibake(value) {
  let current = String(value ?? '');
  for (let pass = 0; pass < 3 && MOJIBAKE_SEQUENCE.test(current); pass += 1) {
    try {
      const decoded = decodeLatin1AsUtf8(current);
      if (!decoded || decoded === current || mojibakeScore(decoded) >= mojibakeScore(current)) break;
      current = decoded;
    } catch {
      break;
    }
  }
  return current.normalize('NFC');
}

function normalizeText(value) {
  return repairMojibake(value).replace(/\s+/gu, ' ').trim();
}

function isDisplayTextKey(key) {
  return DISPLAY_TEXT_KEYS.has(String(key || '').toLowerCase());
}

module.exports = {
  DISPLAY_TEXT_KEYS,
  decodeLatin1AsUtf8,
  isDisplayTextKey,
  mojibakeScore,
  normalizeText,
  repairMojibake,
};
