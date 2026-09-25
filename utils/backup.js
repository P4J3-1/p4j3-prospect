/**
 * Backup diário dos dados do P4J3 em userData/backups/AAAA-MM-DD, mantendo os
 * últimos dias. A sessão do WhatsApp fica de fora de propósito: é credencial
 * de login (reconecta pelo QR) e não deve ser copiada por aí.
 */
const fs = require("fs");
const path = require("path");

const FILES = [
  "sigma-leads.json",
  "contact-status.json",
  "send-queue.json",
  "lead-triage.json",
  "lead-memory.json",
  "agents.json",
  "campaigns.json",
  "kanban.json",
  "do-not-contact.json",
  "whatsapp-daily-quota.json",
  "contact-labels.json",
  "whatsapp-settings.json",
  "desktop-preferences-v1.json",
  "lead-scoring/prospecting-leads.json",
  "lead-scoring/prospecting-groups.json",
  "lead-scoring/lead-score-settings.json",
];

function dayKey(now = Date.now()) {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function backupRoot(userDataPath) {
  return path.join(userDataPath, "backups");
}

function listBackups(userDataPath) {
  const root = backupRoot(userDataPath);
  try {
    return fs.readdirSync(root).filter((name) => /^\d{4}-\d{2}-\d{2}$/.test(name)).sort().reverse();
  } catch {
    return [];
  }
}

/** Faz (ou refaz) o backup de hoje e apaga os mais antigos que `keep` dias. */
function runBackup(userDataPath, { keep = 7, now = Date.now() } = {}) {
  const dir = path.join(backupRoot(userDataPath), dayKey(now));
  const copied = [];
  for (const rel of FILES) {
    const src = path.join(userDataPath, rel);
    if (!fs.existsSync(src)) continue;
    const dest = path.join(dir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    copied.push(rel);
  }
  for (const old of listBackups(userDataPath).slice(keep)) {
    fs.rmSync(path.join(backupRoot(userDataPath), old), { recursive: true, force: true });
  }
  return { dir, files: copied, at: now };
}

/** Já existe backup de hoje? */
function hasBackupToday(userDataPath, now = Date.now()) {
  return listBackups(userDataPath).includes(dayKey(now));
}

module.exports = { FILES, backupRoot, hasBackupToday, listBackups, runBackup };
