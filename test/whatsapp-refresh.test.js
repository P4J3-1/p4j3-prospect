const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ContactStatusStore } = require('../utils/contact-status-store');
const { BaileysProvider } = require('../whatsapp/baileys-provider');

const tmp = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

describe('atualizar WhatsApp', () => {
  it('conexão viva: não reconecta', async () => {
    const provider = new BaileysProvider({}, () => {}, () => {}, tmp('p4j3-ref-'));
    let restarted = 0;
    provider._status = 'connected';
    provider._opened = true;
    provider._phoneNumber = '5511900000000';
    provider.sock = { onWhatsApp: async () => [{ exists: true }] };
    provider._startSocket = async () => { restarted += 1; };
    const res = await provider.refresh();
    assert.deepEqual(res, { healthy: true, reconnected: false, phone: '5511900000000' });
    assert.equal(restarted, 0);
  });

  it('conexão travada: troca o socket sem deslogar e espera reconectar', async () => {
    const provider = new BaileysProvider({}, () => {}, () => {}, tmp('p4j3-ref-'));
    let ended = 0;
    provider._status = 'connected';
    provider._opened = true;
    provider._phoneNumber = '5511900000000';
    // Consulta que nunca responde: o ping estoura o prazo.
    provider.sock = { onWhatsApp: () => new Promise(() => {}), end: () => { ended += 1; } };
    provider._ping = (() => { const ping = provider._ping.bind(provider); return () => ping(50); })();
    provider._startSocket = async () => {
      provider.sock = { onWhatsApp: async () => [] };
      setTimeout(() => { provider._status = 'connected'; provider._pendingDone = true; }, 20);
    };
    const res = await provider.refresh({ timeoutMs: 5000 });
    assert.equal(res.reconnected, true);
    assert.equal(ended, 1, 'socket antigo encerrado');
    assert.equal(provider.getStatus(), 'connected');
  });

  it('queda de conexão agenda reconexão, e desconectar de propósito cancela', () => {
    const statuses = [];
    const provider = new BaileysProvider({}, (s, d) => statuses.push([s, d?.reconnecting]), () => {}, tmp('p4j3-ref-'));
    provider._startSocket = async () => {};
    provider._scheduleReconnect();
    assert.equal(provider.getStatus(), 'connecting');
    assert.deepEqual(statuses[0], ['connecting', true]);
    assert.ok(provider._reconnectTimer);
    provider.disconnect();
    assert.equal(provider._reconnectTimer, null);
  });

  it('histórico traz a última resposta do lead', async () => {
    const provider = new BaileysProvider({}, () => {}, () => {}, tmp('p4j3-ref-'));
    const jid = '5511900000001@s.whatsapp.net';
    provider._chats = { [jid]: { jid, name: 'Padaria', timestamp: 300 } };
    provider._messages = {
      [jid]: [
        { key: { fromMe: true, id: 'a' }, message: { conversation: 'Oi' }, messageTimestamp: 100 },
        { key: { fromMe: false, id: 'b' }, message: { conversation: 'Oi, quem fala?' }, messageTimestamp: 200 },
        { key: { fromMe: false, id: 'c' }, message: { conversation: 'Tenho interesse' }, messageTimestamp: 300 },
      ],
    };
    const [entry] = await provider.getOutreachHistory();
    assert.equal(entry.repliedAt, 200000);
    assert.equal(entry.lastReplyAt, 300000);

    const store = new ContactStatusStore(tmp('p4j3-cs-'));
    store.importHistory([entry]);
    assert.equal(Object.values(store.getAll())[0].lastReplyAt, 300000);
  });
});

describe('resposta com horário real', () => {
  function storeWithSent(sentAt) {
    const store = new ContactStatusStore(tmp('p4j3-cs-'));
    store.importHistory([{ phone: '5511900000001', firstSentAt: sentAt, sentAt, messages: 1 }]);
    return store;
  }

  it('usa o horário da mensagem, não a hora em que foi recuperada', () => {
    const store = storeWithSent(1000);
    const entry = store.recordReply('5511900000001', { at: 5000 });
    assert.equal(entry.status, 'respondeu');
    assert.equal(entry.lastReplyAt, 5000);
  });

  it('ignora mensagem anterior ao seu primeiro envio', () => {
    const store = storeWithSent(10000);
    assert.equal(store.recordReply('5511900000001', { at: 5000 }), null);
  });

  it('a mesma resposta entregue de novo na recuperação não conta duas vezes', () => {
    const store = storeWithSent(1000);
    store.recordReply('5511900000001', { at: 5000 });
    assert.equal(store.recordReply('5511900000001', { at: 5000 }), null);
    const again = store.recordReply('5511900000001', { at: 9000 });
    assert.equal(again.replies, 2);
    assert.equal(again.lastReplyAt, 9000);
  });
});
