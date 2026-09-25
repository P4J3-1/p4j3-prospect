const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { isOptOutMessage, messageText, normalizeFollowUp, phoneCore } = require('../campaigns/contact-guard');
const { CampaignManager } = require('../campaigns/campaign-manager');
const { CampaignScheduler } = require('../campaigns/campaign-scheduler');

describe('descadastro', () => {
  it('reconhece pedidos claros de saída', () => {
    for (const text of ['SAIR', 'Parar', 'Não tenho interesse, obrigado', 'por favor me tira da lista', 'Não, obrigado!']) {
      assert.equal(isOptOutMessage(text), true, text);
    }
  });

  it('não descadastra respostas ambíguas ou interessadas', () => {
    for (const text of ['Não', 'Oi, quanto custa?', 'não temos site ainda', 'pode mandar', 'Parabéns pelo trabalho']) {
      assert.equal(isOptOutMessage(text), false, text);
    }
  });

  it('extrai texto de mensagens Baileys', () => {
    assert.equal(messageText({ message: { conversation: 'sair' } }), 'sair');
    assert.equal(messageText({ message: { extendedTextMessage: { text: 'parar' } } }), 'parar');
    assert.equal(messageText({ message: { ephemeralMessage: { message: { conversation: 'stop' } } } }), 'stop');
  });

  it('normaliza número com e sem DDI', () => {
    assert.equal(phoneCore('5511999990001@s.whatsapp.net'), '11999990001');
    assert.equal(phoneCore('(11) 99999-0001'), '11999990001');
  });

  it('follow-up exige texto e limita o prazo', () => {
    assert.equal(normalizeFollowUp({ enabled: true, text: '' }).enabled, false);
    assert.equal(normalizeFollowUp({ enabled: true, text: 'oi', afterHours: 1 }).afterHours, 12);
    assert.equal(normalizeFollowUp({ enabled: true, text: 'oi', afterHours: 9999 }).afterHours, 336);
  });
});

describe('campanha com follow-up e descadastro', () => {
  function setup(t) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sigma-guard-'));
    const manager = new CampaignManager(tmpDir);
    t.after(() => manager.shutdown());
    const sent = [];
    const provider = {
      isReady: () => true,
      sendMessage: async (dest, content) => {
        sent.push({ dest, text: content.text });
        return { success: true, messageId: `m${sent.length}`, jid: `${String(dest).replace(/\D/g, '')}@s.whatsapp.net` };
      },
    };
    const scheduler = new CampaignScheduler(new Map([['conn1', provider]]), manager.store, null, manager);
    scheduler._withinWorkingHours = () => true;
    scheduler._intervalWithJitter = (base) => base;
    const realNow = Date.now;
    t.after(() => { Date.now = realNow; });
    let clock = realNow();
    Date.now = () => clock;
    return { manager, scheduler, sent, tick: async (advanceMs = 0) => { clock += advanceMs; await scheduler.tick(); }, now: () => clock };
  }

  it('envia follow-up só para quem não respondeu e depois conclui', async (t) => {
    const { manager, scheduler, sent, tick } = setup(t);
    const camp = manager.create({
      name: 'FU', provider: 'baileys', connectionId: 'conn1',
      template: { text: 'Oi {{nome}}' },
      followUp: { enabled: true, afterHours: 48, text: 'Conseguiu ver, {{nome}}?' },
      schedule: { intervalMs: 5000 },
      leadIds: [
        { leadId: 'a', name: 'Ana', phone: '5511999990001' },
        { leadId: 'b', name: 'Bia', phone: '5511999990002' },
      ],
    });
    manager.store.update(camp.id, { status: 'running' });
    scheduler.addCampaign(camp.id);

    await tick();
    await tick(6000);
    assert.equal(sent.length, 2);

    // Ana responde; Bia não.
    manager.trackIncomingMessage('5511999990001@s.whatsapp.net', { message: { conversation: 'Oi, pode falar' } }, 'conn1');

    await tick(60 * 60 * 1000); // ainda antes das 48h
    assert.equal(sent.length, 2);
    assert.equal(manager.get(camp.id).waitReason, 'follow_up');

    await tick(48 * 60 * 60 * 1000);
    assert.equal(sent.length, 3);
    assert.equal(sent[2].text, 'Conseguiu ver, Bia?');

    await tick(6000);
    const done = manager.get(camp.id);
    assert.equal(done.status, 'completed');
    assert.equal(done.stats.followUpsSent, 1);
  });

  it('quem pede para sair não recebe follow-up nem novas campanhas', async (t) => {
    const { manager, scheduler, sent, tick } = setup(t);
    const first = manager.create({
      name: 'C1', provider: 'baileys', connectionId: 'conn1',
      template: { text: 'Oi' },
      followUp: { enabled: true, afterHours: 12, text: 'E aí?' },
      schedule: { intervalMs: 5000 },
      leadIds: [{ leadId: 'a', name: 'Ana', phone: '5511999990001' }],
    });
    manager.store.update(first.id, { status: 'running' });
    scheduler.addCampaign(first.id);
    await tick();
    manager.trackIncomingMessage('5511999990001@s.whatsapp.net', { message: { conversation: 'Não tenho interesse' } }, 'conn1');
    assert.equal(manager.doNotContact.has('11999990001'), true);

    await tick(13 * 60 * 60 * 1000);
    assert.equal(sent.length, 1, 'sem follow-up após descadastro');

    const second = manager.create({
      name: 'C2', provider: 'baileys', connectionId: 'conn1',
      template: { text: 'Promo' },
      schedule: { intervalMs: 5000 },
      leadIds: [
        { leadId: 'a2', name: 'Ana', phone: '(11) 99999-0001' },
        { leadId: 'c', name: 'Caio', phone: '5511999990003' },
      ],
    });
    manager.store.update(second.id, { status: 'running' });
    scheduler.addCampaign(second.id);
    await tick(6000);
    await tick(6000);
    assert.deepEqual(sent.slice(1).map((m) => m.text), ['Promo']);
    const c2 = manager.get(second.id);
    assert.equal(c2.leads[0].status, 'skipped');
    assert.equal(c2.stats.skipped, 1);
  });
});
