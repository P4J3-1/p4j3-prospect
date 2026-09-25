const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createSecretBox, SECRET_PREFIX } = require('../utils/secret-box');
const { ProspectingStore } = require('../lead-scoring/prospecting-store');

// Simula o DPAPI: inverte os bytes (reversível, mas nunca igual ao texto puro).
const fakeSafeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from(s, 'utf8').reverse(),
  decryptString: (b) => Buffer.from(b).reverse().toString('utf8'),
};

describe('segredos em disco', () => {
  it('cifra e abre a chave; lê valores antigos em texto puro', () => {
    const box = createSecretBox(fakeSafeStorage);
    const sealed = box.seal('sk-teste-123');
    assert.ok(sealed.startsWith(SECRET_PREFIX));
    assert.ok(!sealed.includes('sk-teste-123'));
    assert.equal(box.open(sealed), 'sk-teste-123');
    assert.equal(box.open('sk-antiga'), 'sk-antiga');
  });

  it('sem cifra disponível, grava como está (não perde a chave)', () => {
    const box = createSecretBox({ isEncryptionAvailable: () => false });
    assert.equal(box.seal('sk-x'), 'sk-x');
  });

  it('store grava a API key cifrada e a mantém legível em memória', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p4j3-secret-'));
    const secretBox = createSecretBox(fakeSafeStorage);
    const store = new ProspectingStore(dir, { secretBox });
    store.updateSettings({
      ai: {
        enabled: true,
        provider: 'deepseek',
        apiKey: 'sk-segredo-999',
        fallbackProviders: JSON.stringify([{ provider: 'openrouter', apiKey: 'sk-fallback-1' }]),
      },
    });
    const file = path.join(dir, 'lead-scoring', 'lead-score-settings.json');
    for (const f of [file, `${file}.bak`]) {
      const raw = fs.readFileSync(f, 'utf8');
      assert.ok(!raw.includes('sk-segredo-999'), `${path.basename(f)} não pode ter a chave em texto puro`);
      assert.ok(!raw.includes('sk-fallback-1'));
    }
    assert.equal(store.getSettings().ai.apiKey, 'sk-segredo-999');
    const reopened = new ProspectingStore(dir, { secretBox });
    assert.equal(reopened.getSettings().ai.apiKey, 'sk-segredo-999');
    assert.equal(JSON.parse(reopened.getSettings().ai.fallbackProviders)[0].apiKey, 'sk-fallback-1');
  });
});
