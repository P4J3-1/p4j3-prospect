/**
 * Proteção de contato das campanhas:
 * - descadastro: quem responde "sair", "parar", "não tenho interesse"... entra
 *   numa lista global e nunca mais recebe disparo (evita denúncia = ban e
 *   atende a LGPD);
 * - follow-up: um segundo toque automático para quem não respondeu, que para
 *   sozinho na primeira resposta.
 */
const fs = require('fs');
const path = require('path');

// Frases curtas e inequívocas; na dúvida, NÃO descadastrar (falso positivo
// tiraria um lead interessado da prospecção).
const OPT_OUT_EXACT = new Set([
  'sair', 'parar', 'pare', 'stop', 'cancelar', 'descadastrar', 'remover',
  // "não" sozinho fica de fora: pode responder a uma pergunta da abordagem
  // ("vocês já têm site?" → "Não"), o que é sinal de interesse.
  'nao obrigado', 'nao obrigada', 'nao quero', 'nao tenho interesse', 'sem interesse',
]);
const OPT_OUT_CONTAINS = [
  'nao tenho interesse',
  'nao temos interesse',
  'nao quero receber',
  'nao me mande',
  'nao mande mais',
  'pare de mandar',
  'para de mandar',
  'parem de mandar',
  'me tira da lista',
  'me tire da lista',
  'remove meu numero',
  'remova meu numero',
  'tira meu numero',
  'tire meu numero',
  'descadastra',
  'descadastre',
];

function normalizeText(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isOptOutMessage(text) {
  const normalized = normalizeText(text);
  if (!normalized) return false;
  if (OPT_OUT_EXACT.has(normalized)) return true;
  return OPT_OUT_CONTAINS.some((phrase) => normalized.includes(phrase));
}

/** Texto de uma mensagem Baileys (conversa, texto estendido, legenda ou botão). */
function messageText(message) {
  const m = message?.message || {};
  const inner = m.ephemeralMessage?.message || m.viewOnceMessage?.message || m;
  return (
    inner.conversation ||
    inner.extendedTextMessage?.text ||
    inner.imageMessage?.caption ||
    inner.videoMessage?.caption ||
    inner.buttonsResponseMessage?.selectedDisplayText ||
    inner.listResponseMessage?.title ||
    ''
  );
}

/** Dígitos sem DDI 55, para casar "11999990001" com "5511999990001". */
function phoneCore(phone) {
  const digits = String(phone || '').replace(/@.*$/, '').replace(/\D/g, '');
  return digits.length >= 12 && digits.startsWith('55') ? digits.slice(2) : digits;
}

class DoNotContactStore {
  constructor(userDataPath) {
    this.filePath = path.join(userDataPath, 'do-not-contact.json');
    this.data = this._load();
  }

  _load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
      if (raw && typeof raw.phones === 'object') return raw;
    } catch {}
    return { phones: {} };
  }

  _save() {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const tmp = `${this.filePath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
      fs.renameSync(tmp, this.filePath);
    } catch (e) {
      console.log('[DO-NOT-CONTACT] save error:', e.message);
    }
  }

  has(phone) {
    const key = phoneCore(phone);
    return !!key && !!this.data.phones[key];
  }

  add(phone, reason = 'opt-out', now = Date.now()) {
    const key = phoneCore(phone);
    if (!key || this.data.phones[key]) return false;
    this.data.phones[key] = { at: now, reason: String(reason).slice(0, 200) };
    this._save();
    return true;
  }

  remove(phone) {
    const key = phoneCore(phone);
    if (!key || !this.data.phones[key]) return false;
    delete this.data.phones[key];
    this._save();
    return true;
  }

  list() {
    return Object.entries(this.data.phones).map(([phone, info]) => ({ phone, ...info }));
  }
}

const FOLLOW_UP_MIN_HOURS = 12;
const FOLLOW_UP_MAX_HOURS = 14 * 24; // replies só são atribuídos até 14 dias
const DEFAULT_FOLLOW_UP_HOURS = 48;

function normalizeFollowUp(input) {
  const src = input && typeof input === 'object' ? input : {};
  const text = String(src.text || '').slice(0, 4096);
  const hours = Number(src.afterHours);
  return {
    enabled: src.enabled === true && text.trim().length > 0,
    afterHours: Number.isFinite(hours)
      ? Math.min(FOLLOW_UP_MAX_HOURS, Math.max(FOLLOW_UP_MIN_HOURS, Math.round(hours)))
      : DEFAULT_FOLLOW_UP_HOURS,
    text,
  };
}

const FOLLOW_UP_ELIGIBLE = new Set(['sent', 'delivered', 'read']);

/**
 * Situação do follow-up de uma campanha.
 * @returns {{ due: number[], awaiting: number, nextAt: number|null }}
 */
function followUpState(campaign, now = Date.now()) {
  const fu = campaign?.followUp;
  const state = { due: [], awaiting: 0, nextAt: null };
  if (!fu?.enabled) return state;
  const waitMs = fu.afterHours * 60 * 60 * 1000;
  (campaign.leads || []).forEach((lead, index) => {
    if (lead.isGroup || lead.optedOut || lead.repliedAt || lead.followUpSentAt || lead.followUpFailedAt) return;
    if (!lead.sentAt || !FOLLOW_UP_ELIGIBLE.has(lead.status)) return;
    const dueAt = lead.sentAt + waitMs;
    if (dueAt <= now) {
      state.due.push(index);
    } else {
      state.awaiting += 1;
      state.nextAt = state.nextAt === null ? dueAt : Math.min(state.nextAt, dueAt);
    }
  });
  return state;
}

module.exports = {
  DoNotContactStore,
  DEFAULT_FOLLOW_UP_HOURS,
  followUpState,
  isOptOutMessage,
  messageText,
  normalizeFollowUp,
  phoneCore,
};
