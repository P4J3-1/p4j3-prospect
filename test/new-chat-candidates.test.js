const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

let buildNewChatCandidates;
before(async () => {
  ({ buildNewChatCandidates } = await import('../renderer/src/newChatCandidates.mjs'));
});

const lead = { id: 'l1', name: 'Clínica Sorriso', phone: '(11) 99999-0001' };

describe('nova conversa', () => {
  it('encontra o lead da base buscando pelo telefone formatado', () => {
    const list = buildNewChatCandidates([[], [], [], [lead]], '(11) 99999-0001');
    assert.equal(list.length, 1);
    assert.equal(list[0].name, 'Clínica Sorriso');
  });

  it('lead sem JID não recebe JID inventado sem DDI', () => {
    const [candidate] = buildNewChatCandidates([[], [], [], [lead]], '');
    assert.equal(candidate.jid, '');
    assert.equal(candidate.phone, '11999990001');
  });

  it('oferece número não salvo quando nada corresponde', () => {
    const list = buildNewChatCandidates([[], [], [], []], '(21) 98888-7777');
    assert.equal(list[0].isManual, true);
    assert.equal(list[0].phone, '(21) 98888-7777');
  });

  it('casa número com e sem DDI 55 e não duplica', () => {
    const chat = { jid: '5511999990001@s.whatsapp.net', name: 'Sorriso WA' };
    const list = buildNewChatCandidates([[chat], [], [], [lead]], '11 99999-0001');
    assert.equal(list.length, 1);
    assert.equal(list[0].jid, '5511999990001@s.whatsapp.net');
  });

  it('ignora grupos', () => {
    const list = buildNewChatCandidates([[{ jid: '123@g.us', name: 'Grupo' }]], '');
    assert.equal(list.length, 0);
  });
});
