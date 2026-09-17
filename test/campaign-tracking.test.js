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

  it('requires explicit recovery after restart and never restarts cancelled campaigns', () => {
    const camp = makeCampaign();
    manager.update(camp.id, { status: 'running' });
    const boot = manager.interruptForRestart();
    assert.equal(boot.interruptedCount, 1);
    assert.equal(manager.get(camp.id).status, 'interrupted');
    assert.equal(manager.autoResume().requiresConfirmation, true);

    manager.update(camp.id, { status: 'cancelled' });
    assert.throws(() => manager.start(camp.id), /cancelada é terminal/i);
  });

  it('future schedules come back as scheduled and re-arm automatically', () => {
    const camp = manager.create({
      name: 'Future',
      provider: 'baileys',
      connectionId: 'c1',
      template: { text: 'Oi' },
      leadIds: [{ leadId: 'l1', name: 'Ana', phone: '5511999990001' }],
      schedule: { mode: 'scheduled', intervalMs: 30000, startAt: Date.now() + 3600000 },
    });
    manager.update(camp.id, { status: 'running' });
    const boot = manager.interruptForRestart();
    assert.equal(boot.rescheduledCount, 1);
    assert.equal(boot.interruptedCount, 0);
    assert.equal(manager.get(camp.id).status, 'scheduled');
    assert.equal(manager.rearmScheduled(), 1);
    assert.equal(manager.scheduler.activeCampaigns.has(camp.id), true);
    manager.shutdown();
  });

  it('past schedules pause as missed instead of interrupting', () => {
    const camp = manager.create({
      name: 'MissedBoot',
      provider: 'baileys',
      connectionId: 'c1',
      template: { text: 'Oi' },
      leadIds: [{ leadId: 'l1', name: 'Ana', phone: '5511999990001' }],
      schedule: { mode: 'scheduled', intervalMs: 30000, startAt: Date.now() - 3600000 },
    });
    manager.update(camp.id, { status: 'scheduled' });
    const boot = manager.interruptForRestart();
    assert.equal(boot.missedCount, 1);
    const after = manager.get(camp.id);
    assert.equal(after.status, 'paused');
    assert.equal(after.pauseReason, 'missed_schedule');
    assert.equal(manager.rearmScheduled(), 0);
    assert.equal(manager.getMissedSchedules().length, 1);
    manager.shutdown();
  });

  it('lists schedules missed while the PC was off and reschedules to tomorrow', () => {
    const past = Date.now() - 2 * 60 * 60 * 1000;
    const camp = manager.create({
      name: 'Missed',
      provider: 'baileys',
      connectionId: 'c1',
      template: { text: 'Oi {{name}}' },
      leadIds: [{ leadId: 'l1', name: 'Ana', phone: '5511999990001' }],
      schedule: { mode: 'scheduled', intervalMs: 30000, startAt: past },
    });
    manager.update(camp.id, { status: 'running' });
    const bootRecovery = manager.interruptForRestart();
    assert.equal(bootRecovery.missedCount, 1);
    assert.equal(manager.get(camp.id).status, 'paused');
    const missed = manager.getMissedSchedules();
    assert.equal(missed.length, 1);
    assert.equal(missed[0].id, camp.id);
    assert.equal(missed[0].pending, 1);

    manager.setProvidersMap(new Map([['c1', { getStatus: () => 'connected', isReady: () => true }]]));
    const res = manager.resolveMissedSchedule(camp.id, 'tomorrow', { activeConnectionId: 'c1', confirmRecovery: true });
    assert.ok(res.rescheduledTo > Date.now());
    const after = manager.get(camp.id);
    assert.equal(after.status, 'scheduled');
    assert.ok(Math.abs(after.schedule.startAt - (past + 24 * 60 * 60 * 1000)) < 5 * 60 * 1000);
    assert.equal(manager.getMissedSchedules().length, 0);
    manager.shutdown();
  });

  it('missed schedule resolved as now clears the slot and starts', () => {
    const camp = manager.create({
      name: 'MissedNow',
      provider: 'baileys',
      connectionId: 'c1',
      template: { text: 'Oi' },
      leadIds: [{ leadId: 'l1', name: 'Ana', phone: '5511999990001' }],
      schedule: { mode: 'scheduled', intervalMs: 30000, startAt: Date.now() - 3600000 },
    });
    manager.update(camp.id, { status: 'running' });
    manager.interruptForRestart();
    manager.setProvidersMap(new Map([['c1', {
      getStatus: () => 'connected',
      isReady: () => true,
      sendMessage: async () => ({ success: true, messageId: 'm1', jid: '5511999990001@s.whatsapp.net' }),
    }]]));
    const res = manager.resolveMissedSchedule(camp.id, 'now', { activeConnectionId: 'c1', confirmRecovery: true });
    assert.equal(res.status, 'running');
    const after = manager.get(camp.id);
    assert.equal(after.schedule.startAt, null);
    assert.equal(after.status, 'running');
    manager.shutdown();
  });

  it('future schedules are not listed as missed', () => {
    manager.create({
      name: 'Future',
      provider: 'baileys',
      connectionId: 'c1',
      template: { text: 'Oi' },
      leadIds: [{ leadId: 'l1', name: 'Ana', phone: '5511999990001' }],
      schedule: { mode: 'scheduled', intervalMs: 30000, startAt: Date.now() + 3600000 },
    });
    assert.equal(manager.getMissedSchedules().length, 0);
    manager.shutdown();
  });

  it('working-hours window follows the configured time zone', () => {
    const { CampaignScheduler } = require('../campaigns/campaign-scheduler');
    const scheduler = new CampaignScheduler(null, manager.store, null, manager);
    const morning = Date.UTC(2026, 0, 15, 10, 0, 0); // 07:00 em SP · 06:00 em Manaus
    const settings = { workingHoursEnabled: true, workingHoursStart: '07:00', workingHoursEnd: '18:00' };
    assert.equal(scheduler._withinWorkingHours(null, { ...settings, timeZone: 'America/Sao_Paulo' }, morning), true);
    assert.equal(scheduler._withinWorkingHours(null, { ...settings, timeZone: 'America/Manaus' }, morning), false);
    assert.equal(
      scheduler._withinWorkingHours(null, { ...settings, timeZone: 'bogus/zone' }, morning),
      scheduler._withinWorkingHours(null, settings, morning),
    );
  });
});
