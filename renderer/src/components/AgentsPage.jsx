import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Bot, Play, RefreshCw, Copy, AlertTriangle } from 'lucide-react';
import { readLocalArray } from '../leadData';
import { useTriage } from '../useTriage';
import { SEGMENTS, triageFor } from '../triage.mjs';
import { timeAgo } from '../contactStatus.mjs';

const AUTO_AGENTS = new Set(['triagem', 'analista']);

function UsageBar({ used, limit }) {
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  return (
    <div className="agent-usage" title={`${used} de ${limit} hoje`}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

export default function AgentsPage({ onNavigate }) {
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [progress, setProgress] = useState(null);
  const [copied, setCopied] = useState(false);
  const triage = useTriage();

  const load = useCallback(async () => {
    const res = await window.agentsAPI?.getState?.();
    if (res?.success) setState(res);
  }, []);

  useEffect(() => {
    load();
    const offLog = window.agentsAPI?.onLog?.((entry) => {
      setState((current) => (current ? { ...current, log: [entry, ...(current.log || [])].slice(0, 60) } : current));
    });
    const offProgress = window.agentsAPI?.onProgress?.((p) => setProgress(p));
    return () => {
      if (typeof offLog === 'function') offLog();
      if (typeof offProgress === 'function') offProgress();
    };
  }, [load]);

  // Retrato da base pela triagem: onde estão as oportunidades agora.
  const baseSummary = useMemo(() => {
    const leads = readLocalArray('sigma_leads');
    const counts = {};
    let triaged = 0;
    for (const lead of leads) {
      const t = triageFor(triage, lead);
      if (!t) continue;
      triaged += 1;
      for (const seg of t.segments) counts[seg] = (counts[seg] || 0) + 1;
    }
    return { total: leads.length, triaged, counts, leads };
  }, [triage]);

  const update = async (id, patch) => {
    const res = await window.agentsAPI.update(id, patch);
    if (res?.success) setState((current) => ({ ...current, agents: res.agents, log: res.log, playbook: res.playbook }));
  };

  const run = async (id) => {
    setBusy(id);
    setMessage('');
    try {
      const payload = id === 'triagem' ? { leads: baseSummary.leads.filter((lead) => !triageFor(triage, lead)) } : {};
      const res = await window.agentsAPI.run(id, payload);
      if (!res?.success) throw new Error(res?.error || 'O agente não conseguiu rodar.');
      if (id === 'triagem') setMessage(res.triaged ? `${res.triaged} lead(s) triados · ${res.hot || 0} de alto potencial.` : 'Todos os leads da base já têm triagem.');
      if (id === 'analista') setMessage('Playbook atualizado. Os outros agentes já passam a segui-lo.');
      await load();
    } catch (error) {
      setMessage(error?.message || 'Falha ao rodar o agente.');
    } finally {
      setBusy('');
      setProgress(null);
    }
  };

  if (!state) return <section className="settings-open-design-view"><p className="camp-hint">Carregando agentes…</p></section>;
  const playbook = state.playbook;

  return (
    <section className="settings-open-design-view agents-page">
      <div className="page-head">
        <div>
          <h1 style={{ fontSize: 20 }}>Agentes de IA</h1>
          <p className="camp-hint" style={{ marginTop: 4, maxWidth: 720 }}>
            Cada agente cuida de uma etapa da prospecção. O Analista estuda os resultados e escreve um playbook que todos os outros seguem: o sistema melhora a cada campanha.
          </p>
        </div>
      </div>

      {!state.aiConfigured && (
        <div className="camp-alert od-alert" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <AlertTriangle size={15} />
          <span>A IA não está configurada: os agentes trabalham só com regras.</span>
          <button type="button" className="btn btn-sm btn-primary" onClick={() => onNavigate?.('ai')}>Configurar IA</button>
        </div>
      )}

      <div className="table-wrap settings-open-design-card">
        <h2 style={{ fontSize: 15, margin: 0 }}>Sua base agora</h2>
        <p className="camp-hint" style={{ margin: 0 }}>
          {baseSummary.triaged} de {baseSummary.total} lead(s) com triagem.
        </p>
        <div className="agent-segments">
          {Object.entries(SEGMENTS).map(([id, seg]) => (
            <div key={id} className="agent-segment" style={{ '--badge': seg.color }}>
              <b>{baseSummary.counts[id] || 0}</b>
              <span>{seg.label}</span>
            </div>
          ))}
        </div>
      </div>

      {message && <div className="camp-alert od-alert" role="status">{message}</div>}

      <div className="agents-grid">
        {state.agents.map((agent) => (
          <article key={agent.id} className={`agent-card ${agent.settings.enabled ? '' : 'off'}`}>
            <header>
              <span className="agent-icon"><Bot size={16} /></span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <h3>{agent.name}</h3>
                <p className="camp-hint" style={{ margin: 0 }}>{agent.trigger}</p>
              </div>
              <label className="agent-switch" title={agent.settings.enabled ? 'Desligar agente' : 'Ligar agente'}>
                <input type="checkbox" checked={agent.settings.enabled} onChange={(e) => update(agent.id, { enabled: e.target.checked })} />
                <span>{agent.settings.enabled ? 'Ligado' : 'Desligado'}</span>
              </label>
            </header>
            <p className="agent-role">{agent.role}</p>
            {AUTO_AGENTS.has(agent.id) && (
              <label className="agent-auto">
                <input type="checkbox" checked={agent.settings.auto} disabled={!agent.settings.enabled} onChange={(e) => update(agent.id, { auto: e.target.checked })} />
                Rodar automaticamente
              </label>
            )}
            <div className="agent-limit">
              <span>Limite: </span>
              <input
                type="number"
                min={0}
                max={5000}
                value={agent.settings.dailyLimit}
                onChange={(e) => update(agent.id, { dailyLimit: e.target.value })}
              />
              <span>{agent.unit}</span>
            </div>
            <UsageBar used={agent.usedToday} limit={agent.settings.dailyLimit} />
            <span className="camp-hint">Hoje: {agent.usedToday} usado(s) · {agent.remaining} restante(s){agent.tokensToday ? ` · ${agent.tokensToday.toLocaleString('pt-BR')} tokens` : ''}</span>
            {agent.id === 'triagem' && (
              <button type="button" className="btn btn-sm" disabled={!!busy || !agent.settings.enabled} onClick={() => run('triagem')}>
                <Play size={13} /> {busy === 'triagem' ? `Triando${progress?.agent === 'triagem' ? ` ${progress.done}/${progress.total}` : '…'}` : 'Triar leads sem triagem'}
              </button>
            )}
            {agent.id === 'analista' && (
              <button type="button" className="btn btn-sm" disabled={!!busy || !agent.settings.enabled || !state.aiConfigured} onClick={() => run('analista')}>
                <RefreshCw size={13} /> {busy === 'analista' ? 'Analisando…' : 'Atualizar playbook agora'}
              </button>
            )}
          </article>
        ))}
      </div>

      <div className="table-wrap settings-open-design-card">
        <h2 style={{ fontSize: 15, margin: 0 }}>Playbook do Analista</h2>
        {!playbook ? (
          <p className="camp-hint" style={{ margin: 0 }}>
            Ainda não existe. Ele é escrito sozinho a cada 25 envios, ou clique em “Atualizar playbook agora” (precisa de IA).
            {state.insights?.sent ? ` Você já tem ${state.insights.sent} envio(s) e ${state.insights.replyRate}% de resposta.` : ''}
          </p>
        ) : (
          <>
            <p className="camp-hint" style={{ margin: 0 }}>
              Atualizado {timeAgo(playbook.updatedAt)} com {playbook.basedOnSent} envio(s) · resposta {playbook.replyRate}%
            </p>
            <p style={{ margin: 0 }}>{playbook.resumo}</p>
            {playbook.regras?.length > 0 && <ul className="intel-list">{playbook.regras.map((r) => <li key={r}>{r}</li>)}</ul>}
            {(playbook.nichos?.length > 0 || playbook.horarios?.length > 0) && (
              <p className="camp-hint" style={{ margin: 0 }}>
                {playbook.nichos?.length ? `Nichos: ${playbook.nichos.join(', ')}` : ''}
                {playbook.horarios?.length ? ` · Horários: ${playbook.horarios.join(', ')}` : ''}
              </p>
            )}
            {playbook.mensagem_recomendada && (
              <>
                <div className="camp-msg-bubble" style={{ whiteSpace: 'pre-wrap' }}>{playbook.mensagem_recomendada}</div>
                <div>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={async () => {
                      try { await navigator.clipboard.writeText(playbook.mensagem_recomendada); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* sem clipboard */ }
                    }}
                  >
                    <Copy size={13} /> {copied ? 'Copiada!' : 'Copiar mensagem recomendada'}
                  </button>
                </div>
              </>
            )}
            {playbook.alertas?.length > 0 && <ul className="intel-list bad">{playbook.alertas.map((a) => <li key={a}>{a}</li>)}</ul>}
            {playbook.proximo_experimento && <p style={{ margin: 0 }}><b>Próximo teste:</b> {playbook.proximo_experimento}</p>}
          </>
        )}
      </div>

      <div className="table-wrap settings-open-design-card">
        <h2 style={{ fontSize: 15, margin: 0 }}>Atividade dos agentes</h2>
        {!state.log?.length ? (
          <p className="camp-hint" style={{ margin: 0 }}>Nenhuma atividade ainda.</p>
        ) : (
          <ul className="agent-log">
            {state.log.map((entry) => (
              <li key={`${entry.at}-${entry.agent}-${entry.text}`} className={entry.ok ? '' : 'fail'}>
                <span className="agent-log-time">{timeAgo(entry.at)}</span>
                <b>{state.agents.find((a) => a.id === entry.agent)?.name || entry.agent}</b>
                <span>{entry.text}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
