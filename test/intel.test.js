const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

let intel;
before(async () => { intel = await import('../renderer/src/intel.mjs'); });

describe('J.A.R.V.I.S.', () => {
  const now = Date.UTC(2026, 8, 26, 12);
  it('intenção: quem respondeu agora vale mais que quem só leu', () => {
    const replied = intel.intentScore({ contact: { status: 'respondeu', sentAt: now - 7200e3, lastReplyAt: now - 3600e3 }, now });
    const read = intel.intentScore({ contact: { status: 'lido', lastEventAt: now - 3600e3 }, now });
    const old = intel.intentScore({ contact: { status: 'lido', lastEventAt: now - 10 * 86400e3 }, now });
    assert.ok(replied > read && read > old);
    assert.equal(intel.intentScore({ contact: { status: 'nao_contatar' }, now }), 0);
  });

  it('resultado por nicho com taxa de resposta', () => {
    const leads = [
      { name: 'A', phone: '61999990001', category: 'Barbearia' },
      { name: 'B', phone: '61999990002', category: 'Barbearia' },
      { name: 'C', phone: '61999990003', category: 'Pet shop' },
    ];
    const contacts = { 61999990001: { status: 'respondeu' }, 61999990002: { status: 'enviado' }, 61999990003: { status: 'enviado' } };
    const r = intel.resultsBy(leads, contacts, 'nicho');
    assert.deepEqual(r[0], { key: 'Barbearia', sent: 2, replied: 1, optOut: 0, rate: 50 });
  });

  it('briefing diz a próxima ação certa', () => {
    const b = intel.dailyBriefing({ contacts: { 61999990001: { status: 'respondeu', sentAt: 1, lastReplyAt: 2 } }, queue: { items: [{ status: 'rascunho' }] }, now });
    assert.match(b.saudacao, /Bom dia|Boa tarde|Boa noite/);
    assert.equal(b.acao.go, 'whatsapp');
    assert.ok(b.linhas.some((l) => /esperando você/.test(l)));
  });
});

describe('ordens do J.A.R.V.I.S.', () => {
  const { parseByRules, understand } = require('../agents/jarvis');
  it('entende as ordens principais sem IA', () => {
    assert.deepEqual(parseByRules('caçar dentistas em Taguatinga, DF'), { acao: 'cacar', parametros: { nicho: 'dentistas', cidade: 'Taguatinga, DF' } });
    assert.equal(parseByRules('radar de pet shop em Goiânia, GO').acao, 'radar');
    assert.deepEqual(parseByRules('aprovar os 30 melhores').parametros, { quantidade: 30 });
    assert.equal(parseByRules('liga o piloto').parametros.ligar, true);
    assert.equal(parseByRules('desligar piloto automático').parametros.ligar, false);
    assert.equal(parseByRules('abrir o kanban').parametros.tela, 'kanban');
    assert.equal(parseByRules('quantos responderam hoje?').acao, 'pergunta');
  });
  it('com IA usa a interpretação dela; se a IA falhar, cai nas regras', async () => {
    const ok = await understand('traz umas clínicas de estética do Guará', { runAi: async () => ({ result: { acao: 'cacar', parametros: { nicho: 'clínica de estética', cidade: 'Guará, DF' }, resposta: 'Caçando, senhor.' } }) });
    assert.equal(ok.acao, 'cacar');
    assert.equal(ok.ai, true);
    const fallback = await understand('aprovar os 10 melhores', { runAi: async () => { throw new Error('sem rede'); } });
    assert.deepEqual(fallback.parametros, { quantidade: 10 });
  });
});
