const { it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runBackup, listBackups, hasBackupToday } = require('../utils/backup');

it('backup diário copia os dados, ignora a sessão do WhatsApp e mantém 7 dias', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p4j3-bk-'));
  fs.writeFileSync(path.join(dir, 'sigma-leads.json'), '[1]');
  fs.mkdirSync(path.join(dir, 'lead-scoring'));
  fs.writeFileSync(path.join(dir, 'lead-scoring', 'lead-score-settings.json'), '{}');
  fs.mkdirSync(path.join(dir, 'whatsapp-sessions'));
  fs.writeFileSync(path.join(dir, 'whatsapp-sessions', 'creds.json'), 'secreto');
  const day = 24 * 60 * 60 * 1000;
  const t0 = new Date(2026, 8, 1, 12).getTime();
  for (let i = 0; i < 9; i += 1) runBackup(dir, { now: t0 + i * day });
  const backups = listBackups(dir);
  assert.equal(backups.length, 7);
  assert.equal(backups[0], '2026-09-09');
  const latest = path.join(dir, 'backups', backups[0]);
  assert.equal(fs.readFileSync(path.join(latest, 'sigma-leads.json'), 'utf8'), '[1]');
  assert.ok(fs.existsSync(path.join(latest, 'lead-scoring', 'lead-score-settings.json')));
  assert.ok(!fs.existsSync(path.join(latest, 'whatsapp-sessions')));
  assert.equal(hasBackupToday(dir, t0 + 8 * day), true);
});
