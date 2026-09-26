const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { whatsappXray, openerOf } = require('../utils/whatsapp-xray');

describe('Raio-X do WhatsApp', () => {
  it('reconhece a abertura pelo texto mesmo sem registro', () => {
    assert.equal(openerOf({ message: 'Oi, tudo bem? Falo com Barbearia do Zé?' }), 0);
    assert.equal(openerOf({ message: 'Olá! Tudo certo? 🙂 Aqui é Pet Amigo?' }), 1);
    assert.equal(openerOf({ message: 'Proposta comercial completa…' }), null);
    assert.equal(openerOf({ opener: 5, message: 'x' }), 5);
  });

  it('funil, abertura campeã e tempo de resposta', () => {
    const t = Date.UTC(2026, 8, 26, 13);
    const items = [
      { kind: 'primeiro', status: 'enviado', phone: '61999990001', sentAt: t, opener: 0 },
      { kind: 'primeiro', status: 'enviado', phone: '61999990002', sentAt: t, opener: 0 },
      { kind: 'primeiro', status: 'enviado', phone: '61999990003', sentAt: t, opener: 1 },
    ];
    const contacts = {
      61999990001: { status: 'respondeu', repliedAt: t + 30 * 60000 },
      61999990002: { status: 'lido' },
      61999990003: { status: 'entregue', autoReplies: 1 },
    };
    const x = whatsappXray({ items, contacts });
    assert.deepEqual(x.funnel, { enviado: 3, entregue: 3, lido: 2, respondeu: 1, saiu: 0 });
    assert.equal(x.openers[0].index, 0);
    assert.equal(x.openers[0].rate, 50);
    assert.equal(x.replyMinutesMedian, 30);
    assert.equal(x.autoReplies, 1);
  });
});
