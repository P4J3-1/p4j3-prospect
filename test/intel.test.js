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

describe('J.A.R.V.I.S. com contexto', () => {
  const { parseByRules } = require('../agents/jarvis');
  it('ordens novas: conversa, proposta, não contatar, ajustar e pausar agente', () => {
    assert.deepEqual(parseByRules('abre a conversa da COTTA'), { acao: 'abrir_conversa', parametros: { lead: 'COTTA' } });
    assert.equal(parseByRules('gerar proposta').parametros.lead, 'este');
    assert.deepEqual(parseByRules('muda a meta para 60'), { acao: 'ajustar', parametros: { alvo: 'meta_diaria', valor: 60 } });
    assert.deepEqual(parseByRules('pausa o radar'), { acao: 'agente', parametros: { nome: 'radar', ligar: false } });
    assert.equal(parseByRules('mostra os quentes').parametros.filtro, 'alto_potencial');
  });
});

describe('diagnóstico gratuito', () => {
  const { ruleContent, renderDiagnosisHtml } = require('../agents/diagnosis');
  it('usa dados reais, não repete problema e não elogia 1 avaliação', () => {
    const c = ruleContent({ nome: 'Aconchego - Hamburgueria', nota: 5, avaliacoes: 1, site: 'x', site_problemas: ['Site com erro (HTTP 403)'], problemas: ['Site com erro (HTTP 403)'] });
    assert.equal(c.problemas.filter((p) => /fora do ar/i.test(p.titulo)).length, 1);
    assert.ok(c.problemas.some((p) => /1 avaliação/.test(p.titulo)));
    assert.ok(!c.fortes.some((f) => /1 avalia/.test(f)));
  });
  it('HTML escapa dados do lead e não tem link', () => {
    const c = ruleContent({ nome: '<img src=x onerror=alert(1)>', nota: 4.9, avaliacoes: 50 });
    const html = renderDiagnosisHtml(c, { lead: {}, seller: { agencyName: 'P4J3' } });
    assert.ok(!html.includes('<img src=x'));
    assert.ok(!/https?:\/\//.test(html));
  });
});

describe('imagens de demonstração', () => {
  const { siteMockHtml, chatMockHtml, servicesFor } = require('../agents/mockups');
  it('serviços pelo nicho e dados do lead escapados, sem link', () => {
    assert.deepEqual(servicesFor('Barbearia'), ['Corte masculino', 'Barba na navalha', 'Pigmentação']);
    const site = siteMockHtml({ name: '<script>x</script> Pizzaria - Guará', category: 'Pizzaria', rating: 4.8, reviews: 115 });
    const chat = chatMockHtml({ name: 'Pizzaria Bella - Guará', category: 'Pizzaria' });
    assert.ok(!site.includes('<script>x'));
    assert.ok(chat.includes('Pizzaria Bella') && !chat.includes('Guará'));
    assert.ok(!/https?:\/\//.test(site + chat));
  });
});

describe('agente Crítico', () => {
  const now = Date.UTC(2026, 8, 26, 15);
  it('várias sugestões com ação pronta, quem espera primeiro, sem "proteger número"', async () => {
    const { critique } = await import('../renderer/src/critic.mjs');
    const leads = [];
    const contacts = {};
    for (let i = 0; i < 10; i += 1) {
      const phone = `6199999${String(1000 + i)}`;
      leads.push({ name: `Barbearia ${i}`, phone, category: 'Barbearia', neighborhood: 'Ceilândia', state: 'DF' });
      contacts[phone] = i < 3 ? { status: 'respondeu', sentAt: now - 5 * 3600e3, lastReplyAt: now - (3 - i) * 3600e3, name: `Barbearia ${i}` } : { status: 'enviado', sentAt: now - 86400e3 };
    }
    for (let i = 0; i < 12; i += 1) {
      const phone = `6198888${String(1000 + i)}`;
      leads.push({ name: `Pet ${i}`, phone, category: 'Pet shop' });
      contacts[phone] = { status: 'enviado', sentAt: now - 86400e3 };
    }
    const list = critique({ leads, contacts, queue: { items: [{ status: 'rascunho' }, { status: 'rascunho' }], numbers: [{ phone: '1', risk: { level: 'alto', reasons: ['x'] } }] }, autopilot: { settings: { enabled: false }, replyDrafts: {} }, now });
    assert.equal(list[0].id, 'responder:61999991000'); // esperou mais
    assert.ok(list.length >= 5);
    assert.ok(list.some((x) => x.id === 'aprovar' && x.acao.acao === 'aprovar'));
    assert.ok(list.some((x) => x.id === 'cacar:Barbearia' && x.acao.parametros.cidade === 'Ceilândia, DF'));
    assert.ok(list.some((x) => x.id === 'nicho-frio:Pet shop'));
    assert.ok(list.some((x) => x.id === 'piloto'));
    assert.ok(!JSON.stringify(list).match(/roteger/));
  });
});

describe('agente do Kanban', () => {
  const now = Date.UTC(2026, 8, 26, 15);
  const card = (key, columnId, phone, extra = {}) => ({ entityKey: key, columnId, entity: { profile: { name: `Loja ${key} - Guará`, phone } }, ...extra });
  it('pendências com o texto pronto para confirmar', async () => {
    const { kanbanTasks } = await import('../renderer/src/critic.mjs');
    const tasks = kanbanTasks({
      cards: [
        card('a', 'contacted', '5561999990001'),
        card('b', 'proposal', '61999990002', { movedAt: now - 3 * 86400e3 }),
        card('c', 'sent', '61999990003'),
        card('d', 'won', '61999990004'),
        card('e', 'new', '', { reminderAt: now - 1000, reminderNote: 'Ligar para o dono' }),
      ],
      contacts: {
        61999990001: { status: 'respondeu', sentAt: now - 86400e3, lastReplyAt: now - 3600e3 },
        61999990002: { status: 'lido', sentAt: now - 5 * 86400e3 },
        61999990003: { status: 'lido', sentAt: now - 4 * 86400e3 },
      },
      replyDrafts: { 61999990001: { at: now - 1800e3, sugestoes: ['Claro! Posso te mostrar como funciona?'] } },
      now,
    });
    const byId = Object.fromEntries(tasks.map((t) => [t.id, t]));
    assert.equal(byId['responder:61999990001'].acao.text, 'Claro! Posso te mostrar como funciona?');
    assert.match(byId['cobrar:61999990002'].acao.text, /proposta/);
    assert.equal(byId['followup:61999990003'].acao.text, 'Oi, Loja! Tudo bem? Conseguiu ver minha mensagem?');
    assert.equal(byId['valor:d'].acao.tipo, 'card');
    assert.equal(byId['lembrete:e'].detalhe, 'Ligar para o dono');
    assert.ok(!tasks.some((t) => /https?:/.test(t.acao.text || '')));
  });
});

describe('agente do Kanban: resposta já escrita', () => {
  it('mostra a resposta pronta escrita depois da sua última mensagem', async () => {
    const { kanbanTasks } = await import('../renderer/src/critic.mjs');
    const now = Date.UTC(2026, 8, 26, 15);
    const cards = [{ entityKey: 'x', columnId: 'contacted', entity: { profile: { name: 'Studio X', phone: '61999990009' } } }];
    const contacts = { 61999990009: { status: 'respondeu', sentAt: now - 7200e3 } };
    const fresh = kanbanTasks({ cards, contacts, replyDrafts: { 61999990009: { at: now - 3600e3, sugestoes: ['Posso te mostrar?'] } }, now });
    assert.equal(fresh[0]?.acao.text, 'Posso te mostrar?');
    const stale = kanbanTasks({ cards, contacts, replyDrafts: { 61999990009: { at: now - 9000e3, sugestoes: ['velha'] } }, now });
    assert.equal(stale.length, 0);
  });
});
