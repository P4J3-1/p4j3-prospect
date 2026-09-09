/**
 * Remove apenas artefatos de interface que aparecem antes do endereço
 * extraído do Google Maps. Não remove letras, acentos ou pontuação válidos.
 */
const LEADING_ADDRESS_NOISE = /^[\s\p{Cc}\p{Cf}\p{Co}\u{1F4CD}\u{FE0E}\u{FE0F}]+/u;

function normalizeAddress(value) {
  return String(value ?? '')
    .normalize('NFC')
    .replace(LEADING_ADDRESS_NOISE, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

function hasLeadingAddressNoise(value) {
  return LEADING_ADDRESS_NOISE.test(String(value ?? '').normalize('NFC'));
}

module.exports = {
  normalizeAddress,
  hasLeadingAddressNoise,
};
