/**
 * Raio-X do WhatsApp: o que acontece com cada mensagem de prospecção.
 * Funil (enviado → entregue → lido → respondeu), qual abertura mais gera
 * resposta, tempo até a resposta e os horários que funcionam.
 */
const { OPENERS } = require("../agents/sales-playbook");
const { phoneCore } = require("./phone-key");

// Estrutura da abertura em regex: spintax vira alternativa, empresa vira curinga.
const OPENER_RES = OPENERS.map((template) => {
  const escaped = template
    .replace(/[.*+?^$()[\]\\]/g, "\\$&")
    .replace(/\{\{[^}]+\}\}/g, ".+")
    .replace(/\{([^{}]+)\}/g, (_, alt) => `(?:${alt})`);
  return new RegExp(`^${escaped}$`, "i");
});

/** Índice da abertura usada (registrado ou reconhecido pelo texto). */
function openerOf(item) {
  if (Number.isInteger(item?.opener)) return item.opener;
  const text = String(item?.message || "").trim();
  const index = OPENER_RES.findIndex((re) => re.test(text));
  return index >= 0 ? index : null;
}

const RANK = { enviado: 1, entregue: 2, lido: 3, respondeu: 4 };

function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * @param {{ items: object[], contacts: Record<string, object> }} data
 */
function whatsappXray({ items = [], contacts = {} }) {
  const all = Object.values(contacts).filter((c) => c && c.status !== "nao_contatar");
  const funnel = { enviado: 0, entregue: 0, lido: 0, respondeu: 0, saiu: 0 };
  for (const c of all) {
    if (c.status === "descadastrado") { funnel.saiu += 1; funnel.enviado += 1; continue; }
    const r = RANK[c.status] || 0;
    if (r >= 1) funnel.enviado += 1;
    if (r >= 2) funnel.entregue += 1;
    if (r >= 3) funnel.lido += 1;
    if (r >= 4) funnel.respondeu += 1;
  }

  const sent = items.filter((i) => i.status === "enviado" && i.kind === "primeiro");
  const byOpener = OPENERS.map((template, index) => ({ index, template, sent: 0, replied: 0 }));
  const hours = Array.from({ length: 24 }, (_, h) => ({ hour: h, sent: 0, replied: 0 }));
  const replyMinutes = [];
  for (const item of sent) {
    const contact = contacts[phoneCore(item.phone)];
    const replied = contact?.status === "respondeu" && (contact.repliedAt || 0) >= (item.sentAt || 0);
    const opener = openerOf(item);
    if (opener !== null && byOpener[opener]) {
      byOpener[opener].sent += 1;
      if (replied) byOpener[opener].replied += 1;
    }
    if (item.sentAt) {
      const h = new Date(item.sentAt).getHours();
      hours[h].sent += 1;
      if (replied) hours[h].replied += 1;
    }
    if (replied) replyMinutes.push((contact.repliedAt - item.sentAt) / 60000);
  }
  const rate = (g) => (g.sent ? Math.round((g.replied / g.sent) * 100) : 0);
  return {
    funnel,
    openers: byOpener.map((g) => ({ ...g, rate: rate(g) })).sort((a, b) => b.rate - a.rate || b.sent - a.sent),
    hours: hours.map((g) => ({ ...g, rate: rate(g) })),
    replyMinutesMedian: median(replyMinutes),
    sampleSize: sent.length,
    autoReplies: all.reduce((sum, c) => sum + (Number(c.autoReplies) || 0), 0),
  };
}

module.exports = { whatsappXray, openerOf };
