import React, { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { Bot, Play, RefreshCw, Copy, Power } from 'lucide-react';
import { readLocalArray } from '../leadData';
import { useTriage } from '../useTriage';
import { useAutopilot } from '../useAutopilot';
import { SEGMENTS, triageFor } from '../triage.mjs';
import { liveReplyDrafts, timeAgo } from '../contactStatus.mjs';
import { useContactStatus } from '../useContactStatus';
import { AGENT_META, FLOW, AgentCard, ReplyCard, Missions } from './AgentsCommand';
import XrayPanel from './XrayPanel';

const AiSettingsPage = lazy(() => import('./AiSettingsPage'));

const AUTO_AGENTS = new Set(['triagem', 'analista']);
const TABS = [
  ['equipe', 'Equipe'],
  ['respostas', 'Respostas'],
  ['missoes', 'Missões'],
  ['ajustes', 'Ajustes de IA'],
  ['motor', 'Motor de IA'],
  ['atividade', 'Atividade'],
];
const TODAY = [
  ['cacador', 'leads caçados'],
  ['radar', 'sites fracos'],
  ['pesquisador', 'pesquisados'],
  ['copywriter', 'mensagens escritas'],
  ['respostas', 'respostas prontas'],
];

function readTab() {
  try {
    const pending = window.__p4j3AgentsTab;
    window.__p4j3AgentsTab = null;
    const saved = pending || localStorage.getItem('sigma_agents_tab');
    return TABS.some(([id]) => id === saved) ? saved : 'equipe';
  } catch {
    return 'equipe';
  }
}

/** Configuração de cada agente de IA (liga/desliga, automático, limite). */
function AiAgentsTab({ state, onUpdate, onRun, busy, progress, baseSummary }) {
  return (
    <div className="ag-stack">
      <section className="ag-panel">
        <h2>Sua base agora</h2>
        <p className="ag-hint">{baseSummary.triaged} de {baseSummary.total} lead(s) com triagem.</p>
        <div className="agent-segments">
          {Object.entries(SEGMENTS).map(([id, seg]) => (
            <div key={id} className="agent-segment" style={{ '--badge': seg.color }}>
              <b>{baseSummary.counts[id] || 0}</b>
              <span>{seg.label}</span>
            </div>
          ))}
        </div>
      </section>
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
                <input type="checkbox" checked={agent.settings.enabled} onChange={(e) => onUpdate(agent.id, { enabled: e.target.checked })} />
                <span>{agent.settings.enabled ? 'Ligado' : 'Desligado'}</span>
              </label>
            </header>
            <p className="agent-role">{agent.role}</p>
            {AUTO_AGENTS.has(agent.id) && (
              <label className="agent-auto">
                <input type="checkbox" checked={agent.settings.auto} disabled={!agent.settings.enabled} onChange={(e) => onUpdate(agent.id, { auto: e.target.checked })} />
                Rodar automaticamente
              </label>
            )}
            <label className="agent-auto">
              <input type="checkbox" checked={agent.settings.unlimited !== false} disabled={!agent.settings.enabled} onChange={(e) => onUpdate(agent.id, { unlimited: e.target.checked })} />
              Sem limite diário (o limite é o saldo da DeepSeek)
            </label>
            {agent.settings.unlimited === false && (
              <div className="agent-limit">
                <span>Limite: </span>
                <input type="number" min={0} max={5000} value={agent.settings.dailyLimit} onChange={(e) => onUpdate(agent.id, { dailyLimit: e.target.value })} />
                <span>{agent.unit}</span>
              </div>
            )}
            <span className="camp-hint">Hoje: {agent.usedToday} chamada(s){agent.settings.unlimited === false ? ` · ${agent.remaining} restante(s)` : ''}{agent.tokensToday ? ` · ${agent.tokensToday.toLocaleString('pt-BR')} tokens` : ''}</span>
            {agent.id === 'triagem' && (
              <button type="button" className="btn btn-sm" disabled={!!busy || !agent.settings.enabled} onClick={() => onRun('triagem')}>
                <Play size={13} /> {busy === 'triagem' ? `Triando${progress?.agent === 'triagem' ? ` ${progress.done}/${progress.total}` : '…'}` : 'Triar leads sem triagem'}
              </button>
            )}
            {agent.id === 'analista' && (
              <button type="button" className="btn btn-sm" disabled={!!busy || !agent.settings.enabled || !state.aiConfigured} onClick={() => onRun('analista')}>
                <RefreshCw size={13} /> {busy === 'analista' ? 'Analisando…' : 'Atualizar playbook agora'}
              </button>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}

function Playbook({ playbook, insights }) {
  const [copied, setCopied] = useState(false);
  return (
    <section className="ag-panel">
      <h2>Playbook do Analista</h2>
      {!playbook ? (
        <p className="ag-hint">
          Ainda não existe. Ele é escrito sozinho a cada 25 envios, ou em Ajustes de IA → “Atualizar playbook agora”.
          {insights?.sent ? ` Você já tem ${insights.sent} envio(s) e ${insights.replyRate}% de resposta.` : ''}
        </p>
      ) : (
        <>
          <p className="ag-hint">Atualizado {timeAgo(playbook.updatedAt)} com {playbook.basedOnSent} envio(s) · resposta {playbook.replyRate}%</p>
          <p style={{ margin: 0 }}>{playbook.resumo}</p>
          {playbook.regras?.length > 0 && <ul className="intel-list">{playbook.regras.map((r) => <li key={r}>{r}</li>)}</ul>}
          {playbook.mensagem_recomendada && (
            <>
              <div className="camp-msg-bubble" style={{ whiteSpace: 'pre-wrap' }}>{playbook.mensagem_recomendada}</div>
              <div>
                <button type="button" className="btn btn-sm" onClick={async () => { try { await navigator.clipboard.writeText(playbook.mensagem_recomendada); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* sem clipboard */ } }}>
                  <Copy size={13} /> {copied ? 'Copiada!' : 'Copiar mensagem recomendada'}
                </button>
              </div>
            </>
          )}
          {playbook.alertas?.length > 0 && <ul className="intel-list bad">{playbook.alertas.map((a) => <li key={a}>{a}</li>)}</ul>}
          {playbook.proximo_experimento && <p style={{ margin: 0 }}><b>Próximo teste:</b> {playbook.proximo_experimento}</p>}
        </>
      )}
    </section>
  );
}

/** Central de Agentes: uma tela, abas rápidas (só a aba aberta é desenhada). */
export default function AgentsPage({ onNavigate }) {
  const [auto, setAuto] = useAutopilot();
  const [state, setState] = useState(null);
  const [tab, setTabState] = useState(readTab);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [progress, setProgress] = useState(null);
  const [now, setNow] = useState(Date.now());
  const triage = useTriage();
  const contacts = useContactStatus();

  const setTab = (id) => {
    setTabState(id);
    try { localStorage.setItem('sigma_agents_tab', id); } catch { /* sem storage */ }
  };

  const load = useCallback(async () => {
    const res = await window.agentsAPI?.getState?.();
    if (res?.success) setState(res);
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(() => setNow(Date.now()), 15000);
    const onTab = (e) => e.detail && setTab(e.detail);
    window.addEventListener('sigma:agents-tab', onTab);
    const offLog = window.agentsAPI?.onLog?.((entry) => {
      setState((current) => (current ? { ...current, log: [entry, ...(current.log || [])].slice(0, 60) } : current));
    });
    const offProgress = window.agentsAPI?.onProgress?.((p) => setProgress(p));
    return () => {
      clearInterval(t);
      window.removeEventListener('sigma:agents-tab', onTab);
      if (typeof offLog === 'function') offLog();
      if (typeof offProgress === 'function') offProgress();
    };
  }, [load]);

  const baseSummary = useMemo(() => {
    if (tab !== 'ajustes') return { total: 0, triaged: 0, counts: {}, leads: [] };
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
  }, [triage, tab]);

  const stages = useMemo(() => {
    const byId = Object.fromEntries((auto?.stages || []).map((s) => [s.id, s]));
    return FLOW.map((id) => byId[id]).filter(Boolean);
  }, [auto?.stages]);
  // Só as que ainda valem (o lead respondeu e você ainda não falou depois).
  const replies = Object.entries(liveReplyDrafts(auto?.replyDrafts, contacts)).sort((a, b) => (b[1].at || 0) - (a[1].at || 0));

  const savePilot = async (patch) => {
    setMessage('');
    const res = await window.autopilotAPI.settings(patch);
    if (!res?.success) setMessage(res?.error || 'Não foi possível salvar.');
    else setAuto((current) => ({ ...current, ...res }));
  };
  const runStage = async (stageId) => {
    setMessage('');
    const res = await window.autopilotAPI.runNow(stageId);
    if (!res?.success && res?.error) setMessage(res.error);
  };
  const updateAgent = async (id, patch) => {
    const res = await window.agentsAPI.update(id, patch);
    if (res?.success) setState((current) => ({ ...current, agents: res.agents, log: res.log, playbook: res.playbook }));
  };
  const runAgent = async (id) => {
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

  const enabled = !!auto?.settings?.enabled;
  const disabled = new Set(auto?.settings?.disabledStages || []);
  const working = stages.filter((s) => s.live?.status === 'working').length;

  return (
    <section className={`ap-shell ag ${enabled ? 'on' : ''}`}>
      <header className="ag-top">
        <div className="ag-title">
          <span className="ap-kicker">Central de Agentes</span>
          <h1>Sua equipe de prospecção</h1>
          <p>Caçam, triam, pesquisam, escrevem e leem respostas 24h. <b>Nada sai sem você.</b></p>
        </div>
        <button type="button" className={`ag-power ${enabled ? 'on' : ''}`} onClick={() => savePilot({ enabled: !enabled })} aria-pressed={enabled}>
          <Power size={20} />
          <span>
            <b>Piloto {enabled ? 'ligado' : 'desligado'}</b>
            <small>{enabled ? (working ? `${working} agente(s) trabalhando` : 'de olho, no ritmo de cada um') : 'Clique para começar'}</small>
          </span>
        </button>
      </header>

      <div className="ag-kpis" aria-label="Hoje">
        {TODAY.map(([id, label]) => {
          const meta = AGENT_META[id];
          const stage = stages.find((s) => s.id === id);
          const Icon = meta?.Icon;
          return (
            <div key={id} className="ag-kpi" style={{ '--c': meta?.color }}>
              {Icon && <Icon size={15} />}
              <b>{stage?.today ?? 0}</b>
              <span>{label} hoje</span>
            </div>
          );
        })}
      </div>

      {state && !state.aiConfigured && (
        <div className="ap-alert">Sem IA configurada, os agentes trabalham só com regras.
          <button type="button" onClick={() => setTab('motor')}>Configurar IA</button>
        </div>
      )}
      {message && <div className="ap-alert" role="status">{message}</div>}

      <nav className="ag-tabs" role="tablist">
        {TABS.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
            {label}{id === 'respostas' && replies.length ? <em>{replies.length}</em> : null}
          </button>
        ))}
      </nav>

      {!auto && tab !== 'motor' ? <p className="ap-empty">Carregando…</p> : null}

      {auto && tab === 'equipe' && (
        <div className="ag-team">
          {stages.map((stage, i) => (
            <AgentCard
              key={stage.id}
              stage={stage}
              step={i + 1}
              enabled={!disabled.has(stage.id)}
              pilotOn={enabled}
              now={now}
              onRun={runStage}
              onToggle={(id, on) => savePilot({ stage: id, on })}
            />
          ))}
        </div>
      )}

      {auto && tab === 'respostas' && (
        !replies.length
          ? <p className="ap-empty">Nenhuma conversa esperando você. Quando um lead responder, o agente lê e prepara as respostas aqui.</p>
          : <div className="ap-replies ag-replies">{replies.map(([phone, draft]) => <ReplyCard key={phone} phone={phone} draft={draft} onNavigate={onNavigate} />)}</div>
      )}

      {auto && tab === 'missoes' && <Missions settings={auto.settings} onSave={savePilot} plan={auto.plan} />}

      {tab === 'ajustes' && (state ? <div className="ag-light"> <AiAgentsTab state={state} onUpdate={updateAgent} onRun={runAgent} busy={busy} progress={progress} baseSummary={baseSummary} /></div> : <p className="ap-empty">Carregando…</p>)}

      {tab === 'motor' && (
        <div className="ag-light">
          <Suspense fallback={<p className="ap-empty">Carregando…</p>}>
            <AiSettingsPage />
          </Suspense>
        </div>
      )}

      {tab === 'atividade' && (
        <div className="ag-stack">
          <div className="ag-two">
            <section className="ag-panel">
              <h2><span className={`ap-live-dot ${enabled ? 'on' : ''}`} /> Ao vivo</h2>
              <ul className="ap-feed">
                {!(auto?.feed || []).length && <li className="ap-empty">Ligue o piloto automático para ver os agentes trabalhando.</li>}
                {(auto?.feed || []).map((entry) => {
                  const meta = AGENT_META[entry.agent] || AGENT_META.sistema;
                  return (
                    <li key={`${entry.at}-${entry.agent}-${entry.text}`} className={`k-${entry.kind}`} style={{ '--c': meta.color }}>
                      <i />
                      <div>
                        <b>{meta.name}</b> <span className="ap-time">{timeAgo(entry.at, now)}</span>
                        <p>{entry.text}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
            <section className="ag-panel">
              <h2>Chamadas de IA</h2>
              {!state?.log?.length ? <p className="ag-hint">Nenhuma atividade ainda.</p> : (
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
            </section>
          </div>
          <Playbook playbook={state?.playbook} insights={state?.insights} />
          <XrayPanel />
        </div>
      )}
    </section>
  );
}
