import React, { useMemo, useState } from 'react';
import { X, Check, SkipForward, Undo2, Send, Clock } from 'lucide-react';
import { useQueue } from '../useQueue';
import { timeAgo } from '../contactStatus.mjs';

const KIND_LABEL = { primeiro: 'Primeiro contato', follow_up: 'Follow-up', nova_oferta: 'Nova oferta' };
const WAIT_LABEL = {
  vazia: 'Nada aprovado para enviar.',
  fora_do_horario: 'Fora da janela de envio: aprovados saem quando a janela abrir.',
  intervalo: 'Aguardando o intervalo seguro entre mensagens.',
  sem_whatsapp: 'Conecte o WhatsApp para enviar os aprovados.',
  limite_diario: 'Limite diário do número atingido: continua amanhã.',
  enviando: 'Enviando…',
};
const TABS = [
  ['rascunho', 'Para aprovar'],
  ['aprovado', 'Aprovados'],
  ['enviado', 'Enviados'],
  ['falhou', 'Falhas'],
  ['pulado', 'Pulados'],
];

function QueueItem({ item }) {
  const [draft, setDraft] = useState(item.message);
  const [busy, setBusy] = useState(false);
  const dirty = draft !== item.message;
  const act = async (patch) => {
    setBusy(true);
    try {
      const res = await window.queueAPI.update(item.id, patch);
      if (!res?.success) alert(res?.error || 'Não foi possível atualizar.');
    } finally {
      setBusy(false);
    }
  };
  const editable = item.status === 'rascunho' || item.status === 'aprovado';
  return (
    <article className={`queue-item status-${item.status}`}>
      <header>
        <div style={{ minWidth: 0 }}>
          <b>{item.name || item.phone}</b>
          <span className="queue-meta">{KIND_LABEL[item.kind] || item.kind} · {item.reason}</span>
        </div>
        {item.ai && <span className="lead-badge potential">IA</span>}
      </header>
      {editable ? (
        <textarea value={draft} rows={4} onChange={(e) => setDraft(e.target.value)} aria-label={`Mensagem para ${item.name}`} />
      ) : (
        <p className="queue-message">{item.message}</p>
      )}
      <footer>
        {item.status === 'rascunho' && (
          <>
            <button type="button" className="btn btn-sm btn-primary" disabled={busy || !draft.trim()} onClick={() => act({ message: draft, status: 'aprovado' })}>
              <Check size={13} /> Aprovar{dirty ? ' com edição' : ''}
            </button>
            {dirty && <button type="button" className="btn btn-sm" disabled={busy} onClick={() => act({ message: draft })}>Salvar texto</button>}
            <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={() => act({ status: 'pulado' })}><SkipForward size={13} /> Pular</button>
          </>
        )}
        {item.status === 'aprovado' && (
          <>
            {dirty && <button type="button" className="btn btn-sm" disabled={busy} onClick={() => act({ message: draft })}>Salvar texto</button>}
            <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={() => act({ status: 'rascunho' })}><Undo2 size={13} /> Voltar para aprovação</button>
            <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={() => act({ status: 'pulado' })}><SkipForward size={13} /> Pular</button>
          </>
        )}
        {item.status === 'enviado' && <span className="queue-meta"><Send size={12} /> Enviado {timeAgo(item.sentAt)}</span>}
        {(item.status === 'falhou' || item.status === 'pulado') && item.error && <span className="queue-meta">{item.error}</span>}
      </footer>
    </article>
  );
}

/** Revisão da fila de envio: nada sai sem a sua aprovação. */
export default function QueuePanel({ onClose }) {
  const queue = useQueue();
  const [tab, setTab] = useState('rascunho');
  const counts = useMemo(() => {
    const c = {};
    for (const item of queue.items) c[item.status] = (c[item.status] || 0) + 1;
    return c;
  }, [queue.items]);
  const list = useMemo(() => {
    const items = queue.items.filter((i) => (tab === 'aprovado' ? i.status === 'aprovado' || i.status === 'enviando' : i.status === tab));
    return tab === 'enviado' ? [...items].sort((a, b) => (b.sentAt || 0) - (a.sentAt || 0)) : items;
  }, [queue.items, tab]);
  const sentToday = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return queue.items.filter((i) => i.status === 'enviado' && i.sentAt >= start.getTime()).length;
  }, [queue.items]);
  const s = queue.settings || {};
  const saveSettings = (patch) => window.queueAPI.settings(patch);

  return (
    <div className="overlay on" role="dialog" aria-modal="true" aria-labelledby="queueTitle" onClick={onClose}>
      <div className="modal queue-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head" style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <h2 id="queueTitle" style={{ margin: 0 }}>Fila de envio</h2>
            <p className="camp-hint" style={{ margin: '4px 0 0' }}>
              A IA prepara, você aprova. Hoje: {sentToday} enviada(s) · {counts.aprovado || 0} aprovada(s) · {counts.rascunho || 0} para aprovar.
            </p>
          </div>
          <button type="button" className="icon-btn" aria-label="Fechar" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="queue-status"><Clock size={13} /> {WAIT_LABEL[queue.wait] || 'Pronto.'}</div>

        <div className="queue-settings">
          <label>
            <input type="checkbox" checked={s.windowEnabled !== false} onChange={(e) => saveSettings({ windowEnabled: e.target.checked })} />
            Enviar só entre
          </label>
          <input type="time" value={s.windowStart || '08:00'} disabled={s.windowEnabled === false} onChange={(e) => saveSettings({ windowStart: e.target.value })} />
          <span>e</span>
          <input type="time" value={s.windowEnd || '20:00'} disabled={s.windowEnabled === false} onChange={(e) => saveSettings({ windowEnd: e.target.value })} />
          <span>· intervalo mínimo</span>
          <input type="number" min={30} max={3600} value={s.intervalSec || 120} onChange={(e) => saveSettings({ intervalSec: e.target.value })} />
          <span>s · follow-up após</span>
          <input type="number" min={1} max={30} value={s.followUpDays || 3} onChange={(e) => saveSettings({ followUpDays: e.target.value })} />
          <span>dias · nova oferta após</span>
          <input type="number" min={1} max={60} value={s.newOfferDays || 7} onChange={(e) => saveSettings({ newOfferDays: e.target.value })} />
          <span>dias</span>
        </div>

        <div className="scraper-tabs queue-tabs" role="tablist">
          {TABS.map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} className={`scraper-tab ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>
              {label} <span className="scraper-tab-count">{id === 'aprovado' ? (counts.aprovado || 0) + (counts.enviando || 0) : counts[id] || 0}</span>
            </button>
          ))}
        </div>

        {tab === 'rascunho' && (counts.rascunho || 0) > 0 && (
          <div style={{ padding: '0 20px' }}>
            <button type="button" className="btn btn-sm btn-primary" onClick={() => window.queueAPI.approve()}>
              <Check size={13} /> Aprovar todos ({counts.rascunho})
            </button>
          </div>
        )}

        <div className="queue-list">
          {!list.length ? (
            <p className="camp-hint" style={{ padding: 20 }}>
              {tab === 'rascunho' ? 'Nada para aprovar. No Scraper, use "Montar fila" nos leads disponíveis.' : 'Nada aqui ainda.'}
            </p>
          ) : list.map((item) => <QueueItem key={`${item.id}-${item.status}`} item={item} />)}
        </div>
      </div>
    </div>
  );
}
