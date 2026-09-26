const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { phoneCore, rekeyPhoneMap } = require('../utils/phone-key');
const { isAutoReply, isProspectingConversation } = require('../utils/outreach-classifier');
const { ContactStatusStore } = require('../utils/contact-status-store');

const tmp = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

describe('chave única de telefone', () => {
  it('WhatsApp sem o 9 e Maps com o 9 viram o mesmo número', () => {
    assert.equal(phoneCore('556194009494@s.whatsapp.net'), '61994009494');
    assert.equal(phoneCore('(61) 99400-9494'), '61994009494');
    assert.equal(phoneCore('+55 61 99400-9494'), '61994009494');
    assert.equal(phoneCore('5561994009494:3@s.whatsapp.net'), '61994009494');
  });

  it('telefone fixo não ganha 9', () => {
    assert.equal(phoneCore('556134364140'), '6134364140');
    assert.equal(phoneCore('(61) 3436-4140'), '6134364140');
  });

  it('migra chaves antigas juntando o mesmo número', () => {
    const { map, changed } = rekeyPhoneMap({ 6194009494: { a: 1 }, 61994009494: { b: 2 } }, (x, y) => ({ ...x, ...y }));
    assert.equal(changed, true);
    assert.deepEqual(map, { 61994009494: { a: 1, b: 2 } });
  });

  it('o status de contato antigo (sem o 9) passa a bater com o lead', () => {
    const dir = tmp('p4j3-dq-');
    fs.writeFileSync(path.join(dir, 'contact-status.json'), JSON.stringify({
      contacts: {
        6194009494: { status: 'respondeu', lastEventAt: 5 },
        61994009494: { status: 'enviado', lastEventAt: 3 },
      },
      messageIndex: { m1: '6194009494' },
    }));
    const store = new ContactStatusStore(dir);
    assert.equal(store.get('(61) 99400-9494').status, 'respondeu');
    assert.deepEqual(Object.keys(store.getAll()), ['61994009494']);
  });
});

describe('resposta automática', () => {
  const quick = 5000;
  it('reconhece saudações e pesquisas de WhatsApp Business', () => {
    assert.equal(isAutoReply('Seja muito bem-vindo(a) a clinica KF Odontologia 😍', quick), true);
    assert.equal(isAutoReply('Envolve Centro Estético agradece seu contato. Para te atender melhor...', quick), true);
    assert.equal(isAutoReply('Nos ajude a aprimorar nosso atendimento respondendo nossa pesquisa de satisfação', 999999), true);
    assert.equal(isAutoReply('*Seu atendimento foi iniciado*', 999999), true);
    assert.equal(isAutoReply('Olá, obgda por entrar em contato. Como posso ajudar?! 😊', quick), true);
  });

  it('não confunde gente de verdade', () => {
    assert.equal(isAutoReply('Olá, bom dia! No momento não estamos à procura desse tipo de serviço, mas agradeço', 2669000), false);
    assert.equal(isAutoReply('Bom dia, No momento não tenho interesse, mas agradeço o contato.', 696000), false);
    assert.equal(isAutoReply('Temos sim !', 11000), false);
    assert.equal(isAutoReply('comercial@clinicacotta.com.br', 140000), false);
  });
});

describe('conversa de prospecção', () => {
  const pitch = 'Olá, pessoal da Clínica X! Analisei a presença online de vocês e notei que o site não aparece no Google.';
  it('texto comercial que você começou entra; conversa pessoal não', () => {
    assert.equal(isProspectingConversation({ startedByMe: true, firstText: pitch }), true);
    assert.equal(isProspectingConversation({ startedByMe: true, firstText: 'Bom dia meu amor' }), false);
    assert.equal(isProspectingConversation({ startedByMe: false, firstText: pitch }), false);
    assert.equal(isProspectingConversation({ startedByMe: true, firstText: 'oi' }, { isKnownLead: true }), true);
  });

  it('histórico corrige "Respondeu" que era só automática e limpa conversa pessoal', () => {
    const store = new ContactStatusStore(tmp('p4j3-dq-'));
    store.importHistory([
      { phone: '5561999990001', firstSentAt: 1000, sentAt: 1000, messages: 1, repliedAt: 2000 },
      { phone: '5561999990002', firstSentAt: 1000, sentAt: 1000, messages: 1 },
    ]);
    assert.equal(store.get('61999990001').status, 'respondeu');
    // Nova leitura: a "resposta" era automática.
    store.importHistory([{ phone: '5561999990001', firstSentAt: 1000, sentAt: 1000, messages: 1, repliedAt: null, autoReplies: 1, lastAutoReplyAt: 2000 }]);
    const fixed = store.get('61999990001');
    assert.equal(fixed.status, 'entregue');
    assert.equal(fixed.repliedAt, undefined);
    assert.equal(fixed.autoReplies, 1);
    // Só o primeiro é prospecção: o segundo (pessoal) sai.
    const removed = store.pruneHistory(new Set(['61999990001']));
    assert.equal(removed, 1);
    assert.equal(store.get('61999990002'), null);
  });

  it('resposta automática ao vivo não vira "Respondeu"', () => {
    const store = new ContactStatusStore(tmp('p4j3-dq-'));
    store.importHistory([{ phone: '5561999990001', firstSentAt: 1000, sentAt: 1000, messages: 1 }]);
    const auto = store.recordReply('61999990001', { auto: true, at: 1005 });
    assert.equal(auto.status, 'entregue');
    const human = store.recordReply('61999990001', { at: 9000 });
    assert.equal(human.status, 'respondeu');
  });
});
