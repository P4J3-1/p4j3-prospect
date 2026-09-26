const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ContactStatusStore } = require('../utils/contact-status-store');
const triage = require('../lead-scoring/lead-triage');
const { AgentStore } = require('../agents/agent-store');
const { runAnalyst, suggestReplies } = require('../agents/ai-agents');

const tmp = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

let rendererTriage;
before(async () => {
  rendererTriage = await import('../renderer/src/triage.mjs');
});

describe('status de contato em tempo real', () => {
  it('segue envio → entregue → lido → respondeu e avisa a UI', () => {
    const events = [];
    const store = new ContactStatusStore(tmp('p4j3-cs-'), { onChange: (phone, entry) => events.push([phone, entry.status]) });
    store.recordSent('5511999990001@s.whatsapp.net', { messageId: 'm1', source: 'campanha', at: 1 });
    store.recordReceipt('m1', 'delivered', 2);
    store.recordReceipt('m1', 'read', 3);
    store.recordReceipt('m1', 'delivered', 4); // não rebaixa
    store.recordReply('11999990001', { at: 5 });
    assert.deepEqual(events.map((e) => e[1]), ['enviado', 'entregue', 'lido', 'respondeu']);
    assert.equal(store.get('(11) 99999-0001').status, 'respondeu');
    store.flush();
  });

  it('descadastro prevalece e resposta de desconhecido é ignorada', () => {
    const store = new ContactStatusStore(tmp('p4j3-cs-'));
    assert.equal(store.recordReply('11988887777'), null);
    store.recordSent('11988887777', { messageId: 'x' });
    store.recordReply('11988887777', { optOut: true });
    store.recordSent('11988887777', { messageId: 'y' });
    assert.equal(store.get('11988887777').status, 'descadastrado');
    store.flush();
  });

  it('mesmo messageId não conta duas vezes e persiste em disco', () => {
    const dir = tmp('p4j3-cs-');
    const store = new ContactStatusStore(dir);
    store.recordSent('11977776666', { messageId: 'dup' });
    store.recordSent('11977776666', { messageId: 'dup' });
    store.flush();
    const reopened = new ContactStatusStore(dir);
    assert.equal(reopened.get('11977776666').messages, 1);
  });
});

describe('triagem', () => {
  it('chave do lead é igual no backend e na tela', () => {
    for (const lead of [{ phone: '(11) 98765-4321' }, { phone: '5511987654321' }, { name: 'Clínica São José' }]) {
      assert.equal(triage.triageKey(lead), rendererTriage.triageKey(lead));
    }
  });

  it('classifica sem site + WhatsApp manual como alto potencial', () => {
    const t = triage.computeTriage({ name: 'Padaria', phone: '11987654321', rating: '4.7', totalReviews: '250' });
    assert.ok(t.segments.includes('sem_site'));
    assert.ok(t.segments.includes('atendimento_manual'));
    assert.ok(t.segments.includes('alto_potencial'));
  });

  it('detecta site fraco e bot existente a partir do HTML', async () => {
    const html = '<html><head><title>X</title></head><body>©2019 <script src="https://embed.tawk.to/abc"></script></body></html>';
    const fetchImpl = async () => ({ ok: true, status: 200, url: 'http://x.com.br', text: async () => html });
    const site = await triage.probeWebsite('x.com.br', { fetchImpl });
    const t = triage.computeTriage({ name: 'X', phone: '1133334444', website: 'x.com.br' }, site, { year: 2026 });
    assert.ok(t.segments.includes('site_fraco'));
    assert.ok(t.segments.includes('ja_automatizado'));
    assert.ok(t.findings.some((f) => f.includes('HTTPS')));
    assert.ok(t.findings.some((f) => f.includes('2019')));
  });

  it('IA completa a entrevista e o presente sem link; respeita o orçamento', async () => {
    const calls = [];
    const runAi = async ({ payload }) => {
      calls.push(payload.leads.length);
      return {
        result: {
          leads: payload.leads.map((l) => ({
            key: l.key,
            resumo: 'ok',
            prioridade: 'alta',
            entrevista: { perguntas: ['P1?', 'P2?'], sinais_de_compra: ['S1'], objecoes: [{ objecao: 'caro', resposta: 'vale' }] },
            presente: { titulo: 'T', mensagem: 'Oi! veja https://spam.com agora?' },
          })),
        },
      };
    };
    const leads = Array.from({ length: 10 }, (_, i) => ({ name: `Lead ${i}`, phone: `119876500${String(i).padStart(2, '0')}` }));
    const { results, aiUsed } = await triage.triageLeads(leads, { runAi, aiBudget: 9 });
    assert.equal(aiUsed, 9);
    assert.deepEqual(calls, [8, 1]);
    assert.equal(results[0].entrevista.perguntas[0], 'P1?');
    assert.ok(!results[0].presente.mensagem.includes('http'));
    assert.equal(results[9].aiApplied, false, 'fora do orçamento fica só com regras');
    assert.ok(results[9].presente.mensagem.includes('pessoal da Lead 9'));
  });

  it('store não troca resultado com IA por um sem IA', () => {
    const store = new triage.TriageStore(tmp('p4j3-tr-'));
    store.putMany([{ key: 'p:1', aiApplied: true, score: 90 }]);
    store.putMany([{ key: 'p:1', aiApplied: false, score: 10 }]);
    assert.equal(store.getAll()['p:1'].score, 90);
  });
});

describe('agentes', () => {
  it('limite diário, liga/desliga e playbook', () => {
    const store = new AgentStore(tmp('p4j3-ag-'));
    // Padrão: sem teto (o limite é o saldo da DeepSeek); o teto continua opcional.
    assert.equal(store.remaining('copywriter'), Infinity);
    store.update('copywriter', { unlimited: false });
    assert.equal(store.remaining('copywriter'), 30);
    store.consume('copywriter', 29);
    assert.equal(store.remaining('copywriter'), 1);
    store.update('copywriter', { enabled: false });
    assert.equal(store.remaining('copywriter'), 0);
    assert.throws(() => store.update('inexistente', {}));
    store.setPlaybook({ resumo: 'Foque em padarias', regras: ['Mande às 9h'], nichos: ['padaria'] });
    assert.ok(store.playbookText().includes('Mande às 9h'));
    const snap = store.snapshot();
    assert.equal(snap.agents.length, 7); // 6 de prospecção + J.A.R.V.I.S.
  });

  it('analista e respostas validam a saída da IA', async () => {
    const playbook = await runAnalyst({ insights: { sent: 40, replyRate: 12 } }, async () => ({
      provider: 'deepseek',
      result: { resumo: 'R', regras: ['a', 'b'], mensagem_recomendada: 'Oi {{saudacao}} https://x.com ?' },
    }));
    assert.equal(playbook.basedOnSent, 40);
    assert.ok(!playbook.mensagem_recomendada.includes('http'));

    await assert.rejects(() => suggestReplies({ messages: [] }, async () => ({})));
    const reply = await suggestReplies({ messages: [{ fromMe: false, text: 'Quanto custa?' }] }, async ({ payload }) => {
      assert.equal(payload.conversa[0].de, 'lead');
      return { result: { momento: 'interessado', sugestoes: ['A', 'B', 'C'], proximo_passo: 'marcar' } };
    });
    assert.equal(reply.sugestoes.length, 3);
    assert.equal(reply.momento, 'interessado');
  });
});
