const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ContactStatusStore } = require('../utils/contact-status-store');
const { BaileysProvider } = require('../whatsapp/baileys-provider');

const tmp = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

let contactBucket;
before(async () => {
  ({ contactBucket } = await import('../renderer/src/contactStatus.mjs'));
});

function makeProvider() {
  const provider = new BaileysProvider({}, () => {}, () => {}, tmp('p4j3-bp-'));
  const sec = (ms) => Math.floor(ms / 1000);
  const t0 = Date.UTC(2026, 8, 1, 12);
  provider._chats = {
    // Conversa por @lid, sem telefone na tabela local: resolve pelo mapeamento do WhatsApp.
    '111@lid': { jid: '111@lid', name: 'Padaria', lastMessage: 'Oi', timestamp: sec(t0) },
    // Só o resumo do chat indica que você mandou a última mensagem (pelo celular).
    '5511900000002@s.whatsapp.net': { jid: '5511900000002@s.whatsapp.net', name: 'Clínica', lastMessage: 'Você: Olá!', timestamp: sec(t0) },
    // Conversa só recebida: não é prospecção.
    '5511900000003@s.whatsapp.net': { jid: '5511900000003@s.whatsapp.net', lastMessage: 'Promoção!', timestamp: sec(t0) },
    '123@g.us': { jid: '123@g.us', lastMessage: 'Você: grupo', timestamp: sec(t0), isGroup: true },
  };
  provider._messages = {
    '111@lid': [
      { key: { fromMe: true, id: 'a' }, message: { conversation: 'Olá, tudo bem?' }, messageTimestamp: sec(t0) },
      { key: { fromMe: false, id: 'b' }, message: { conversation: 'Quanto custa?' }, messageTimestamp: sec(t0 + 60000) },
    ],
  };
  provider.sock = {
    signalRepository: { lidMapping: { getPNForLID: async (lid) => (lid === '111@lid' ? '5511900000001:3@s.whatsapp.net' : null) } },
    onWhatsApp: async (...numbers) => numbers
      .filter((n) => n === '5511900000001' || n === '551133334444')
      .map((n) => ({ jid: `${n}@s.whatsapp.net`, exists: true })),
  };
  return { provider, t0 };
}

describe('sincronizar contatados', () => {
  it('lê o histórico do WhatsApp, inclusive @lid e envios pelo celular', async () => {
    const { provider, t0 } = makeProvider();
    const history = await provider.getOutreachHistory();
    const byPhone = Object.fromEntries(history.map((h) => [h.phone, h]));
    assert.deepEqual(Object.keys(byPhone).sort(), ['5511900000001', '5511900000002']);
    assert.equal(byPhone['5511900000001'].repliedAt, t0 + 60000);
    assert.equal(byPhone['5511900000002'].messages, 1);
    assert.equal(provider._getPhoneJid('111@lid'), '5511900000001@s.whatsapp.net', 'mapeamento fica memorizado');
  });

  it('checa WhatsApp testando com e sem o 9', async () => {
    const { provider } = makeProvider();
    const result = await provider.checkWhatsAppNumbers(['(11) 90000-0001', '1133334444', '11988887777']);
    assert.deepEqual(result, { 11900000001: true, 1133334444: true, 11988887777: false });
  });

  it('importa histórico sem rebaixar status e respeita "não contatar"', () => {
    const store = new ContactStatusStore(tmp('p4j3-cs-'));
    store.recordSent('11900000001', { messageId: 'x' });
    store.recordReceipt('x', 'read');
    store.setManual('11900000009', 'nao_contatar');
    const changed = store.importHistory([
      { phone: '5511900000001', sentAt: 5, messages: 1 },
      { phone: '5511900000002', sentAt: 5, messages: 2, repliedAt: 9, replies: 1 },
      { phone: '5511900000009', sentAt: 5, messages: 1 },
    ]);
    assert.equal(store.get('11900000001').status, 'lido');
    assert.equal(store.get('11900000002').status, 'respondeu');
    assert.equal(store.get('11900000009').status, 'nao_contatar');
    assert.ok(changed >= 1);
    assert.equal(store.importHistory([{ phone: '5511900000002', sentAt: 5, messages: 2, repliedAt: 9, replies: 1 }]), 0, 'reimportar não muda nada');
    store.flush();
  });

  it('marcações manuais e aba do Scraper', () => {
    const store = new ContactStatusStore(tmp('p4j3-cs-'));
    store.setManual('11911112222', 'contatado');
    assert.equal(contactBucket(store.get('11911112222')), 'contatados');
    store.setManual('11911112222', 'nao_contatar');
    assert.equal(contactBucket(store.get('11911112222')), 'nao_contatar');
    store.setManual('11911112222', 'limpar');
    assert.equal(contactBucket(store.get('11911112222')), 'disponiveis');
    assert.throws(() => store.setManual('123', 'contatado'));
    store.recordWaCheck({ 11911112222: true });
    assert.equal(store.getWaCheck()['11911112222'].exists, true);
    store.flush();
  });
});

describe('mesma pessoa em 3 conversas (com 9, sem 9 e LID)', () => {
  it('junta tudo e conta as respostas dela, inclusive áudio', async () => {
    const provider = new BaileysProvider({}, () => {}, () => {}, tmp('p4j3-bp-'));
    const sec = (ms) => Math.floor(ms / 1000);
    const t0 = Date.UTC(2026, 8, 26, 13);
    provider._chats = {
      '5561984096319@s.whatsapp.net': { jid: '5561984096319@s.whatsapp.net', name: 'EDM Saúde', timestamp: sec(t0) },
      '556184096319@s.whatsapp.net': { jid: '556184096319@s.whatsapp.net', timestamp: sec(t0) },
      '243717936038030@lid': { jid: '243717936038030@lid', timestamp: sec(t0) },
    };
    provider._messages = {
      '5561984096319@s.whatsapp.net': [
        { key: { fromMe: true, id: 'm1' }, message: { conversation: 'Opa, tudo bem? É EDM Saúde?' }, messageTimestamp: sec(t0) },
        { key: { fromMe: true, id: 'm4' }, message: { conversation: 'Prefere segunda às 11h ou quarta às 13h?' }, messageTimestamp: sec(t0 + 3 * 3600e3) },
      ],
      '243717936038030@lid': [
        { key: { fromMe: true, id: 'm1' }, message: { conversation: 'Opa, tudo bem? É EDM Saúde?' }, messageTimestamp: sec(t0) },
        { key: { fromMe: false, id: 'r1' }, message: { conversation: 'Olá, aqui é o Elim, já te respondo. Estou em atendimento' }, messageTimestamp: sec(t0 + 3000) },
        { key: { fromMe: false, id: 'r2' }, message: { audioMessage: { seconds: 20 } }, messageTimestamp: sec(t0 + 3600e3) },
        { key: { fromMe: false, id: 'r3' }, message: { conversation: '13h' }, messageTimestamp: sec(t0 + 4 * 3600e3) },
      ],
    };
    provider._jidAliases = { '243717936038030@lid': '556184096319@s.whatsapp.net', '556184096319@s.whatsapp.net': '243717936038030@lid' };
    provider.sock = { signalRepository: { lidMapping: { getPNForLID: async () => '556184096319@s.whatsapp.net' } } };
    const history = await provider.getOutreachHistory();
    assert.equal(history.length, 1, 'uma pessoa, um registro');
    assert.equal(history[0].phone, '5561984096319');
    assert.equal(history[0].replies, 2, 'áudio + "13h" (a saudação automática não conta)');
    assert.equal(history[0].autoReplies, 1);
    assert.equal(history[0].lastReplyAt, t0 + 4 * 3600e3);
  });
});
