const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createLeadsFileStore } = require('../utils/leads-file-store');

let installLeadStorage;
before(async () => {
  ({ installLeadStorage } = await import('../renderer/src/leadStorage.mjs'));
});

function makeStorageEnv() {
  class FakeStorage {
    constructor() { this.map = new Map(); }
  }
  FakeStorage.prototype.getItem = function (k) { return this.map.has(k) ? this.map.get(k) : null; };
  FakeStorage.prototype.setItem = function (k, v) { this.map.set(String(k), String(v)); };
  FakeStorage.prototype.removeItem = function (k) { this.map.delete(k); };
  FakeStorage.prototype.clear = function () { this.map.clear(); };
  return { storage: new FakeStorage(), other: new FakeStorage(), StorageProto: FakeStorage.prototype };
}

function makeApi(initial) {
  const saves = [];
  return { saves, load: () => ({ success: true, value: initial }), save: (v) => saves.push(v) };
}

describe('leads file store', () => {
  it('grava de forma atômica após o debounce e relê o valor', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sigma-leads-'));
    const file = path.join(dir, 'sigma-leads.json');
    const store = createLeadsFileStore(file, { debounceMs: 10_000 });
    assert.equal(store.load(), null);
    store.save('[{"id":1}]');
    assert.equal(store.load(), '[{"id":1}]', 'valor pendente já é visível');
    assert.equal(fs.existsSync(file), false);
    store.flush();
    assert.equal(fs.readFileSync(file, 'utf-8'), '[{"id":1}]');
    assert.equal(createLeadsFileStore(file).load(), '[{"id":1}]');
    store.save(null);
    store.flush();
    assert.equal(fs.existsSync(file), false);
  });

  it('rejeita valores que não são string', () => {
    const store = createLeadsFileStore(path.join(os.tmpdir(), 'nunca.json'));
    assert.throws(() => store.save({ id: 1 }), TypeError);
  });
});

describe('renderer lead storage', () => {
  it('migra o valor antigo sem apagá-lo na primeira execução', () => {
    const env = makeStorageEnv();
    env.storage.map.set('sigma_leads', '[1]');
    const api = makeApi(null);
    assert.equal(installLeadStorage({ api, ...env }), true);
    assert.deepEqual(api.saves, ['[1]']);
    assert.equal(env.storage.getItem('sigma_leads'), '[1]');
    assert.equal(env.storage.map.get('sigma_leads'), '[1]', 'cópia antiga fica até o arquivo existir');
  });

  it('usa o arquivo e libera a chave antiga quando ele já existe', () => {
    const env = makeStorageEnv();
    env.storage.map.set('sigma_leads', '[old]');
    const api = makeApi('[new]');
    installLeadStorage({ api, ...env });
    assert.equal(env.storage.getItem('sigma_leads'), '[new]');
    assert.equal(env.storage.map.has('sigma_leads'), false);
  });

  it('desvia só sigma_leads do localStorage; o resto segue normal', () => {
    const env = makeStorageEnv();
    const api = makeApi('[]');
    installLeadStorage({ api, ...env });
    env.storage.setItem('sigma_leads', '[{"id":2}]');
    env.storage.setItem('sigma_groups', '[]');
    env.other.setItem('sigma_leads', 'sessao');
    assert.equal(env.storage.getItem('sigma_leads'), '[{"id":2}]');
    assert.equal(env.storage.map.has('sigma_leads'), false);
    assert.equal(env.storage.map.get('sigma_groups'), '[]');
    assert.equal(env.other.getItem('sigma_leads'), 'sessao');
    assert.deepEqual(api.saves, ['[{"id":2}]']);
    env.storage.removeItem('sigma_leads');
    assert.equal(env.storage.getItem('sigma_leads'), null);
    assert.deepEqual(api.saves, ['[{"id":2}]', null]);
  });

  it('mantém o localStorage original se o carregamento falhar', () => {
    const env = makeStorageEnv();
    const originalGet = env.StorageProto.getItem;
    const api = { load: () => ({ success: false, error: 'disco' }), save: () => {} };
    assert.equal(installLeadStorage({ api, ...env }), false);
    assert.equal(env.StorageProto.getItem, originalGet);
  });
});

describe('base de leads compacta', () => {
  const { compactLead, compactLeadsJson } = require('../utils/leads-file-store');
  it('tira a lista de fotos e mantém contagem e foto principal', () => {
    const lead = { name: 'A', photos: { main: 'm', thumbnail: 't', all: ['m', 'x', 'y'], count: 0 } };
    assert.deepEqual(compactLead(lead), { name: 'A', photos: { count: 3, main: 'm' } });
    const out = JSON.parse(compactLeadsJson(JSON.stringify([lead, { name: 'B' }])));
    assert.deepEqual(out, [{ name: 'A', photos: { count: 3, main: 'm' } }, { name: 'B' }]);
    assert.equal(compactLeadsJson(JSON.stringify(out)), null);
  });
});
