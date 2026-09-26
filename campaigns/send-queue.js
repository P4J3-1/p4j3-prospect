/**
 * Fila de envio com aprovação: a IA prepara 24/7 (rascunho), você aprova, e o
 * envio sai no ritmo seguro de um número só, dentro da janela de horário.
 * Quem não responde entra de novo na fila como follow-up e, depois, com a
 * próxima oferta da escada — sempre esperando a sua aprovação.
 */
const fs = require("fs");
const path = require("path");

const ACTIVE = new Set(["rascunho", "aprovado", "enviando"]);
const DEFAULT_SETTINGS = {
  windowEnabled: true,
  windowStart: "08:00",
  windowEnd: "20:00",
  intervalSec: 120, // mínimo entre envios; +0–40% de variação aleatória
  followUpDays: 2,
  newOfferDays: 7,
  dailyGoal: 40, // meta de envios por dia (painel "Hoje")
  perNumberDaily: 40, // teto de envios por número de WhatsApp por dia (rodízio)
};

const AB_MIN_SAMPLE = 20;
const AB_MIN_LIFT = 3; // pontos percentuais
const MAX_ITEMS = 5000;

const { phoneCore } = require("../utils/phone-key");

function minutesOf(hhmm) {
  const [h, m] = String(hhmm || "").split(":").map(Number);
  return Number.isFinite(h) ? h * 60 + (Number.isFinite(m) ? m : 0) : null;
}

/** Dentro da janela de envio? (suporta janela que vira a meia-noite) */
function withinWindow(settings, date = new Date()) {
  if (!settings.windowEnabled) return true;
  const start = minutesOf(settings.windowStart);
  const end = minutesOf(settings.windowEnd);
  if (start === null || end === null || start === end) return true;
  const now = date.getHours() * 60 + date.getMinutes();
  return start < end ? now >= start && now < end : now >= start || now < end;
}

class SendQueue {
  constructor(userDataPath, { onChange = () => {} } = {}) {
    this.filePath = path.join(userDataPath, "send-queue.json");
    this.onChange = onChange;
    let raw = {};
    try {
      raw = JSON.parse(fs.readFileSync(this.filePath, "utf-8")) || {};
    } catch { /* primeira execução */ }
    this.items = Array.isArray(raw.items) ? raw.items : [];
    this.settings = { ...DEFAULT_SETTINGS, ...(raw.settings || {}) };
    this.lastSentAt = Number(raw.lastSentAt) || 0;
    this.nextGapMs = Number(raw.nextGapMs) || 0;
    // Um envio interrompido (app fechou no meio) volta para aprovado.
    for (const item of this.items) if (item.status === "enviando") item.status = "aprovado";
    for (const item of this.items) item.phoneCore = phoneCore(item.phone || item.phoneCore);
  }

  save() {
    try {
      if (this.items.length > MAX_ITEMS) {
        const keep = this.items.filter((i) => ACTIVE.has(i.status));
        const done = this.items.filter((i) => !ACTIVE.has(i.status)).slice(-(MAX_ITEMS - keep.length));
        this.items = [...done, ...keep];
      }
      const tmp = `${this.filePath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ items: this.items, settings: this.settings, lastSentAt: this.lastSentAt, nextGapMs: this.nextGapMs }), { mode: 0o600 });
      fs.renameSync(tmp, this.filePath);
    } catch (error) {
      console.warn("[FILA] save:", error.message);
    }
    try { this.onChange(this.snapshot()); } catch { /* UI fechada */ }
  }

  snapshot() {
    return { items: this.items, settings: this.settings, lastSentAt: this.lastSentAt };
  }

  activeFor(phone, kind = null) {
    const key = phoneCore(phone);
    return this.items.find((i) => i.phoneCore === key && ACTIVE.has(i.status) && (!kind || i.kind === kind)) || null;
  }

  historyFor(phone) {
    const key = phoneCore(phone);
    return this.items.filter((i) => i.phoneCore === key);
  }

  /** Adiciona rascunhos; ignora quem já tem um item ativo do mesmo tipo. */
  add(drafts = [], now = Date.now()) {
    const added = [];
    for (const d of drafts) {
      const key = phoneCore(d.phone);
      if (!key || key.length < 10 || this.activeFor(key, d.kind)) continue;
      const item = {
        id: `q_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        phone: String(d.phone),
        phoneCore: key,
        kind: d.kind || "primeiro",
        offer: d.offer || "",
        previousOffer: d.previousOffer || "",
        name: String(d.name || "").slice(0, 160),
        lead: d.lead || {},
        message: String(d.message || "").slice(0, 1000),
        variant: d.variant === "B" ? "B" : d.variant === "A" ? "A" : "",
        opener: Number.isInteger(d.opener) ? d.opener : null,
        ai: !!d.ai,
        reason: String(d.reason || "").slice(0, 300),
        status: "rascunho",
        createdAt: now,
      };
      this.items.push(item);
      added.push(item);
    }
    if (added.length) this.save();
    return added;
  }

  update(id, patch = {}, now = Date.now()) {
    const item = this.items.find((i) => i.id === id);
    if (!item) throw new Error("Item da fila não encontrado.");
    if (typeof patch.message === "string") item.message = patch.message.slice(0, 1000);
    if (patch.status === "aprovado" && item.status === "rascunho") {
      if (!item.message.trim()) throw new Error("Escreva a mensagem antes de aprovar.");
      item.status = "aprovado";
      item.approvedAt = now;
    } else if (patch.status === "rascunho" && item.status === "aprovado") {
      item.status = "rascunho";
    } else if (patch.status === "pulado" && ACTIVE.has(item.status) && item.status !== "enviando") {
      item.status = "pulado";
      item.skippedAt = now;
    }
    this.save();
    return item;
  }

  approveAll(ids = null, now = Date.now()) {
    let count = 0;
    for (const item of this.items) {
      if (item.status !== "rascunho" || !item.message.trim()) continue;
      if (Array.isArray(ids) && !ids.includes(item.id)) continue;
      item.status = "aprovado";
      item.approvedAt = now;
      count += 1;
    }
    if (count) this.save();
    return count;
  }

  /** Envios de hoje por número (rodízio). */
  sentTodayBy(connectionId, now = Date.now()) {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return this.items.filter((i) => i.status === "enviado" && i.connectionId === connectionId && (i.sentAt || 0) >= start.getTime()).length;
  }

  /**
   * Qual número envia: o mesmo que já falou com o lead (a conversa continua
   * nele); senão o conectado com menos envios hoje, abaixo do teto diário.
   * @param {string[]} connected ids conectados
   * @param {string} [sticky] número que já conversou com o lead
   */
  pickSender(connected, sticky = "", now = Date.now()) {
    const cap = this.settings.perNumberDaily || 40;
    const room = (id) => cap - this.sentTodayBy(id, now);
    if (sticky && connected.includes(sticky)) return room(sticky) > 0 ? sticky : null;
    const ranked = connected.filter((id) => room(id) > 0).sort((a, b) => room(b) - room(a));
    return ranked[0] || null;
  }

  updateSettings(patch = {}) {
    const next = { ...this.settings };
    if (typeof patch.windowEnabled === "boolean") next.windowEnabled = patch.windowEnabled;
    for (const key of ["windowStart", "windowEnd"]) {
      if (/^\d{2}:\d{2}$/.test(String(patch[key] || ""))) next[key] = patch[key];
    }
    if (patch.intervalSec !== undefined) next.intervalSec = Math.max(30, Math.min(3600, Math.round(Number(patch.intervalSec) || 120)));
    if (patch.followUpDays !== undefined) next.followUpDays = Math.max(1, Math.min(30, Math.round(Number(patch.followUpDays) || 3)));
    if (patch.newOfferDays !== undefined) next.newOfferDays = Math.max(1, Math.min(60, Math.round(Number(patch.newOfferDays) || 7)));
    if (patch.dailyGoal !== undefined) next.dailyGoal = Math.max(1, Math.min(1000, Math.round(Number(patch.dailyGoal) || 40)));
    if (patch.perNumberDaily !== undefined) next.perNumberDaily = Math.max(1, Math.min(300, Math.round(Number(patch.perNumberDaily) || 40)));
    this.settings = next;
    this.save();
    return next;
  }

  /**
   * Próximo item a enviar agora, ou o motivo de estar esperando.
   * @returns {{item?:object, wait?:string}}
   */
  nextToSend(now = Date.now(), date = new Date(now)) {
    const item = this.items.find((i) => i.status === "aprovado");
    if (!item) return { wait: "vazia" };
    if (!withinWindow(this.settings, date)) return { wait: "fora_do_horario" };
    const gap = this.nextGapMs || this.settings.intervalSec * 1000;
    if (this.lastSentAt && now - this.lastSentAt < gap) return { wait: "intervalo" };
    return { item };
  }

  markSending(id) {
    const item = this.items.find((i) => i.id === id);
    if (item) item.status = "enviando";
    this.save();
  }

  markResult(id, { ok, messageId = "", error = "", skipReason = "", connectionId = "" }, now = Date.now()) {
    const item = this.items.find((i) => i.id === id);
    if (!item) return null;
    if (skipReason) {
      item.status = "pulado";
      item.error = skipReason;
    } else if (ok) {
      item.status = "enviado";
      item.sentAt = now;
      item.messageId = messageId;
      if (connectionId) item.connectionId = connectionId;
      this.lastSentAt = now;
      this.nextGapMs = Math.round(this.settings.intervalSec * 1000 * (1 + Math.random() * 0.4));
    } else {
      item.status = "falhou";
      item.error = String(error || "Falha no envio").slice(0, 300);
    }
    this.save();
    return item;
  }

  /**
   * Teste A/B do primeiro contato: A = pergunta de permissão, B = diagnóstico
   * gratuito (presente de valor). Vencedor só com amostra mínima e diferença clara.
   */
  abStats(contactOf) {
    const stats = { A: { sent: 0, replied: 0, rate: 0 }, B: { sent: 0, replied: 0, rate: 0 }, winner: "" };
    for (const item of this.items) {
      if (item.kind !== "primeiro" || item.status !== "enviado" || !stats[item.variant]) continue;
      stats[item.variant].sent += 1;
      const contact = contactOf(item.phoneCore);
      if (contact?.status === "respondeu" || (contact?.repliedAt && contact.repliedAt > (item.sentAt || 0))) stats[item.variant].replied += 1;
    }
    for (const v of ["A", "B"]) stats[v].rate = stats[v].sent ? Math.round((stats[v].replied / stats[v].sent) * 1000) / 10 : 0;
    if (stats.A.sent >= AB_MIN_SAMPLE && stats.B.sent >= AB_MIN_SAMPLE && Math.abs(stats.A.rate - stats.B.rate) >= AB_MIN_LIFT) {
      stats.winner = stats.A.rate > stats.B.rate ? "A" : "B";
    }
    return stats;
  }

  /** Variante para o próximo rascunho: alterna até haver vencedor; depois 80/20. */
  pickVariant(contactOf, random = Math.random()) {
    const stats = this.abStats(contactOf);
    if (stats.winner) return random < 0.8 ? stats.winner : stats.winner === "A" ? "B" : "A";
    const pending = this.items.filter((i) => i.kind === "primeiro" && i.variant);
    const a = pending.filter((i) => i.variant === "A").length;
    const b = pending.length - a;
    return a <= b ? "A" : "B";
  }

  /**
   * Recontato: quem recebeu o primeiro contato e não respondeu ganha um
   * follow-up; quem também não respondeu ao follow-up ganha a próxima oferta.
   * @param {(phoneCore:string)=>object|null} contactOf status de contato atual
   * @returns {Array<{kind:string, base:object}>} o que precisa ser redigido
   */
  planRecontacts(contactOf, now = Date.now()) {
    const day = 24 * 60 * 60 * 1000;
    const plans = [];
    const byPhone = new Map();
    for (const item of this.items) {
      if (!byPhone.has(item.phoneCore)) byPhone.set(item.phoneCore, []);
      byPhone.get(item.phoneCore).push(item);
    }
    for (const [phone, list] of byPhone) {
      if (list.some((i) => ACTIVE.has(i.status))) continue;
      const contact = contactOf(phone);
      if (contact && ["respondeu", "descadastrado", "nao_contatar"].includes(contact.status)) continue;
      const sent = list.filter((i) => i.status === "enviado").sort((a, b) => (b.sentAt || 0) - (a.sentAt || 0));
      const last = sent[0];
      if (!last) continue;
      if (last.kind === "primeiro" && now - last.sentAt >= this.settings.followUpDays * day) {
        plans.push({ kind: "follow_up", base: last });
      } else if (last.kind === "follow_up" && now - last.sentAt >= this.settings.newOfferDays * day) {
        plans.push({ kind: "nova_oferta", base: last, tried: [...new Set(list.map((i) => i.offer).filter(Boolean))] });
      } else if (last.kind === "nova_oferta" && now - last.sentAt >= this.settings.newOfferDays * day) {
        // Mais uma oferta da escada, se ainda houver; senão o lead descansa.
        plans.push({ kind: "nova_oferta", base: last, tried: [...new Set(list.map((i) => i.offer).filter(Boolean))] });
      }
    }
    return plans;
  }
}

module.exports = { DEFAULT_SETTINGS, SendQueue, withinWindow, phoneCore };
