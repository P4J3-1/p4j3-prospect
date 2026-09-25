import React, { useMemo } from 'react';
import { readLocalArray } from '../leadData';
import { useContactStatus } from '../useContactStatus';
import { useTriage } from '../useTriage';
import { contactFor } from '../contactStatus.mjs';
import { triageFor } from '../triage.mjs';
import { useQueue } from '../useQueue';
import { useLeadMemory } from '../useLeadMemory';

/**
 * O caminho do lead em 5 passos, com números reais e o próximo passo sugerido.
 * Dá clareza de onde a operação está travando.
 */
export default function ProspectFlow({ onNavigate, won = 0 }) {
  const contacts = useContactStatus();
  const triage = useTriage();
  const queue = useQueue();
  const leadMemory = useLeadMemory();

  const today = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const t0 = start.getTime();
    let sent = 0;
    let waiting = 0;
    for (const c of Object.values(contacts)) {
      if ((c?.sentAt || 0) >= t0) sent += 1;
      // Respondeu depois da sua última mensagem: a bola está com você.
      if (c?.status === 'respondeu' && (c.lastReplyAt || 0) > (c.sentAt || 0)) waiting += 1;
    }
    const drafts = queue.items.filter((i) => i.status === 'rascunho').length;
    const approved = queue.items.filter((i) => i.status === 'aprovado').length;
    const hot = Object.values(leadMemory).filter((m) => m.temperatura === 'quente').length;
    return { sent, waiting, drafts, approved, hot, goal: Number(queue.settings?.dailyGoal) || 40 };
  }, [contacts, queue, leadMemory]);

  const counts = useMemo(() => {
    const leads = readLocalArray('sigma_leads');
    let triaged = 0;
    let hot = 0;
    let contacted = 0;
    let replied = 0;
    for (const lead of leads) {
      const t = triageFor(triage, lead);
      if (t) {
        triaged += 1;
        if (t.level === 'alto') hot += 1;
      }
      const c = contactFor(contacts, lead);
      if (c) {
        contacted += 1;
        if (c.status === 'respondeu') replied += 1;
      }
    }
    return { total: leads.length, triaged, hot, contacted, replied };
  }, [contacts, triage]);

  const steps = [
    { id: 'scraper', n: counts.total, label: 'Leads encontrados', hint: 'Extraia por nicho + bairro', go: 'scraper' },
    { id: 'triage', n: counts.triaged, label: 'Triados', hint: `${counts.hot} de alto potencial`, go: 'agents' },
    { id: 'contact', n: counts.contacted, label: 'Contatados', hint: 'Mensagem enviada no WhatsApp', go: 'whatsapp' },
    { id: 'reply', n: counts.replied, label: 'Responderam', hint: counts.contacted ? `${Math.round((counts.replied / counts.contacted) * 100)}% de resposta` : 'Meta: 10–20%', go: 'whatsapp' },
    { id: 'won', n: won, label: 'Vendas', hint: 'Negócios ganhos no Kanban', go: 'kanban' },
  ];

  // Próximo passo: o primeiro gargalo do funil.
  let next = null;
  if (!counts.total) next = { text: 'Faça sua primeira extração no Scraper Maps.', go: 'scraper' };
  else if (counts.triaged < counts.total) next = { text: `${counts.total - counts.triaged} lead(s) sem triagem: rode o Agente de Triagem para achar os de maior potencial.`, go: 'agents' };
  else if (counts.hot > 0 && counts.contacted < counts.hot) next = { text: 'Você tem leads de alto potencial ainda não contatados: crie uma campanha com eles.', go: 'whatsapp' };
  else if (counts.contacted && !counts.replied) next = { text: 'Ninguém respondeu ainda: use “Melhorar com IA” na próxima campanha.', go: 'whatsapp' };
  else if (counts.replied) next = { text: 'Há respostas: use “Sugerir resposta” nas conversas para levar ao próximo passo.', go: 'whatsapp' };

  return (
    <section className="prospect-flow" aria-label="Seu fluxo de prospecção">
      <div className="prospect-flow-head">
        <b>Seu fluxo de prospecção</b>
        {next && (
          <button type="button" className="prospect-flow-next" onClick={() => onNavigate?.(next.go)}>
            Próximo passo: {next.text} →
          </button>
        )}
      </div>
      <div className="prospect-today" aria-label="Hoje">
        <button type="button" onClick={() => onNavigate?.('scraper')}>
          <b>{today.sent}/{today.goal}</b><span>envios hoje (meta)</span>
          <i style={{ width: `${Math.min(100, Math.round((today.sent / today.goal) * 100))}%` }} />
        </button>
        <button type="button" onClick={() => onNavigate?.('scraper')}><b>{today.drafts}</b><span>para aprovar na fila</span></button>
        <button type="button" onClick={() => onNavigate?.('scraper')}><b>{today.approved}</b><span>aprovadas aguardando envio</span></button>
        <button type="button" className={today.waiting ? 'alert' : ''} onClick={() => onNavigate?.('whatsapp')}><b>{today.waiting}</b><span>conversas esperando você</span></button>
        <button type="button" className={today.hot ? 'hot' : ''} onClick={() => onNavigate?.('whatsapp')}><b>{today.hot}</b><span>leads quentes</span></button>
      </div>
      <ol className="prospect-flow-steps">
        {steps.map((step, index) => (
          <li key={step.id}>
            <button type="button" onClick={() => onNavigate?.(step.go)}>
              <span className="pf-index">{index + 1}</span>
              <b>{Number(step.n || 0).toLocaleString('pt-BR')}</b>
              <span className="pf-label">{step.label}</span>
              <span className="pf-hint">{step.hint}</span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
