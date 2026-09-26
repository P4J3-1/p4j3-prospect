const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { SendQueue, withinWindow } = require('../campaigns/send-queue');
const { entryOffer, nextOffer, imageDiagnosis, objectionsFor } = require('../campaigns/offer-ladder');
const { composeMessages } = require('../campaigns/outreach-composer');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'p4j3-q-'));
const DAY = 24 * 60 * 60 * 1000;

describe('fila de envio', () => {
  it('só envia o que foi aprovado, na janela e respeitando o intervalo', () => {
    const q = new SendQueue(tmp());
    const [a, b] = q.add([
      { phone: '11911110001', name: 'A', message: 'Oi A?', offer: 'site' },
      { phone: '11911110002', name: 'B', message: 'Oi B?', offer: 'site' },
      { phone: '5511911110001', name: 'A dup', message: 'x', offer: 'site' },
    ]);
    assert.equal(q.items.length, 2, 'mesmo número não entra duas vezes');
    const noon = new Date(2026, 8, 25, 12, 0);
    assert.equal(q.nextToSend(noon.getTime(), noon).wait, 'vazia', 'rascunho não sai sem aprovação');
    q.update(a.id, { status: 'aprovado' });
    assert.equal(q.nextToSend(noon.getTime(), noon).item.id, a.id);
    const night = new Date(2026, 8, 25, 23, 0);
    assert.equal(q.nextToSend(night.getTime(), night).wait, 'fora_do_horario');
    q.markResult(a.id, { ok: true, messageId: 'm1' }, noon.getTime());
    q.approveAll();
    const soon = new Date(noon.getTime() + 60000);
    assert.equal(q.nextToSend(soon.getTime(), soon).wait, 'intervalo');
    const later = new Date(noon.getTime() + 10 * 60000);
    assert.equal(q.nextToSend(later.getTime(), later).item.id, b.id);
  });

  it('janela que atravessa a meia-noite e janela desligada', () => {
    const s = { windowEnabled: true, windowStart: '20:00', windowEnd: '02:00' };
    assert.equal(withinWindow(s, new Date(2026, 0, 1, 23, 30)), true);
    assert.equal(withinWindow(s, new Date(2026, 0, 1, 12, 0)), false);
    assert.equal(withinWindow({ ...s, windowEnabled: false }, new Date(2026, 0, 1, 12, 0)), true);
  });

  it('recontato: follow-up após 3 dias, nova oferta após 7, nada para quem respondeu', () => {
    const q = new SendQueue(tmp());
    const t0 = Date.UTC(2026, 8, 1);
    const [a, b] = q.add([
      { phone: '11922220001', name: 'A', message: 'Oi?', offer: 'site' },
      { phone: '11922220002', name: 'B', message: 'Oi?', offer: 'site' },
    ], t0);
    q.approveAll();
    q.markResult(a.id, { ok: true }, t0);
    q.markResult(b.id, { ok: true }, t0);
    const contacts = { 11922220002: { status: 'respondeu' } };
    const contactOf = (phone) => contacts[phone] || null;
    assert.equal(q.planRecontacts(contactOf, t0 + 2 * DAY).length, 0);
    const plans = q.planRecontacts(contactOf, t0 + 3 * DAY);
    assert.deepEqual(plans.map((p) => [p.kind, p.base.name]), [['follow_up', 'A']]);
    const [fu] = q.add([{ phone: '11922220001', kind: 'follow_up', name: 'A', message: 'E aí?', offer: 'site' }], t0 + 3 * DAY);
    q.approveAll();
    q.markResult(fu.id, { ok: true }, t0 + 3 * DAY);
    const later = q.planRecontacts(contactOf, t0 + 10 * DAY);
    assert.equal(later[0].kind, 'nova_oferta');
    assert.deepEqual(later[0].tried, ['site']);
  });
});

describe('escada de ofertas e diagnóstico de imagem', () => {
  it('oferta de entrada pelo problema e próxima oferta sem repetir', () => {
    assert.equal(entryOffer({ segments: ['sem_site', 'atendimento_manual'] }), 'site');
    assert.equal(entryOffer({ segments: ['site_fraco'] }), 'reforma_site');
    assert.equal(entryOffer({ segments: ['atendimento_manual'] }), 'automacao');
    assert.equal(entryOffer({ segments: [] }), 'imagem');
    assert.equal(nextOffer('site', ['site']), 'automacao');
    assert.equal(nextOffer('site', ['site', 'automacao', 'imagem']), null);
    assert.ok(objectionsFor('site').some((o) => /Instagram/.test(o.objecao)));
  });

  it('compara com concorrentes do mesmo bairro', () => {
    const lead = { name: 'Minha', rating: '4.1', reviewCount: 12, photos: { count: 1 } };
    const peers = [
      lead,
      { name: 'Rival', rating: '4.8', reviewCount: 310 },
      { name: 'Outra', rating: '4.5', reviewCount: 90 },
      { name: 'Mais uma', rating: '4.6', reviewCount: 150 },
    ];
    const d = imageDiagnosis(lead, peers);
    assert.ok(d.findings.some((f) => f.includes('Poucas avaliações')));
    assert.ok(d.findings.some((f) => f.includes('4,1')));
    assert.equal(d.comparacao.destaque.nome, 'Rival');
    assert.equal(d.comparacao.abaixoDaMedia, true);
  });
});

describe('composição das mensagens', () => {
  it('modelos sem link, com saudação e variações; IA substitui quando válida', async () => {
    const lead = { name: 'Clínica Sorriso', phone: '11999990000' };
    const items = [
      { key: 'a', kind: 'primeiro', offer: 'site', lead },
      { key: 'b', kind: 'nova_oferta', offer: 'automacao', previousOffer: 'site', lead },
    ];
    const noAi = await composeMessages(items);
    // 1º contato: abertura curta com o nome da empresa, sem pitch.
    assert.ok(/Clínica Sorriso|respons[aá]vel|atendimento/.test(noAi.get('a').mensagem));
    assert.ok(noAi.get('a').mensagem.length < 120);
    assert.ok(!/[{}]/.test(noAi.get('a').mensagem), 'spintax resolvido');
    assert.ok(/site profissional/.test(noAi.get('b').mensagem));
    const withAi = await composeMessages(items, {
      runAi: async () => ({ result: { mensagens: [{ key: 'b', mensagem: 'Oi {{saudacao}}, veja www.spam.com e https://x.io agora? Posso te mostrar?' }] } }),
    });
    assert.equal(withAi.get('a').ai, false, 'abertura não passa pela IA');
    assert.equal(withAi.get('b').ai, true);
    assert.ok(!/www\.|https?:/.test(withAi.get('b').mensagem));
  });
});
