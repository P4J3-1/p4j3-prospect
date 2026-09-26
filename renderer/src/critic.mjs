// Agente Crítico: lê o funil inteiro (conversas, fila, base, nichos e regiões)
// e devolve o que fazer agora, as oportunidades e os pontos fracos, cada um
// com a ação pronta. Tudo local (sem IA), então pode rodar a todo momento.
import { contactFor, leadPhone, liveReplyDrafts, phoneCore } from './contactStatus.mjs';
import { triageFor } from './triage.mjs';
import { intentScore, resultsBy } from './intel.mjs';

const HOUR = 3600000;
const DAY = 24 * HOUR;

export const KINDS = {
  agir: { label: 'Agir agora', color: '#f472b6' },
  oportunidade: { label: 'Oportunidade', color: '#34d399' },
  feedback: { label: 'Ponto de atenção', color: '#fbbf24' },
};

function ago(ts, now) {
  const h = Math.max(0, Math.round((now - ts) / HOUR));
  if (h < 1) return 'agora há pouco';
  if (h < 24) return `há ${h}h`;
  return `há ${Math.round(h / 24)} dia(s)`;
}

function shortName(name) {
  return String(name || 'lead').split(/\s+[-–—|·:]\s+/)[0].slice(0, 40);
}

/** "Ceilândia, DF" para mandar caçar onde já funcionou. */
function placeOf(lead) {
  const region = lead?.neighborhood || lead?.bairro || lead?.city || '';
  const uf = lead?.state || lead?.uf || '';
  if (!region) return '';
  return uf && !region.includes(',') ? `${region}, ${uf}` : region;
}

function topPlaceFor(leads, contacts, niche) {
  const count = {};
  for (const lead of leads) {
    if ((lead.category || '') !== niche) continue;
    const c = contactFor(contacts, lead);
    const place = placeOf(lead);
    if (!place) continue;
    count[place] = (count[place] || 0) + (c?.status === 'respondeu' ? 3 : 1);
  }
  return Object.entries(count).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
}

/**
 * @returns {Array<{ id: string, kind: 'agir'|'oportunidade'|'feedback', prioridade: number,
 *   titulo: string, detalhe: string, acao: { tipo: string, texto: string, [k: string]: any } | null }>}
 */
export function critique({ leads = [], contacts = {}, queue = {}, autopilot = null, triage = {}, waCheck = {}, memory = {}, now = Date.now() } = {}) {
  const out = [];
  const add = (item) => out.push(item);
  const entries = Object.entries(contacts || {}).filter(([, c]) => c && typeof c === 'object');
  const byKey = {};
  for (const lead of leads) {
    const key = phoneCore(leadPhone(lead));
    if (key && !byKey[key]) byKey[key] = lead;
  }

  // 1) Quem respondeu e está esperando: o mais antigo primeiro.
  const waiting = entries
    .filter(([, c]) => c.status === 'respondeu' && (c.lastReplyAt || 0) > (c.sentAt || 0))
    .sort((a, b) => (a[1].lastReplyAt || 0) - (b[1].lastReplyAt || 0));
  waiting.slice(0, 5).forEach(([phone, c], i) => {
    const lead = byKey[phone];
    const name = shortName(c.name || lead?.name);
    add({
      id: `responder:${phone}`, kind: 'agir', prioridade: 100 - i,
      titulo: `Responder ${name}`,
      detalhe: `Respondeu ${ago(c.lastReplyAt, now)} e está esperando você.`,
      acao: { tipo: 'responder', texto: 'Abrir a conversa', phone, name: c.name || lead?.name || '' },
    });
    // Respondeu e tem problema visível no site/atendimento: o diagnóstico é o gancho.
    const t = lead ? triageFor(triage, lead) : null;
    if (i < 3 && lead && (t?.score ?? 0) >= 55) {
      add({
        id: `diagnostico:${phone}`, kind: 'agir', prioridade: 88 - i,
        titulo: `Diagnóstico gratuito para ${name}`,
        detalhe: `Potencial ${t.score}/100${t.findings?.[0] ? `: ${t.findings[0].toLowerCase()}` : ''}. PDF + imagens prontos para você enviar.`,
        acao: { tipo: 'jarvis', acao: 'diagnostico', parametros: { lead: lead.name }, texto: 'Gerar e anexar' },
      });
    }
  });

  // 2) Respostas já escritas pelo Agente de Respostas.
  const replies = Object.keys(liveReplyDrafts(autopilot?.replyDrafts, contacts)).length;
  if (replies) {
    add({ id: 'respostas', kind: 'agir', prioridade: 90, titulo: `${replies} resposta(s) prontas`, detalhe: 'O Agente de Respostas já escreveu. É só revisar e enviar.', acao: { tipo: 'respostas', texto: 'Revisar' } });
  }

  // 3) Leads quentes (leram/responderam há pouco, conversa quente): hora da proposta.
  const hot = [];
  for (const [phone, c] of entries) {
    const lead = byKey[phone];
    if (!lead || c.status !== 'respondeu') continue;
    const score = intentScore({ contact: c, triage: triageFor(triage, lead), memory: memory?.[phone], now });
    if (score >= 70 && memory?.[phone]?.temperatura === 'quente') hot.push({ phone, lead, score });
  }
  hot.sort((a, b) => b.score - a.score).slice(0, 3).forEach(({ phone, lead, score }, i) => {
    add({
      id: `proposta:${phone}`, kind: 'agir', prioridade: 86 - i,
      titulo: `Proposta para ${shortName(lead.name)}`,
      detalhe: `Intenção ${score}/100 e conversa quente. A proposta sai escrita no campo da conversa.`,
      acao: { tipo: 'jarvis', acao: 'proposta', parametros: { lead: lead.name }, texto: 'Preparar proposta' },
    });
  });

  // 4) Fila esperando aprovação.
  const items = queue.items || [];
  const drafts = items.filter((i) => i.status === 'rascunho').length;
  const approved = items.filter((i) => i.status === 'aprovado').length;
  if (drafts) {
    const n = Math.min(20, drafts);
    add({ id: 'aprovar', kind: 'agir', prioridade: 75, titulo: `Aprovar as ${n} melhores da fila`, detalhe: `${drafts} mensagem(ns) prontas. As de maior potencial saem primeiro, no ritmo seguro.`, acao: { tipo: 'jarvis', acao: 'aprovar', parametros: { quantidade: n }, texto: `Aprovar ${n}` } });
  }

  // 5) Meta do dia atrasada.
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  const sentToday = entries.filter(([, c]) => (c.sentAt || 0) >= start.getTime()).length;
  const goal = Number(queue.settings?.dailyGoal) || 0;
  const hour = new Date(now).getHours();
  if (goal && hour >= 13 && sentToday < goal * 0.5 && !approved && drafts) {
    add({ id: 'meta', kind: 'feedback', prioridade: 72, titulo: `Meta do dia em ${Math.round((sentToday / goal) * 100)}%`, detalhe: `${sentToday} de ${goal} contatos e nada aprovado saindo. Aprovar agora ainda cabe no dia.`, acao: { tipo: 'jarvis', acao: 'aprovar', parametros: { quantidade: Math.min(20, drafts) }, texto: 'Aprovar e soltar' } });
  }

  // 6) Base pronta para abordar, fila curta.
  const ready = leads.filter((lead) => {
    const phone = leadPhone(lead);
    if (!phone || contactFor(contacts, lead)) return false;
    return waCheck[phoneCore(phone)]?.exists !== false && (triageFor(triage, lead)?.score ?? 0) >= 45;
  }).length;
  if (ready >= 10 && drafts < 20) {
    add({ id: 'montar', kind: 'oportunidade', prioridade: 64, titulo: `${ready} leads prontos para abordar`, detalhe: 'Bom potencial, WhatsApp válido e nunca contatados. Monte a fila com eles.', acao: { tipo: 'montar', texto: 'Montar a fila' } });
  }

  // 7) Nichos: o que rende vira caçada; o que não rende vira alerta.
  const byNiche = resultsBy(leads, contacts, 'nicho');
  const totalSent = byNiche.reduce((a, g) => a + g.sent, 0);
  const totalReplied = byNiche.reduce((a, g) => a + g.replied, 0);
  const avg = totalSent ? totalReplied / totalSent : 0;
  const winners = byNiche.filter((g) => g.key !== 'Sem nicho' && g.sent >= 5 && g.replied > 0 && g.replied / g.sent >= Math.max(0.08, avg * 1.3)).slice(0, 3);
  winners.forEach((g, i) => {
    const place = topPlaceFor(leads, contacts, g.key);
    add({
      id: `cacar:${g.key}`, kind: 'oportunidade', prioridade: 68 - i * 2,
      titulo: `Caçar mais ${g.key}${place ? ` em ${place.split(',')[0]}` : ''}`,
      detalhe: `Responde ${g.rate}% (${g.replied} de ${g.sent}), acima da média de ${Math.round(avg * 100)}%. Mais leads desse perfil = mais conversas.`,
      acao: place ? { tipo: 'jarvis', acao: 'cacar', parametros: { nicho: g.key, cidade: place }, texto: 'Caçar agora' } : null,
    });
  });
  byNiche.filter((g) => g.key !== 'Sem nicho' && g.sent >= 12 && g.replied === 0).slice(0, 2).forEach((g, i) => {
    add({
      id: `nicho-frio:${g.key}`, kind: 'feedback', prioridade: 58 - i,
      titulo: `${g.key}: ${g.sent} contatos, nenhuma resposta`,
      detalhe: 'Pare de gastar contatos aqui ou mude a abertura para esse nicho (pergunta sobre o dia a dia dele).',
      acao: { tipo: 'jarvis', acao: 'filtrar', parametros: { nicho: g.key, aba: 'contatados' }, texto: 'Ver esses leads' },
    });
  });

  // 8) Região que mais responde.
  const bestRegion = resultsBy(leads, contacts, 'regiao').find((g) => g.key !== 'Sem região' && g.sent >= 8 && g.replied / g.sent >= Math.max(0.1, avg * 1.4));
  if (bestRegion) {
    add({ id: `regiao:${bestRegion.key}`, kind: 'oportunidade', prioridade: 60, titulo: `${bestRegion.key} responde ${bestRegion.rate}%`, detalhe: `${bestRegion.replied} de ${bestRegion.sent} responderam. Priorize os leads dessa região.`, acao: { tipo: 'jarvis', acao: 'filtrar', parametros: { incluir: [bestRegion.key], aba: 'disponiveis' }, texto: 'Mostrar só essa região' } });
  }

  // 9) Leram e não responderam: follow-up curto.
  const readNoReply = entries.filter(([, c]) => c.status === 'lido' && (c.sentAt || 0) < now - 2 * DAY && (c.sentAt || 0) > now - 10 * DAY).length;
  if (readNoReply >= 3) {
    add({ id: 'followup', kind: 'oportunidade', prioridade: 55, titulo: `${readNoReply} leram e não responderam`, detalhe: 'Leu é interesse. Um follow-up curto (uma pergunta) recupera parte deles.', acao: { tipo: 'jarvis', acao: 'filtrar', parametros: { aba: 'contatados' }, texto: 'Ver quem leu' } });
  }

  // 10) Taxa geral e saídas: o crítico olha a abordagem.
  if (totalSent >= 50 && avg < 0.05) {
    add({ id: 'taxa', kind: 'feedback', prioridade: 57, titulo: `Taxa de resposta em ${Math.round(avg * 100)}%`, detalhe: 'Abaixo de 5%. Teste aberturas mais curtas ("Oi, tudo bem?") e foque nos nichos que respondem.', acao: { tipo: 'abrir', go: 'agents', texto: 'Ajustar abordagem' } });
  }
  const optOut = entries.filter(([, c]) => c.status === 'descadastrado').length;
  if (totalSent >= 30 && optOut / totalSent > 0.03) {
    add({ id: 'saidas', kind: 'feedback', prioridade: 54, titulo: `${optOut} pediram para sair`, detalhe: `${Math.round((optOut / totalSent) * 100)}% dos contatos. Mensagem longa ou oferta cedo demais afasta: primeiro a pergunta, depois a oferta.`, acao: null });
  }

  // 11) Piloto desligado e estoque baixo.
  if (autopilot && !autopilot.settings?.enabled) {
    add({ id: 'piloto', kind: 'oportunidade', prioridade: 52, titulo: 'Piloto automático desligado', detalhe: 'Os agentes param de caçar, verificar e preparar mensagens.', acao: { tipo: 'piloto', texto: 'Ligar' } });
  }
  if (ready < 15 && winners[0]) {
    const place = topPlaceFor(leads, contacts, winners[0].key);
    if (place) add({ id: 'estoque', kind: 'feedback', prioridade: 62, titulo: `Só ${ready} leads prontos na base`, detalhe: `A fila vai secar. Caçar ${winners[0].key}, o nicho que mais responde.`, acao: { tipo: 'jarvis', acao: 'cacar', parametros: { nicho: winners[0].key, cidade: place }, texto: 'Repor agora' } });
  }

  const seen = new Set();
  return out
    .filter((x) => (seen.has(x.id) ? false : seen.add(x.id)))
    .sort((a, b) => b.prioridade - a.prioridade);
}

const FOLLOW_UP = (name) => `Oi${name ? `, ${name}` : ''}! Tudo bem? Conseguiu ver minha mensagem?`;
const PROPOSAL_FOLLOW_UP = (name) => `Oi${name ? `, ${name}` : ''}! Conseguiu dar uma olhada na proposta? Se tiver qualquer dúvida, te explico rapidinho.`;

/**
 * Agente do Kanban: o que cada card precisa agora, com a ação pronta para
 * confirmar (conversa aberta com o texto escrito, proposta, lembrete).
 * @returns {Array<{ id: string, tipo: string, prioridade: number, titulo: string, detalhe: string, cardKey: string, acao: object }>}
 */
export function kanbanTasks({ cards = [], contacts = {}, replyDrafts = {}, memory = {}, now = Date.now() } = {}) {
  const out = [];
  const live = liveReplyDrafts(replyDrafts, contacts);
  for (const card of cards) {
    const profile = card.entity?.profile || {};
    const phone = phoneCore(profile.phone || '');
    const name = shortName(profile.name);
    const first = name.split(/\s+/)[0];
    const c = phone ? contacts[phone] : null;
    const base = { cardKey: card.entityKey };
    const col = card.columnId;
    if (col === 'won' || col === 'lost') {
      if (col === 'won' && !Number(card.dealValue)) out.push({ ...base, id: `valor:${card.entityKey}`, tipo: 'card', prioridade: 40, titulo: `Registrar o valor da venda de ${name}`, detalhe: 'Sem valor, o faturamento do funil fica errado.', acao: { tipo: 'card', texto: 'Informar valor' } });
      continue;
    }
    if (card.reminderAt && card.reminderAt <= now) {
      out.push({ ...base, id: `lembrete:${card.entityKey}`, tipo: 'lembrete', prioridade: 95, titulo: `Lembrete: ${name}`, detalhe: card.reminderNote || `Venceu ${ago(card.reminderAt, now)}.`, acao: phone.length >= 10 ? { tipo: 'responder', texto: 'Abrir conversa', phone, name: profile.name || '' } : { tipo: 'card', texto: 'Abrir card' } });
    }
    if (phone.length < 10) continue;
    const draft = live[phone];
    // Bola com você: respondeu depois da sua última mensagem, ou o Agente de
    // Respostas já escreveu algo depois dela.
    const waiting = c && c.status === 'respondeu' && ((c.lastReplyAt || 0) > (c.sentAt || 0) || draft);
    if (waiting) {
      const text = draft?.sugestoes?.[0] || '';
      out.push({ ...base, id: `responder:${phone}`, tipo: 'responder', prioridade: 100 - Math.min(20, (now - (c.lastReplyAt || now)) / HOUR / 6),
        titulo: text ? `Resposta pronta para ${name}` : `Responder ${name}`,
        detalhe: text ? `“${text.slice(0, 110)}${text.length > 110 ? '…' : ''}”` : `Respondeu ${ago(c.lastReplyAt || c.lastEventAt || now, now)}.`,
        acao: { tipo: 'responder', texto: text ? 'Abrir pronta' : 'Abrir conversa', phone, name: profile.name || '', text } });
      continue;
    }
    if ((col === 'contacted' || col === 'qualified') && memory?.[phone]?.temperatura === 'quente') {
      out.push({ ...base, id: `proposta:${phone}`, tipo: 'proposta', prioridade: 85, titulo: `Proposta para ${name}`, detalhe: 'Conversa quente e ainda sem proposta. Ela sai escrita no campo da conversa.', acao: { tipo: 'jarvis', acao: 'proposta', parametros: { lead: profile.name }, texto: 'Preparar proposta' } });
      continue;
    }
    const since = card.movedAt || card.updatedAt || 0;
    if (col === 'proposal' && since && now - since > 2 * DAY && !(c?.lastReplyAt > since)) {
      out.push({ ...base, id: `cobrar:${phone}`, tipo: 'followup', prioridade: 80, titulo: `Cobrar retorno de ${name}`, detalhe: `Proposta parada ${ago(since, now)}. Mensagem curta pronta.`, acao: { tipo: 'responder', texto: 'Abrir pronta', phone, name: profile.name || '', text: PROPOSAL_FOLLOW_UP(first) } });
      continue;
    }
    const sentAt = c?.sentAt || card.messageSentAt || 0;
    if (col === 'sent' && c && ['lido', 'entregue'].includes(c.status) && sentAt < now - 3 * DAY && sentAt > now - 12 * DAY && !c.followUpAt) {
      out.push({ ...base, id: `followup:${phone}`, tipo: 'followup', prioridade: c.status === 'lido' ? 60 : 45, titulo: `Follow-up em ${name}`, detalhe: `${c.status === 'lido' ? 'Leu' : 'Recebeu'} ${ago(sentAt, now)} e não respondeu. Uma pergunta curta pronta.`, acao: { tipo: 'responder', texto: 'Abrir pronta', phone, name: profile.name || '', text: FOLLOW_UP(first) } });
    }
  }
  return out.sort((a, b) => b.prioridade - a.prioridade);
}
