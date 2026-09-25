import React, { useEffect, useState } from 'react';
import { timeAgo } from '../contactStatus.mjs';

function summary(result) {
  if (!result) return '';
  const parts = [];
  const online = (result.connections || []).filter((c) => c.status === 'connected');
  if (!online.length) parts.push('nenhum WhatsApp conectado');
  else parts.push(online.map((c) => (c.phone ? `+${c.phone}` : 'conectado') + (c.reconnected ? ' (reconectado)' : '')).join(', '));
  const n = result.newReplies?.length || 0;
  parts.push(n ? `${n} resposta(s) nova(s): ${result.newReplies.slice(0, 3).map((r) => r.name || r.phone).join(', ')}${n > 3 ? '…' : ''}` : 'nenhuma resposta nova');
  return parts.join(' · ');
}

/**
 * Botão "Atualizar WhatsApp": confere a conexão (reconecta sem deslogar),
 * recupera as mensagens que chegaram e atualiza quem respondeu.
 */
export default function WhatsAppRefresh({ className = '', compact = false }) {
  const [state, setState] = useState({ lastAt: 0, running: false, result: null });
  const [error, setError] = useState('');
  const [, tick] = useState(0);

  useEffect(() => {
    let alive = true;
    window.contactAPI?.getRefreshState?.().then((s) => { if (alive && s) setState(s); }).catch(() => {});
    const off = window.contactAPI?.onRefreshState?.((s) => { if (s) setState(s); });
    const timer = setInterval(() => tick((t) => t + 1), 30000);
    return () => {
      alive = false;
      clearInterval(timer);
      if (typeof off === 'function') off();
    };
  }, []);

  const run = async () => {
    if (!window.contactAPI?.refreshWhatsApp) return;
    setError('');
    setState((s) => ({ ...s, running: true }));
    try {
      const res = await window.contactAPI.refreshWhatsApp();
      if (!res?.success) throw new Error(res?.error || 'Não foi possível atualizar.');
    } catch (err) {
      setError(err?.message || 'Falhou.');
      setState((s) => ({ ...s, running: false }));
    }
  };

  const result = state.result;
  const offline = result?.offlineSessions || 0;
  const newCount = result?.newReplies?.length || 0;

  if (compact) {
    const detail = error || (state.lastAt ? `Atualizado ${timeAgo(state.lastAt)} · ${summary(result)}` : 'Ainda não atualizado nesta sessão')
      + (offline ? ` · ${offline} número(s) salvo(s) fora do ar` : '');
    return (
      <button type="button" className={`btn btn-sm wa-refresh-compact ${className}`} disabled={state.running} onClick={run} title={detail}>
        {state.running ? 'Atualizando…' : '↻ Atualizar'}
        {!state.running && state.lastAt > 0 && <span className="wa-refresh-when">{timeAgo(state.lastAt)}</span>}
        {!state.running && newCount > 0 && <span className="wa-refresh-new">{newCount} nova(s)</span>}
        {!state.running && (error || offline > 0) && <span className="wa-refresh-warn" aria-label="atenção">!</span>}
      </button>
    );
  }

  return (
    <div className={`wa-refresh ${className}`}>
      <button
        type="button"
        className="btn btn-sm"
        disabled={state.running}
        onClick={run}
        title="Confere a conexão, reconecta se tiver caído (sem deslogar), busca as mensagens que chegaram e atualiza quem respondeu"
      >
        {state.running ? 'Atualizando WhatsApp…' : '↻ Atualizar WhatsApp'}
      </button>
      <span className="wa-refresh-status" aria-live="polite">
        {error
          ? <span className="wa-refresh-warn">{error}</span>
          : state.running
            ? 'Conferindo conexão e buscando respostas…'
            : state.lastAt
              ? <>Atualizado {timeAgo(state.lastAt)} · {summary(result)}</>
              : 'Ainda não atualizado nesta sessão'}
        {!state.running && offline > 0 && (
          <span className="wa-refresh-warn"> · {offline} número(s) salvo(s) fora do ar: respostas para eles só chegam quando reconectarem</span>
        )}
      </span>
    </div>
  );
}
