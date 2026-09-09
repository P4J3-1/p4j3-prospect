const assert = require('node:assert/strict');
const test = require('node:test');

const { normalizeAddress, hasLeadingAddressNoise } = require('../utils/address-normalizer');
const { normalizeKey } = require('../utils/geocode');
const { normalizeLead } = require('../lead-scoring/normalizer');

test('removes Google Maps material pin and invisible prefix from address', () => {
  assert.equal(normalizeAddress('\uE0C8Rua São João, nº 10'), 'Rua São João, nº 10');
  assert.equal(normalizeAddress('\u200B\uFEFFRua Álvares Penteado, 1'), 'Rua Álvares Penteado, 1');
  assert.equal(normalizeAddress('📍 Rua da Paz, 42'), 'Rua da Paz, 42');
  assert.equal(hasLeadingAddressNoise('\uE0C8Rua São João, nº 10'), true);
});

test('preserves valid accents and address punctuation', () => {
  assert.equal(normalizeAddress('Álvares Penteado, nº 1'), 'Álvares Penteado, nº 1');
  assert.equal(normalizeAddress('#1 Avenida Brasil, 100'), '#1 Avenida Brasil, 100');
});

test('uses the same geocode cache key for dirty and clean addresses', () => {
  const clean = 'Rua São João, nº 10';
  assert.equal(
    normalizeKey(`\uE0C8${clean}`, 'Rio de Janeiro, RJ'),
    normalizeKey(clean, 'Rio de Janeiro, RJ'),
  );
});

test('normalizes address before lead-scoring location parsing', () => {
  const lead = normalizeLead({
    name: 'Café Central',
    address: '\uE0C8Rua São João, 10, São Paulo, SP',
  });
  assert.equal(lead.company.address, 'Rua São João, 10, São Paulo, SP');
  assert.equal(lead.company.state, 'SP');
});
