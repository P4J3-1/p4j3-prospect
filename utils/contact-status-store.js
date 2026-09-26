/**
 * Status de contato por telefone, compartilhado por todo o app: Hunter Maps,
 * Base de Leads e Kanban leem daqui e são avisados na hora em que o WhatsApp
 * confirma envio, entrega, leitura, resposta ou descadastro.
 */
const fs = require("fs");
const path = require("path");

const RANK = { enviado: 1, entregue: 2, lido: 3, respondeu: 4 };
const MAX_CONTACTS = 20000;
const MAX_MESSAGE_IDS = 50000;

const { phoneCore, rekeyPhoneMap } = require("./phone-key");

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
    this._migrateKeys();
  }

  _load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.filePath, "utf-8"));
      return raw && typeof raw === "object" ? raw : {};
    } catch {
      return {};
    }
  }

  /** Números gravados sem o 9 viram a chave atual; o mesmo lead em dois formatos vira um só. */
  _migrateKeys() {
    const later = (a, b) => (b?.lastEventAt || 0) > (a?.lastEventAt || 0);
    const contacts = rekeyPhoneMap(this.contacts, (a, b) => {
      const keep = (RANK[b.status] || (b.status ? 9 : 0)) > (RANK[a.status] || (a.status ? 9 : 0)) ? b : a;
      const other = keep === a ? b : a;
      return {
        ...other,
        ...keep,
        firstSentAt: Math.min(a.firstSentAt || Infinity, b.firstSentAt || Infinity) === Infinity ? undefined : Math.min(a.firstSentAt || Infinity, b.firstSentAt || Infinity),
        sentAt: Math.max(a.sentAt || 0, b.sentAt || 0) || undefined,
        messages: Math.max(Number(a.messages) || 0, Number(b.messages) || 0),
        lastEventAt: Math.max(a.lastEventAt || 0, b.lastEventAt || 0) || undefined,
      };
    });
    const waCheck = rekeyPhoneMap(this.waCheck, (a, b) => (later(a, b) ? b : a));
    let indexChanged = false;
    for (const [id, key] of Object.entries(this.messageIndex)) {
      const next = phoneCore(key);
      if (next && next !== key) {
        this.messageIndex[id] = next;
        indexChanged = true;
      }
    }
    if (contacts.changed || waCheck.changed || indexChanged) {
      this.contacts = contacts.map;
      this.waCheck = waCheck.map;
      this.flush();
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
  recordSent(phone, { messageId, source = "manual", campaignId = "", name = "", connectionId = "", at = Date.now() } = {}) {
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
      // Número que falou com o lead: follow-ups continuam por ele.
      connectionId: connectionId || prev.connectionId || "",
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
      // Histórico que já separa resposta automática da humana manda na resposta:
      // corrige quem virou "Respondeu" só por causa da saudação automática.
      const authoritative = item.autoReplies !== undefined;
      const blocked = prev.status === "descadastrado" || prev.status === "nao_contatar";
      let status;
      if (blocked) status = prev.status;
      else if (item.repliedAt) status = "respondeu";
      else if (authoritative && prev.status === "respondeu") status = item.autoReplies ? "entregue" : "enviado";
      else status = (RANK[prev.status] || 0) >= RANK.enviado ? prev.status : "enviado";
      const replyFields = authoritative
        ? {
            repliedAt: item.repliedAt || undefined,
            lastReplyAt: item.lastReplyAt || item.repliedAt || undefined,
            replies: Number(item.replies) || 0,
            autoReplies: Number(item.autoReplies) || 0,
            lastAutoReplyAt: item.lastAutoReplyAt || undefined,
          }
        : {
            repliedAt: prev.repliedAt || item.repliedAt || undefined,
            lastReplyAt: Math.max(prev.lastReplyAt || 0, item.lastReplyAt || item.repliedAt || 0) || undefined,
            replies: Math.max(Number(prev.replies) || 0, Number(item.replies) || 0),
          };
      const next = {
        ...prev,
        status,
        firstSentAt: Math.min(prev.firstSentAt || Infinity, item.firstSentAt || item.sentAt || at),
        sentAt: Math.max(prev.sentAt || 0, item.sentAt || 0) || prev.sentAt || at,
        ...replyFields,
        messages: Math.max(Number(prev.messages) || 0, Number(item.messages) || 0),
        lastEventAt: Math.max(prev.lastEventAt || 0, item.repliedAt || 0, item.sentAt || 0) || at,
        source: prev.source || "historico",
        name: prev.name || item.name || "",
      };
      for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
      if (JSON.stringify(next) === JSON.stringify(prev)) continue;
      this.contacts[key] = next;
      changed += 1;
      this._emit(key);
    }
    return changed;
  }

  /**
   * Tira do controle de contatados o que veio só do histórico e não é
   * prospecção (conversa pessoal). Marcações manuais e bloqueios ficam.
   */
  pruneHistory(keepKeys) {
    let removed = 0;
    for (const [key, entry] of Object.entries(this.contacts)) {
      // "manual" sem a marca manual = mensagem digitada no chat (versões antigas).
      const fromHistoryOrChat = entry?.source === "historico" || entry?.source === "chat" || entry?.source === "manual";
      if (!fromHistoryOrChat || entry.manual) continue;
      if (entry.status === "nao_contatar" || entry.status === "descadastrado") continue;
      if (keepKeys.has(key)) continue;
      delete this.contacts[key];
      removed += 1;
      this._emit(key);
    }
    return removed;
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
  recordReply(phone, { optOut = false, auto = false, at = Date.now() } = {}) {
    const key = phoneCore(phone);
    const prev = key && this.contacts[key];
    if (!prev) return null;
    // Mensagem anterior ao seu primeiro envio não é resposta à prospecção.
    if (prev.firstSentAt && at < prev.firstSentAt) return null;
    // Resposta automática só prova que chegou; não é conversa.
    if (auto && !optOut) {
      const next = {
        ...prev,
        status: (RANK[prev.status] || 0) < RANK.entregue && RANK[prev.status] ? "entregue" : prev.status,
        autoReplies: (Number(prev.autoReplies) || 0) + 1,
        lastAutoReplyAt: Math.max(prev.lastAutoReplyAt || 0, at),
        lastEventAt: Math.max(prev.lastEventAt || 0, at),
      };
      this.contacts[key] = next;
      this._emit(key);
      return next;
    }
    // A mesma mensagem pode chegar de novo na recuperação após reconectar.
    if (prev.lastReplyAt && at <= prev.lastReplyAt && prev.status === "respondeu") return null;
    const next = {
      ...prev,
      status: optOut || prev.status === "descadastrado" ? "descadastrado" : "respondeu",
      repliedAt: prev.repliedAt || at,
      lastReplyAt: Math.max(prev.lastReplyAt || 0, at),
      lastEventAt: Math.max(prev.lastEventAt || 0, at),
      replies: (Number(prev.replies) || 0) + 1,
    };
    this.contacts[key] = next;
    this._emit(key);
    return next;
  }
}

module.exports = { ContactStatusStore, phoneCore };
