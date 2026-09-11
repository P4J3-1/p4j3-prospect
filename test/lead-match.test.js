const test = require('node:test');
const assert = require('node:assert/strict');

const modulePromise = import('../renderer/src/leadMatch.mjs');

test('score do serviço é encontrado pelo telefone do lead da base', async () => {
  const { buildScoringIndex, findScoringLead } = await modulePromise;
  const baseLeads = [{
    id: 'ui-1',
    name: 'Odonto Lume',
    address: 'Avenida Atlântica, 1000',
    city: 'Rio de Janeiro',
    phone: '+55 21 98765-0142',
  }];
  const saved = [{
    id: 'lead_odonto_lume_avenida_atlantica_1000',
    company: { name: 'Odonto Lume', address: 'Avenida Atlântica, 1000, Rio de Janeiro', phone: '+5521987650142' },
    score: { value: 88, priority: 'alta' },
  }];

  const index = buildScoringIndex(saved);
  const found = findScoringLead(index, baseLeads[0], 0);
  assert.equal(found?.score.value, 88);
});

test('score é reencontrado sem telefone, por nome + endereço', async () => {
  const { buildScoringIndex, findScoringLead } = await modulePromise;
  const baseLeads = [{ id: 'ui-2', name: 'Café Aurora', address: 'Rua B, 42', city: 'Niterói' }];
  const saved = [{
    id: 'lead_cafe_aurora_rua_b_42',
    company: { name: 'Café Aurora', address: 'Rua B, 42', city: 'Niterói' },
    score: { value: 61 },
  }];

  const index = buildScoringIndex(saved);
  const found = findScoringLead(index, baseLeads[0], 0);
  assert.equal(found?.score.value, 61);
});

test('score não é emprestado para empresa diferente', async () => {
  const { buildScoringIndex, findScoringLead } = await modulePromise;
  const saved = [{
    id: 'lead_outra',
    company: { name: 'Outra Empresa', address: 'Rua Z, 1', city: 'São Paulo', phone: '+5511999990000' },
    score: { value: 90 },
  }];
  const base = { id: 'ui-3', name: 'Café Aurora', address: 'Rua B, 42', city: 'Niterói' };
  assert.equal(findScoringLead(buildScoringIndex(saved), base, 0), null);
});

test('faixas de prioridade seguem as do motor', async () => {
  const { scoreBand, normalizeThresholds } = await modulePromise;
  assert.equal(scoreBand(80).key, 'high');
  assert.equal(scoreBand(70).key, 'mid');
  assert.equal(scoreBand(20).key, 'low');
  assert.equal(scoreBand(80, { highFrom: 90, goodFrom: 60, ignoreBelow: 40 }).key, 'mid');
  assert.deepEqual(normalizeThresholds({ highFrom: 90 }), { highFrom: 90, goodFrom: 60, ignoreBelow: 40 });
});

test('grupo da base resolve somente os leads que existem', async () => {
  const { resolveGroupMembers } = await modulePromise;
  const leads = [
    { id: 'a', name: 'Um' },
    { id: 'b', name: 'Dois' },
  ];
  const group = { id: 'g1', members: ['a', 'fantasma'] };
  const resolved = resolveGroupMembers(group, leads);
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0].id, 'a');
});

test('grupo criado pelo scoring resolve pelos ids do serviço', async () => {
  const { buildScoringIndex, resolveServiceGroupMembers } = await modulePromise;
  const leads = [
    { id: 'a', name: 'Odonto Lume', phone: '+55 21 98765-0142' },
    { id: 'b', name: 'Café Aurora', phone: '+55 21 90000-0002' },
  ];
  const saved = [
    { id: 'lead_odonto', company: { name: 'Odonto Lume', phone: '+5521987650142' } },
    { id: 'lead_cafe', company: { name: 'Café Aurora', phone: '+5521900000002' } },
  ];
  const group = { id: 'grp_1', leadIds: ['lead_odonto'] };
  const resolved = resolveServiceGroupMembers(group, leads, buildScoringIndex(saved));
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0].id, 'a');
});
