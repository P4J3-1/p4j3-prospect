const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Autopilot } = require('../agents/autopilot');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'p4j3-ap-'));

describe('piloto automático', () => {
  it('desligado não roda nada; ligado roda as etapas no horário, em ordem', async () => {
    let clock = 1_000_000;
    const calls = [];
    const stages = [
      { id: 'a', agent: 'respostas', label: 'A', everyMs: 60_000, run: async () => { calls.push('a'); return { count: 2, text: 'fez A' }; } },
      { id: 'b', agent: 'triagem', label: 'B', everyMs: 600_000, run: async () => { calls.push('b'); return { idle: true, status: 'nada' }; } },
    ];
    const events = [];
    const ap = new Autopilot(tmp(), { stages, now: () => clock, onEvent: (e) => events.push(e.type) });
    await ap.tick();
    assert.deepEqual(calls, []);
    ap.updateSettings({ enabled: true });
    await ap.tick();
    assert.deepEqual(calls, ['a', 'b']);
    clock += 61_000;
    await ap.tick();
    assert.deepEqual(calls, ['a', 'b', 'a'], 'só A está no horário de novo');
    const snap = ap.snapshot();
    assert.equal(snap.stages.find((s) => s.id === 'a').today, 4);
    assert.equal(snap.stages.find((s) => s.id === 'b').live.status, 'idle');
    assert.ok(snap.feed.some((f) => f.text === 'fez A'));
    assert.ok(events.includes('live') && events.includes('state'));
  });

  it('erro numa etapa não derruba as outras', async () => {
    const calls = [];
    const stages = [
      { id: 'x', agent: 'triagem', label: 'X', everyMs: 1, run: async () => { throw new Error('boom'); } },
      { id: 'y', agent: 'analista', label: 'Y', everyMs: 1, run: async () => { calls.push('y'); } },
    ];
    const ap = new Autopilot(tmp(), { stages });
    ap.updateSettings({ enabled: true });
    await ap.tick();
    assert.deepEqual(calls, ['y']);
    assert.equal(ap.snapshot().stages[0].live.status, 'error');
  });

  it('missões em rodízio, só as ativas, e tudo persiste', () => {
    const dir = tmp();
    const ap = new Autopilot(dir, { stages: [] });
    ap.updateSettings({ missions: [
      { niche: 'dentista', city: 'Brasília, DF', neighborhoods: 'Asa Sul, Asa Norte' },
      { niche: 'pet shop', city: 'Brasília, DF', active: false },
      { niche: 'academia', city: 'Taguatinga, DF' },
      { niche: '', city: 'sem nicho' },
    ] });
    assert.equal(ap.settings.missions.length, 3);
    assert.deepEqual(ap.settings.missions[0].neighborhoods, ['Asa Sul', 'Asa Norte']);
    assert.equal(ap.nextMission().niche, 'dentista');
    assert.equal(ap.nextMission().niche, 'academia');
    assert.equal(ap.nextMission().niche, 'dentista');
    ap.setReplyDraft('61999990001', { sugestoes: ['oi'] });
    const again = new Autopilot(dir, { stages: [] });
    assert.equal(again.settings.missions.length, 3);
    assert.deepEqual(again.replyDrafts['61999990001'].sugestoes, ['oi']);
  });

  it('rodar agora funciona com o piloto pausado', async () => {
    let ran = 0;
    const ap = new Autopilot(tmp(), { stages: [{ id: 'z', agent: 'triagem', label: 'Z', everyMs: 1e9, run: async () => { ran += 1; return { text: 'ok' }; } }] });
    await ap.runNow('z');
    assert.equal(ran, 1);
    await assert.rejects(() => ap.runNow('nao-existe'));
  });
});
