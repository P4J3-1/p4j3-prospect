/**
 * Remove artefatos invisíveis/de interface inseridos no endereço pelo Maps.
 * Não remove letras, acentos ou pontuação válidos.
 */
const { repairMojibake } = require('./text-normalizer');

const LEADING_ADDRESS_NOISE = /^[\s\p{Cc}\p{Cf}\p{Co}\u{1F4CD}\u{FE0E}\u{FE0F}]+/u;
const ADDRESS_ARTIFACTS = /[\p{Cc}\p{Cf}\p{Co}\u{1F4CD}\u{FE0E}\u{FE0F}]/gu;

function normalizeAddress(value) {
  return repairMojibake(value)
    .normalize('NFC')
    .replace(ADDRESS_ARTIFACTS, ' ')
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
