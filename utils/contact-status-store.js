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
    // Resultado da checagem "tem WhatsApp?" por telefone (sem DDI).
    this.waCheck = loaded.waCheck || {};
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
      fs.writeFileSync(tmp, JSON.stringify({ contacts: this.contacts, messageIndex: this.messageIndex, waCheck: this.waCheck }), { mode: 0o600 });
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

  /**
   * Importa o histórico do WhatsApp (conversas em que você mandou mensagem,
   * inclusive pelo celular). Só sobe o status; nunca rebaixa nem apaga.
   * @returns {number} quantos números mudaram
   */
  importHistory(entries = [], at = Date.now()) {
    let changed = 0;
    for (const item of entries) {
      const key = phoneCore(item?.phone);
      if (!key || key.length < 10) continue;
      const prev = this.contacts[key] || {};
      const status = item.repliedAt ? "respondeu" : "enviado";
      const keepStatus = prev.status === "descadastrado" || prev.status === "nao_contatar" || (RANK[prev.status] || 0) >= RANK[status];
      const next = {
        ...prev,
        status: keepStatus ? prev.status : status,
        firstSentAt: Math.min(prev.firstSentAt || Infinity, item.firstSentAt || item.sentAt || at),
        sentAt: Math.max(prev.sentAt || 0, item.sentAt || 0) || prev.sentAt || at,
        repliedAt: prev.repliedAt || item.repliedAt || undefined,
        messages: Math.max(Number(prev.messages) || 0, Number(item.messages) || 0),
        replies: Math.max(Number(prev.replies) || 0, Number(item.replies) || 0),
        lastEventAt: Math.max(prev.lastEventAt || 0, item.repliedAt || 0, item.sentAt || 0) || at,
        source: prev.source || "historico",
        name: prev.name || item.name || "",
      };
      if (JSON.stringify(next) === JSON.stringify(prev)) continue;
      this.contacts[key] = next;
      changed += 1;
      this._emit(key);
    }
    return changed;
  }

  /**
   * Marcação manual: "contatado" (já falei por fora), "nao_contatar"
   * (nunca prospectar) ou "limpar" (volta a disponível).
   */
  setManual(phone, mode, { name = "", at = Date.now() } = {}) {
    const key = phoneCore(phone);
    if (!key || key.length < 10) throw new Error("Telefone inválido");
    const prev = this.contacts[key] || {};
    if (mode === "limpar") {
      delete this.contacts[key];
    } else if (mode === "nao_contatar") {
      this.contacts[key] = { ...prev, status: "nao_contatar", manual: true, lastEventAt: at, name: prev.name || name };
    } else if (mode === "contatado") {
      this.contacts[key] = {
        ...prev,
        status: RANK[prev.status] ? prev.status : "enviado",
        sentAt: prev.sentAt || at,
        firstSentAt: prev.firstSentAt || at,
        messages: Math.max(1, Number(prev.messages) || 0),
        source: prev.source || "manual",
        manual: true,
        lastEventAt: at,
        name: prev.name || name,
      };
    } else {
      throw new Error("Marcação desconhecida");
    }
    this._emit(key);
    return this.contacts[key] || null;
  }

  /** Guarda o resultado de "tem WhatsApp?" ({ dígitos: true|false }). */
  recordWaCheck(map = {}, at = Date.now()) {
    const changed = {};
    for (const [phone, exists] of Object.entries(map)) {
      const key = phoneCore(phone);
      if (!key) continue;
      this.waCheck[key] = { exists: !!exists, at };
      changed[key] = this.waCheck[key];
    }
    this._scheduleSave();
    return changed;
  }

  getWaCheck() {
    return this.waCheck;
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
