const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { CampaignManager } = require('../campaigns/campaign-manager');
const { CampaignScheduler } = require('../campaigns/campaign-scheduler');

describe('campaign scheduler jitter', () => {
  it('sorteia o intervalo uma vez por envio em vez de a cada tick', async (t) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sigma-jitter-'));
    const manager = new CampaignManager(tmpDir);
    t.after(() => manager.shutdown());
    const camp = manager.create({
      name: 'Jitter',
      provider: 'baileys',
      connectionId: 'conn1',
      template: { text: 'Oi {{name}}' },
      schedule: { intervalMs: 10000 },
      leadIds: [
        { leadId: 'l1', name: 'Ana', phone: '5511999990001' },
        { leadId: 'l2', name: 'Bob', phone: '5511999990002' },
      ],
    });
    manager.store.update(camp.id, { status: 'running' });

    const sent = [];
    const provider = {
      isReady: () => true,
      sendMessage: async (dest) => {
        sent.push(dest);
        return { success: true, messageId: `m${sent.length}` };
      },
    };
    const scheduler = new CampaignScheduler(new Map([['conn1', provider]]), manager.store, null, manager);
    // Primeiro sorteio = +40%, os seguintes = 0%: o código antigo re-sortearia e enviaria cedo.
    const draws = [14000, 10000, 10000];
    scheduler._intervalWithJitter = () => draws.shift();
    scheduler._withinWorkingHours = () => true;
    scheduler.addCampaign(camp.id);

    const realNow = Date.now;
    t.after(() => { Date.now = realNow; });
    const t0 = realNow();
    Date.now = () => t0;
    await scheduler.tick();
    assert.equal(sent.length, 1);

    Date.now = () => t0 + 12000; // passou da base, mas não do intervalo sorteado
    await scheduler.tick();
    await scheduler.tick(); // um novo tick não pode re-sortear um intervalo menor
    assert.equal(sent.length, 1);

    Date.now = () => t0 + 14001;
    await scheduler.tick();
    assert.equal(sent.length, 2);
  });
});
