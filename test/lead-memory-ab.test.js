const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { LeadMemory, temperatureOf } = require('../campaigns/lead-memory');
const { SendQueue } = require('../campaigns/send-queue');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'p4j3-mem-'));

describe('memória e temperatura do lead', () => {
  it('momento lido pela IA define a temperatura; objeções acumulam sem repetir', () => {
    const mem = new LeadMemory(tmp());
    mem.recordReading('5511911112222', { momento: 'objecao', objecao: 'Está caro' });
    mem.recordReading('11911112222', { momento: 'interessado', objecao: 'Está caro' });
    const m = mem.get('11911112222');
    assert.deepEqual(m.objecoes, ['Está caro']);
    assert.equal(temperatureOf({ status: 'respondeu' }, m), 'quente');
    assert.equal(temperatureOf({ status: 'respondeu' }, null), 'morno');
    assert.equal(temperatureOf({ status: 'lido' }, null), 'frio');
    assert.equal(temperatureOf(null, null), null);
  });
});

describe('teste A/B do primeiro contato', () => {
  it('alterna até ter amostra e depois favorece a vencedora', () => {
    const q = new SendQueue(tmp());
    assert.equal(q.pickVariant(() => null), 'A');
    const drafts = [];
    for (let i = 0; i < 40; i += 1) {
      drafts.push({ phone: `119300000${String(i).padStart(2, '0')}`, message: 'x', variant: i % 2 ? 'B' : 'A', offer: 'site' });
    }
    q.add(drafts);
    q.approveAll();
    for (const item of q.items) q.markResult(item.id, { ok: true });
    // B: 8 de 20 responderam; A: 2 de 20.
    const replied = new Set(q.items.filter((i) => i.variant === 'B').slice(0, 8).map((i) => i.phoneCore)
      .concat(q.items.filter((i) => i.variant === 'A').slice(0, 2).map((i) => i.phoneCore)));
    const contactOf = (phone) => (replied.has(phone) ? { status: 'respondeu' } : { status: 'lido' });
    const stats = q.abStats(contactOf);
    assert.equal(stats.A.rate, 10);
    assert.equal(stats.B.rate, 40);
    assert.equal(stats.winner, 'B');
    assert.equal(q.pickVariant(contactOf, 0.5), 'B');
    assert.equal(q.pickVariant(contactOf, 0.95), 'A', '20% continua testando a outra');
  });
});
