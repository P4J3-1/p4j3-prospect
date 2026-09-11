const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { KanbanStore } = require('../kanban/kanban-store');

function withStore(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sigma-kanban-rules-'));
  try {
    return fn(new KanbanStore(root), root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function boardWithRules(store, columns, rules) {
  return store.saveConfig({ columns, rules }, store.getBoard().revision);
}

const TWO_STAGES = [
  { id: 'new', name: 'Novos', color: '#10a37f' },
  { id: 'qualified', name: 'Qualificados', color: '#8b5cf6' },
];

test('regra de scoring não dispara em sincronização de campanha pendente', () => withStore((store) => {
  boardWithRules(store, TWO_STAGES, [{
    id: 'high-score',
    enabled: true,
    priority: 1,
    trigger: 'scoring.completed',
    match: 'all',
    when: [{ field: 'score', operator: 'gte', value: '80' }],
    action: { type: 'move', columnId: 'qualified' },
  }]);

  const board = store.syncCampaigns([{
    id: 'campaign-1',
    leads: [{ id: 'lead-1', name: 'Clínica Aurora', phone: '+55 11 95555-1000', status: 'pending', score: 92 }],
  }]);

  assert.equal(board.cards[0].columnId, 'new');
}));

test('regra de score aplica quando o evento é o scoring', () => withStore((store) => {
  boardWithRules(store, TWO_STAGES, [{
    id: 'high-score',
    enabled: true,
    priority: 1,
    trigger: 'scoring.completed',
    match: 'all',
    when: [{ field: 'score', operator: 'gte', value: '80' }],
    action: { type: 'move', columnId: 'qualified' },
  }]);

  const board = store.syncLeads([{
    id: 'score-1',
    company: { name: 'Clínica Aurora', phone: '+55 11 95555-1000', address: 'Rua A, 10' },
    score: { value: 92, priority: 'alta' },
  }], 'scoring');

  assert.equal(board.cards[0].columnId, 'qualified');
}));

test('limite de WIP bloqueia movimento automático e informa o motivo', () => withStore((store) => {
  boardWithRules(store, [
    { id: 'new', name: 'Novos', color: '#10a37f' },
    { id: 'qualified', name: 'Qualificados', color: '#8b5cf6', wipLimit: 1 },
  ], [{
    id: 'high-score',
    enabled: true,
    priority: 1,
    trigger: 'any',
    match: 'all',
    when: [{ field: 'score', operator: 'gte', value: '80' }],
    action: { type: 'move', columnId: 'qualified' },
  }]);

  const board = store.syncLeads([
    { id: 'lead-1', name: 'Clínica A', phone: '+55 11 90000-0001', score: 90 },
    { id: 'lead-2', name: 'Clínica B', phone: '+55 11 90000-0002', score: 90 },
  ], 'maps');

  const qualified = board.cards.filter((card) => card.columnId === 'qualified');
  assert.equal(qualified.length, 1);
  assert.equal(board.cards.filter((card) => card.columnId === 'new').length, 1);
}));

test('etapa final é ponto de chegada e não é esvaziada pela automação', () => withStore((store) => {
  boardWithRules(store, [
    { id: 'new', name: 'Novos', color: '#10a37f' },
    { id: 'won', name: 'Ganhos', color: '#16a34a', terminal: true },
  ], [{
    id: 'low-score',
    enabled: true,
    priority: 1,
    trigger: 'any',
    match: 'all',
    when: [{ field: 'score', operator: 'lte', value: '10' }],
    action: { type: 'move', columnId: 'new' },
  }]);

  const first = store.syncLeads([{ id: 'lead-1', name: 'Clínica A', phone: '+55 11 90000-0001', score: 5 }], 'maps');
  const card = first.cards[0];
  store.moveCard({ entityKey: card.entityKey, toColumnId: 'won', expectedRevision: card.revision, manual: true });

  const result = store.applyRules({ force: true });
  assert.equal(result.board.cards[0].columnId, 'won');
  assert.equal(result.preservedTerminal, 1);
}));

test('retomar automação recoloca o card na etapa da regra na hora', () => withStore((store) => {
  boardWithRules(store, TWO_STAGES, [{
    id: 'high-score',
    enabled: true,
    priority: 1,
    trigger: 'any',
    match: 'all',
    when: [{ field: 'score', operator: 'gte', value: '80' }],
    action: { type: 'move', columnId: 'qualified' },
  }]);

  const board = store.syncLeads([{ id: 'lead-1', name: 'Clínica A', phone: '+55 11 90000-0001', score: 90 }], 'maps');
  const card = board.cards[0];
  assert.equal(card.columnId, 'qualified');

  const moved = store.moveCard({ entityKey: card.entityKey, toColumnId: 'new', expectedRevision: card.revision, manual: true });
  assert.equal(moved.cards[0].columnId, 'new');

  const resumed = store.resumeAutomation(card.entityKey);
  assert.equal(resumed.cards[0].manualOverride, false);
  assert.equal(resumed.cards[0].columnId, 'qualified');
}));

test('excluir etapa pausa a regra em vez de redirecionar em silêncio', () => withStore((store) => {
  boardWithRules(store, TWO_STAGES, [{
    id: 'high-score',
    enabled: true,
    priority: 1,
    trigger: 'any',
    match: 'all',
    when: [{ field: 'score', operator: 'gte', value: '80' }],
    action: { type: 'move', columnId: 'qualified' },
  }]);

  const next = store.saveConfig({
    columns: [{ id: 'new', name: 'Novos', color: '#10a37f' }],
    rules: [{
      id: 'high-score',
      enabled: true,
      priority: 1,
      trigger: 'any',
      match: 'all',
      when: [{ field: 'score', operator: 'gte', value: '80' }],
      action: { type: 'move', columnId: 'qualified' },
    }],
  }, store.getBoard().revision);

  assert.equal(next.board.rules[0].enabled, false);
  assert.equal(next.board.rules[0].problem, 'missing_column');
  assert.equal(next.board.rules[0].action.columnId, '');
  assert.equal(next.stats.brokenRules, 1);
}));

test('quadro expõe histórico e estatísticas de automação', () => withStore((store) => {
  boardWithRules(store, TWO_STAGES, [{
    id: 'high-score',
    enabled: true,
    priority: 1,
    trigger: 'any',
    when: [{ field: 'score', operator: 'gte', value: '80' }],
    action: { type: 'move', columnId: 'qualified' },
  }]);

  const board = store.syncLeads([{ id: 'lead-1', name: 'Clínica A', phone: '+55 11 90000-0001', score: 90 }], 'maps');
  assert.equal(board.stats.total, 1);
  assert.equal(board.stats.byColumn.qualified, 1);
  assert.equal(board.stats.enabledRules, 1);
  assert.equal(board.events[0].type, 'leads_synced');
  assert.ok(board.events.some((event) => event.type === 'board_configured'));

  const card = board.cards[0];
  store.moveCard({ entityKey: card.entityKey, toColumnId: 'new', expectedRevision: card.revision, manual: true });
  const reapplied = store.applyRules({ force: true });
  assert.equal(reapplied.moved, 1);
  assert.equal(reapplied.preservedManual, 0);
  assert.ok(reapplied.board.events.some((event) => event.type === 'rules_applied'));
}));

test('sincronizar a mesma base não reescreve o quadro', () => withStore((store) => {
  const leads = [{ id: 'lead-1', name: 'Clínica A', phone: '+55 11 90000-0001', score: 90 }];
  const first = store.syncLeads(leads, 'maps');
  const second = store.syncLeads(leads, 'maps');
  assert.equal(second.revision, first.revision);
  assert.equal(second.cards.length, 1);

  const third = store.syncLeads([{ ...leads[0], score: 91 }], 'maps');
  assert.ok(third.revision > second.revision);
}));

test('base do Maps é autoritativa e fontes antigas não recriam leads apagados', () => withStore((store) => {
  store.syncLeads([
    { id: 'lead-1', name: 'Clínica A', phone: '+55 11 90000-0001' },
    { id: 'lead-2', name: 'Clínica B', phone: '+55 11 90000-0002' },
  ], 'maps', { replace: true, authoritative: true });
  store.syncLeads([
    { id: 'score-1', company: { name: 'Clínica A', phone: '+55 11 90000-0001' }, score: { value: 80 } },
    { id: 'score-old', company: { name: 'Lead apagado', phone: '+55 11 90000-0099' }, score: { value: 90 } },
  ], 'scoring', { replace: true, existingOnly: true });
  assert.equal(store.getBoard().cards.length, 2);

  store.syncLeads([
    { id: 'lead-1', name: 'Clínica A', phone: '+55 11 90000-0001' },
  ], 'maps', { replace: true, authoritative: true });
  store.syncCampaigns([{
    id: 'old-campaign',
    leads: [{ id: 'old', name: 'Lead apagado', phone: '+55 11 90000-0099', status: 'sent' }],
  }], { replace: true, existingOnly: true });

  assert.equal(store.getBoard().cards.length, 1);
  assert.equal(store.getBoard().cards[0].entity.profile.name, 'Clínica A');
}));

test('venda salva valor, soma receita e respeita etapa escolhida na regra simples', () => withStore((store) => {
  const board = store.getBoard().board;
  const customWon = { id: 'fechou', name: 'Fechou', color: '#16a34a', terminal: true, dealOutcome: 'won' };
  store.saveConfig({
    columns: [...board.columns.filter((column) => column.id !== 'won'), customWon],
    rules: [{
      id: 'deal-won-simple',
      enabled: true,
      priority: 1,
      trigger: 'deal.won',
      match: 'all',
      when: [],
      action: { type: 'move', columnId: 'fechou' },
    }],
  }, store.getBoard().revision);
  const synced = store.syncLeads([{ id: 'lead-1', name: 'Clínica A', phone: '+55 11 90000-0001' }], 'maps');
  const card = synced.cards[0];
  const result = store.recordDeal({ entityKey: card.entityKey, outcome: 'won', value: 2500.5, note: 'Site' });

  assert.equal(result.cards[0].columnId, 'fechou');
  assert.equal(result.cards[0].dealStatus, 'won');
  assert.equal(result.cards[0].dealValue, 2500.5);
  assert.equal(result.stats.wonValue, 2500.5);
  assert.equal(result.stats.ticketAverage, 2500.5);
}));
