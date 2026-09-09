const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { CampaignManager } = require('../campaigns/campaign-manager');

describe('campaign tracking', () => {
  let tmpDir;
  let manager;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sigma-camp-'));
    manager = new CampaignManager(tmpDir);
  });

  function makeCampaign() {
    return manager.create({
      name: 'Test',
      provider: 'baileys',
      connectionId: 'conn1',
      template: { text: 'Oi {{name}}' },
      leadIds: [
        { leadId: 'l1', name: 'Ana', phone: '5511999990001' },
        { leadId: 'l2', name: 'Bob', phone: '5511999990002' },
      ],
    });
  }

  it('tracks delivered → read → open and stats', () => {
    const camp = makeCampaign();
    const lead = camp.leads[0];
    lead.status = 'sent';
    lead.sentAt = Date.now() - 60000;
    lead.messageId = 'msg_abc';
    manager.store.update(camp.id, { leads: camp.leads });
    manager.registerMessageId(camp.id, 0, 'msg_abc');

    const d = manager.trackMessageStatus('msg_abc', 'delivered');
    assert.ok(d);
    assert.equal(d.status, 'delivered');

    const r = manager.trackMessageStatus('msg_abc', 'read');
    assert.ok(r);
    const updated = manager.get(camp.id);
    assert.equal(updated.leads[0].status, 'read');
    assert.ok(updated.leads[0].readAt);
    assert.ok(updated.leads[0].openedAt);
    assert.equal(updated.leads[0].openCount, 1);
    assert.equal(updated.stats.read, 1);
    assert.equal(updated.stats.opened, 1);
    assert.equal(updated.stats.openCount, 1);
  });

  it('tracks first and subsequent replies with hour data', () => {
    const camp = makeCampaign();
    const lead = camp.leads[0];
    lead.status = 'sent';
    lead.sentAt = Date.now() - 120000;
    lead.messageId = 'msg_r1';
    manager.store.update(camp.id, { leads: camp.leads });
    manager._rebuildPhoneIndex();

    const jid = '5511999990001@s.whatsapp.net';
    const first = manager.trackIncomingMessage(jid, { key: { fromMe: false } }, 'conn1');
    assert.ok(first);
    assert.equal(first.replyCount, 1);

    let updated = manager.get(camp.id);
    assert.equal(updated.leads[0].status, 'replied');
    assert.equal(updated.leads[0].replyCount, 1);
    assert.ok(updated.leads[0].responseTimeMs >= 0);
    assert.equal(updated.stats.replied, 1);
    assert.equal(updated.stats.replyCount, 1);

    const second = manager.trackIncomingMessage(jid, { key: { fromMe: false } }, 'conn1');
    assert.ok(second);
    assert.equal(second.replyCount, 2);
    updated = manager.get(camp.id);
    assert.equal(updated.leads[0].replyCount, 2);
    assert.equal(updated.stats.replyCount, 2);
    assert.ok(updated.stats.avgReplyHour != null || updated.stats.replyHourHistogram.some((n) => n > 0));
  });

  it('ignores reply on wrong connectionId', () => {
    const camp = makeCampaign();
    camp.leads[0].status = 'sent';
    camp.leads[0].sentAt = Date.now() - 1000;
    manager.store.update(camp.id, { leads: camp.leads });
    manager._rebuildPhoneIndex();

    const r = manager.trackIncomingMessage(
      '5511999990001@s.whatsapp.net',
      { key: { fromMe: false } },
      'other_conn'
    );
    assert.equal(r, null);
    assert.equal(manager.get(camp.id).leads[0].status, 'sent');
  });

  it('trackConversationOpen increments openCount with debounce', () => {
    const camp = makeCampaign();
    camp.leads[0].status = 'delivered';
    camp.leads[0].sentAt = Date.now() - 5000;
    manager.store.update(camp.id, { leads: camp.leads });
    manager._rebuildPhoneIndex();

    const a = manager.trackConversationOpen('5511999990001@s.whatsapp.net', 'conn1');
    assert.ok(a);
    assert.equal(a.openCount, 1);

    // Immediate second open should be debounced
    const b = manager.trackConversationOpen('5511999990001@s.whatsapp.net', 'conn1');
    assert.equal(b, null);
    assert.equal(manager.get(camp.id).leads[0].openCount, 1);
  });

  it('keeps an offline campaign as a draft and persists Kanban stages', () => {
    const camp = manager.create({
      name: 'Rascunho offline',
      provider: 'baileys',
      connectionId: null,
      connectionIds: [],
      template: { text: 'Oi {{name}}' },
      leadIds: [
        { leadId: 'l1', name: 'Ana', phone: '5511999990001' },
        { leadId: 'l2', name: 'Bob', phone: '5511999990002', status: 'replied' },
      ],
    });

    assert.equal(camp.connectionId, null);
    assert.deepEqual(camp.connectionIds, []);
    assert.equal(camp.status, 'ready');
    assert.equal(camp.leads[0].kanbanStage, 'new');
    assert.equal(camp.leads[1].kanbanStage, 'conversation');

    manager.update(camp.id, {
      leads: camp.leads.map((lead) => lead.leadId === 'l1'
        ? { ...lead, kanbanStage: 'finished', kanbanOrder: 4 }
        : lead),
    });
    const reloaded = new CampaignManager(tmpDir).get(camp.id);
    assert.equal(reloaded.leads[0].kanbanStage, 'finished');
    assert.equal(reloaded.leads[0].kanbanOrder, 4);

    // A edição da lista não envia campos do Kanban: não pode desfazer a etapa.
    manager.update(camp.id, {
      leads: manager.get(camp.id).leads.map(({ kanbanStage, kanbanOrder, ...lead }) => lead),
    });
    const afterListEdit = manager.get(camp.id);
    assert.equal(afterListEdit.leads[0].kanbanStage, 'finished');
    assert.equal(afterListEdit.leads[0].kanbanOrder, 4);
  });
});
