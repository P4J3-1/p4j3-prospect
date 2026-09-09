const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { geocodeAddress, setCachePath } = require('../utils/geocode');

test('geocoder tenta CEP quando a consulta completa não retorna resultado', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sigma-geocode-fallback-'));
  const cachePath = path.join(root, 'cache.json');
  const originalFetch = global.fetch;
  let calls = 0;
  try {
    setCachePath(cachePath);
    global.fetch = async () => {
      calls += 1;
      return {
        ok: true,
        json: async () => calls === 1 ? [] : [{ lat: '-22.9', lon: '-43.2', type: 'postcode', importance: 0.5, display_name: 'CEP' }],
      };
    };
    const result = await geocodeAddress('Rua inexistente, 10 - Centro, Rio de Janeiro - RJ, 20000-000', 'Rio de Janeiro, RJ');
    assert.equal(result.lat, -22.9);
    assert.equal(result.lng, -43.2);
    assert.equal(calls, 2);
    assert.ok(JSON.parse(fs.readFileSync(cachePath, 'utf8')));
  } finally {
    global.fetch = originalFetch;
    setCachePath(null);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
