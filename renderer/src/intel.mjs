// Inteligência do J.A.R.V.I.S.: intenção de compra por lead, resultado por
// nicho/região e o briefing do dia. Funções puras (testáveis, sem React).
import { contactFor, leadPhone, phoneCore } from './contactStatus.mjs';
import { triageFor } from './triage.mjs';

const DAY = 86400000;
const STATUS_POINTS = { respondeu: 70, lido: 35, entregue: 20, enviado: 10 };

/**
 * Intenção 0–100: o que o lead fez (respondeu, leu), quão recente foi, a
 * temperatura lida na conversa e o potencial da triagem.
 */
export function intentScore({ contact, triage, memory, now = Date.now() }) {
  if (!contact || contact.status === 'nao_contatar' || contact.status === 'descadastrado') return 0;
  let score = STATUS_POINTS[contact.status] || 0;
  const last = contact.lastReplyAt || contact.lastEventAt || contact.sentAt || 0;
  const days = last ? (now - last) / DAY : 30;
  // Recência: vale muito nas primeiras 24h e cai ao longo de uma semana.
  score += Math.max(0, 20 - days * 3);
  if (memory?.temperatura === 'quente') score += 20;
  else if (memory?.temperatura === 'morno') score += 8;
  if (contact.status === 'respondeu' && (contact.lastReplyAt || 0) > (contact.sentAt || 0)) score += 10; // bola com você
  score += Math.round((triage?.score || 0) * 0.1);
  return Math.max(0, Math.min(100, Math.round(score)));
}

/** Os leads para agir agora, do mais quente para o menos. */
export function topIntent(leads, { contacts, triage, memory, now = Date.now(), limit = 8 }) {
  return leads
    .map((lead) => {
      const contact = contactFor(contacts, lead);
      const key = phoneCore(leadPhone(lead));
      const score = intentScore({ contact, triage: triageFor(triage, lead), memory: memory?.[key], now });
      return { lead, contact, score, key };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function regionOf(lead) {
  return lead.neighborhood || lead.bairro || lead.city || 'Sem região';
}

/**
 * Resultado por nicho ou por região: enviados, responderam e taxa.
 * @param {'nicho'|'regiao'} by
 */
export function resultsBy(leads, contacts, by = 'nicho') {
  const groups = {};
  for (const lead of leads) {
    const contact = contactFor(contacts, lead);
    if (!contact || contact.status === 'nao_contatar') continue;
    const key = by === 'nicho' ? (lead.category || 'Sem nicho') : regionOf(lead);
    const g = (groups[key] ||= { key, sent: 0, replied: 0, optOut: 0 });
    g.sent += 1;
    if (contact.status === 'respondeu') g.replied += 1;
    if (contact.status === 'descadastrado') g.optOut += 1;
  }
  return Object.values(groups)
    .map((g) => ({ ...g, rate: g.sent ? Math.round((g.replied / g.sent) * 100) : 0 }))
    .sort((a, b) => b.rate - a.rate || b.sent - a.sent);
}

function greeting(now) {
  const h = new Date(now).getHours();
  if (h < 12) return 'Bom dia';
  if (h < 18) return 'Boa tarde';
  return 'Boa noite';
}

/**
 * Briefing do dia em frases curtas, com a próxima ação recomendada.
 * @returns {{ saudacao: string, linhas: string[], acao: { texto: string, go: string } | null }}
 */
export function dailyBriefing({ name = '', leads = [], contacts = {}, queue = {}, autopilot = null, triage = {}, waCheck = {}, now = Date.now() }) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const all = Object.values(contacts || {});
  const waiting = all.filter((c) => c?.status === 'respondeu' && (c.lastReplyAt || 0) > (c.sentAt || 0)).length;
  const sentToday = all.filter((c) => (c?.sentAt || 0) >= start.getTime()).length;
  const drafts = (queue.items || []).filter((i) => i.status === 'rascunho').length;
  const approved = (queue.items || []).filter((i) => i.status === 'aprovado').length;
  const ready = leads.filter((lead) => {
    const phone = leadPhone(lead);
    if (!phone || contactFor(contacts, lead)) return false;
    return waCheck[phoneCore(phone)]?.exists !== false && (triageFor(triage, lead)?.score ?? 0) >= 45;
  }).length;
  const replies = Object.keys(autopilot?.replyDrafts || {}).length;
  const best = resultsBy(leads, contacts, 'nicho').find((g) => g.sent >= 5 && g.replied > 0);
  const linhas = [];
  linhas.push(`${sentToday} contato(s) feitos hoje${queue.settings?.dailyGoal ? ` de uma meta de ${queue.settings.dailyGoal}` : ''}.`);
  if (waiting) linhas.push(`${waiting} lead(s) responderam e estão esperando você.`);
  if (replies) linhas.push(`${replies} resposta(s) já preparada(s) pelo Agente de Respostas.`);
  if (drafts) linhas.push(`${drafts} mensagem(ns) na fila esperando a sua aprovação.`);
  if (approved) linhas.push(`${approved} aprovada(s) saindo no ritmo seguro.`);
  linhas.push(`${ready} lead(s) prontos para abordar na base.`);
  if (best) linhas.push(`Nicho que mais responde: ${best.key} (${best.rate}% em ${best.sent} contatos).`);
  if (autopilot && !autopilot.settings?.enabled) linhas.push('O piloto automático está desligado.');
  const risky = (queue.numbers || []).find((n) => n.risk?.level === 'alto') || (queue.risk?.level === 'alto' ? { phone: '', risk: queue.risk } : null);
  if (risky) linhas.unshift(`⚠ Risco alto de bloqueio no número ${risky.phone ? `+${risky.phone}` : ''}: ${risky.risk.reasons[0]}.`);

  let acao = null;
  // Quem esperou mais vem primeiro.
  const firstWaiting = Object.entries(contacts || {})
    .filter(([, c]) => c?.status === 'respondeu' && (c.lastReplyAt || 0) > (c.sentAt || 0))
    .sort((a, b) => (a[1].lastReplyAt || 0) - (b[1].lastReplyAt || 0))[0];
  if (risky) acao = { tipo: 'fila', texto: 'Proteger o número (ajustar a fila)', go: 'scraper' };
  else if (firstWaiting) acao = { tipo: 'responder', texto: `Responder ${firstWaiting[1].name || 'quem está esperando'}${waiting > 1 ? ` (+${waiting - 1})` : ''}`, go: 'whatsapp', phone: firstWaiting[0], name: firstWaiting[1].name || '' };
  else if (replies) acao = { tipo: 'respostas', texto: `Ver as ${replies} resposta(s) prontas`, go: 'agents' };
  else if (drafts) acao = { tipo: 'fila', texto: `Aprovar ${drafts} mensagem(ns) da fila`, go: 'scraper' };
  else if (autopilot && !autopilot.settings?.enabled) acao = { tipo: 'piloto', texto: 'Ligar o piloto automático', go: 'agents' };
  else if (ready) acao = { tipo: 'montar', texto: 'Montar a fila com os prontos', go: 'scraper' };
  return { saudacao: `${greeting(now)}${name ? `, ${name}` : ''}.`, linhas, acao };
}
