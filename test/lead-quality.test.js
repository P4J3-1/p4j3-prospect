const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

let q;
before(async () => { q = await import('../renderer/src/leadQuality.mjs'); });

describe('qualidade da base', () => {
  it('extrai bairro, cidade e UF do endereço do Google Maps', () => {
    assert.deepEqual(q.parseBrAddress('Sl 1911 - Águas Claras, Brasília - DF, 71926-000, Brasil'),
      { neighborhood: 'Águas Claras', city: 'Brasília', state: 'DF', cep: '71926-000' });
    assert.equal(q.parseBrAddress('Av. Castanheiras lotes 1310/1370 loja 20, Brasília - DF, 71900-100').neighborhood, '');
    assert.equal(q.parseBrAddress('Brasília - DF').city, 'Brasília');
    assert.equal(q.parseBrAddress(''), null);
  });

  it('tira Instagram/e-mail repetido em 3+ empresas diferentes', () => {
    const leads = [
      { name: 'Clínica A', instagram: '@kitrato_', email: 'x@y.com' },
      { name: 'Clínica B', instagram: '@kitrato_' },
      { name: 'Lava Jato C', instagram: '@kitrato_' },
      { name: 'Studio D', instagram: '@studiod' },
    ];
    const out = q.stripSharedContacts(leads);
    assert.deepEqual(out.map((l) => l.instagram), ['', '', '', '@studiod']);
    assert.equal(out[0].email, 'x@y.com', 'e-mail único fica');
  });
});
