import React, { useEffect, useMemo, useState } from 'react';
import { Zap, Bot } from 'lucide-react';
import { useContactStatus } from '../useContactStatus';
import { useLeadMemory } from '../useLeadMemory';
import { useAutopilot } from '../useAutopilot';
import { kanbanTasks } from '../critic.mjs';
import { runSuggestion } from '../runSuggestion';
import { useDeals } from '../useDeals';

const TIPO = {
  responder: { label: 'Responder', color: '#f472b6' },
  lembrete: { label: 'Lembrete', color: '#fbbf24' },
  proposta: { label: 'Proposta', color: '#a78bfa' },
  followup: { label: 'Follow-up', color: '#38bdf8' },
  card: { label: 'Card', color: '#34d399' },
};

/**
 * Agente do Kanban: pendências de cada card com a ação pronta. Clicou, abre
 * a conversa com o texto escrito (ou o card); o envio é sempre seu.
 */
export default function KanbanAgent({ cards, onNavigate, onOpenCard }) {
  const contacts = useContactStatus();
  const memory = useLeadMemory();
  const [autopilot] = useAutopilot();
  const deals = useDeals();
  const [now, setNow] = useState(Date.now());
  const [showAll, setShowAll] = useState(false);
  const [busyId, setBusyId] = useState('');

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(t);
  }, []);

  const tasks = useMemo(
    () => kanbanTasks({ cards, contacts, replyDrafts: autopilot?.replyDrafts || {}, memory, deals, now }),
    [cards, contacts, autopilot?.replyDrafts, memory, deals, now],
  );
  const visible = showAll ? tasks : tasks.slice(0, 6);

  const run = async (task) => {
    if (busyId) return;
    if (task.acao.tipo === 'card') {
      const card = cards.find((c) => c.entityKey === task.cardKey);
      if (card) onOpenCard?.(card);
      return;
    }
    setBusyId(task.id);
    try { await runSuggestion(task.acao, onNavigate); } finally { setBusyId(''); }
  };

  return (
    <section className="kb-agent" aria-label="Agente do Kanban">
      <header>
        <span className="kb-agent-ico"><Bot size={16} /></span>
        <div>
          <b>Agente do Kanban</b>
          <small>{tasks.length ? `${tasks.length} pendência(s). Clique e confira: o texto já vem escrito.` : 'Nenhuma pendência. Tudo em dia.'}</small>
        </div>
      </header>
      {tasks.length > 0 && (
        <ul>
          {visible.map((task) => {
            const t = TIPO[task.tipo] || TIPO.card;
            return (
              <li key={task.id} style={{ '--c': t.color }}>
                <div>
                  <small>{t.label}</small>
                  <b>{task.titulo}</b>
                  <span>{task.detalhe}</span>
                </div>
                <button type="button" disabled={Boolean(busyId)} onClick={() => run(task)}>
                  <Zap size={13} /> {busyId === task.id ? 'Abrindo…' : task.acao.texto}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {tasks.length > 6 && (
        <button type="button" className="kb-agent-more" onClick={() => setShowAll((v) => !v)}>
          {showAll ? 'Mostrar menos' : `Ver todas (${tasks.length})`}
        </button>
      )}
    </section>
  );
}
