/**
 * Status de contato por telefone, compartilhado por todo o app: Scraper Maps,
 * Base de Leads e Kanban leem daqui e são avisados na hora em que o WhatsApp
 * confirma envio, entrega, leitura, resposta ou descadastro.
 */
const fs = require("fs");
const path = require("path");

const RANK = { enviado: 1, entregue: 2, lido: 3, respondeu: 4 };
const MAX_CONTACTS = 20000;
const MAX_MESSAGE_IDS = 50000;

function phoneCore(phone) {
  const digits = String(phone || "").replace(/@.*$/, "").replace(/\D/g, "");
  return digits.length >= 12 && digits.startsWith("55") ? digits.slice(2) : digits;
}

class ContactStatusStore {
  constructor(userDataPath, { onChange = () => {}, debounceMs = 400 } = {}) {
    this.filePath = path.join(userDataPath, "contact-status.json");
    this.onChange = onChange;
    this.debounceMs = debounceMs;
    this.timer = null;
    const loaded = this._load();
    this.contacts = loaded.contacts || {};
    this.messageIndex = loaded.messageIndex || {};
  }

  _load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.filePath, "utf-8"));
      return raw && typeof raw === "object" ? raw : {};
    } catch {
      return {};
    }
  }

  _scheduleSave() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.debounceMs);
  }

  flush() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    try {
      this._prune();
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const tmp = `${this.filePath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ contacts: this.contacts, messageIndex: this.messageIndex }), { mode: 0o600 });
      fs.renameSync(tmp, this.filePath);
    } catch (error) {
      console.warn("[CONTACT-STATUS] save:", error.message);
    }
  }

  _prune() {
    const ids = Object.keys(this.messageIndex);
    if (ids.length > MAX_MESSAGE_IDS) {
      for (const id of ids.slice(0, ids.length - MAX_MESSAGE_IDS)) delete this.messageIndex[id];
    }
    const phones = Object.keys(this.contacts);
    if (phones.length > MAX_CONTACTS) {
      phones
        .sort((a, b) => (this.contacts[a].lastEventAt || 0) - (this.contacts[b].lastEventAt || 0))
        .slice(0, phones.length - MAX_CONTACTS)
        .forEach((phone) => delete this.contacts[phone]);
    }
  }

  _emit(phone) {
    this._scheduleSave();
    try { this.onChange(phone, this.contacts[phone]); } catch { /* UI fechada */ }
  }

  get(phone) {
    return this.contacts[phoneCore(phone)] || null;
  }

  getAll() {
    return this.contacts;
  }

  /** Mensagem enviada (campanha ou conversa manual). */
  recordSent(phone, { messageId, source = "manual", campaignId = "", name = "", at = Date.now() } = {}) {
    const key = phoneCore(phone);
    if (!key || key.length < 10) return null;
    if (messageId && this.messageIndex[messageId]) return this.contacts[key] || null;
    const prev = this.contacts[key] || {};
    const next = {
      ...prev,
      status: prev.status === "descadastrado" ? "descadastrado" : (RANK[prev.status] > RANK.enviado ? prev.status : "enviado"),
      firstSentAt: prev.firstSentAt || at,
      sentAt: at,
      lastEventAt: at,
      messages: (Number(prev.messages) || 0) + 1,
      source,
      campaignId: campaignId || prev.campaignId || "",
      name: name || prev.name || "",
    };
    this.contacts[key] = next;
    if (messageId) this.messageIndex[messageId] = key;
    this._emit(key);
    return next;
  }

  /** Confirmação do WhatsApp (entregue/lido) pelo id da mensagem. */
  recordReceipt(messageId, receipt, at = Date.now()) {
    const key = this.messageIndex[messageId];
    const prev = key && this.contacts[key];
    if (!prev) return null;
    const status = receipt === "read" ? "lido" : receipt === "delivered" ? "entregue" : null;
    if (!status || prev.status === "descadastrado" || (RANK[prev.status] || 0) >= RANK[status]) return null;
    this.contacts[key] = {
      ...prev,
      status,
      [status === "lido" ? "readAt" : "deliveredAt"]: at,
      lastEventAt: at,
    };
    this._emit(key);
    return this.contacts[key];
  }

  /** Resposta do lead. Só conta para números que já contatamos. */
  recordReply(phone, { optOut = false, at = Date.now() } = {}) {
    const key = phoneCore(phone);
    const prev = key && this.contacts[key];
    if (!prev) return null;
    const next = {
      ...prev,
      status: optOut || prev.status === "descadastrado" ? "descadastrado" : "respondeu",
      repliedAt: prev.repliedAt || at,
      lastReplyAt: at,
      lastEventAt: at,
      replies: (Number(prev.replies) || 0) + 1,
    };
    this.contacts[key] = next;
    this._emit(key);
    return next;
  }
}

module.exports = { ContactStatusStore, phoneCore };
