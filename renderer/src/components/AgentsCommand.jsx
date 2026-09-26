import React, { useEffect, useState } from 'react';
import { Play, Plus, Trash2, Copy, MessageCircle, X, Crosshair, Filter, Search, PenLine, MessagesSquare, LineChart, Globe, PhoneCall, Sparkle } from 'lucide-react';
import { timeAgo } from '../contactStatus.mjs';

// Ordem do fluxo na tela (a ordem de execução é do processo principal).
export const AGENT_META = {
  cacador: { name: 'Caçador', role: 'Busca leads novos no Google Maps quando o estoque baixa', color: '#f59e0b', Icon: Crosshair },
  radar: { name: 'Radar Web', role: 'Procura na web negócios com site fraco e audita no celular', color: '#38bdf8', Icon: Globe },
  verificador: { name: 'Verificador', role: 'Confere no WhatsApp quem da base tem conta; sem WhatsApp fica fora da fila', color: '#4ade80', Icon: PhoneCall },
  enriquecedor: { name: 'Enriquecedor', role: 'Abre o site de quem não tem WhatsApp e acha o número verdadeiro', color: '#fb7185', Icon: Sparkle },
  triagem: { name: 'Triagem', role: 'Separa quem tem problema real: sem site, site fraco, sem automação', color: '#22d3ee', Icon: Filter },
  pesquisador: { name: 'Pesquisador', role: 'Acha o dono, o CNPJ e a melhor abordagem dos leads quentes', color: '#a78bfa', Icon: Search },
  copywriter: { name: 'Copywriter', role: 'Escreve a primeira mensagem de cada lead e põe na fila', color: '#34d399', Icon: PenLine },
  respostas: { name: 'Respostas', role: 'Lê quem respondeu e prepara 3 respostas para você enviar', color: '#f472b6', Icon: MessagesSquare },
  analista: { name: 'Analista', role: 'Estuda os resultados e ajusta o playbook de todos', color: '#60a5fa', Icon: LineChart },
  sistema: { name: 'Sistema', color: '#94a3b8' },
  jarvis: { name: 'J.A.R.V.I.S.', color: '#67e8f9' },
  negocios: { name: 'Negócios', color: '#fbbf24' },
};
export const FLOW = ['cacador', 'radar', 'verificador', 'enriquecedor', 'triagem', 'pesquisador', 'copywriter', 'respostas', 'analista'];
const STATUS_TEXT = { working: 'Trabalhando', idle: 'De olho', done: 'Concluiu', error: 'Com erro', off: 'Pausado' };
const ETAPA = { abertura: 'Abertura', conexao: 'Conexão', dor: 'Dor', valor: 'Valor', oferta: 'Oferta', objecao: 'Objeção', contraproposta: 'Contraproposta', fechamento: 'Fechamento', perdido: 'Perdido' };
const MOMENTO = { interessado: 'Interessado', curioso: 'Curioso', duvida: 'Com dúvida', objecao: 'Objeção', sem_interesse: 'Sem interesse', pediu_para_sair: 'Pediu para sair' };

function nextIn(ts, now) {
  const min = Math.max(0, Math.round((ts - now) / 60000));
  if (min < 1) return 'agora';
  if (min < 60) return `em ${min} min`;
  return `em ${Math.round(min / 60)} h`;
}

/** Card de um agente: o que faz, o que está fazendo, liga/desliga e rodar agora. */
export function AgentCard({ stage, step, enabled, pilotOn, now, onRun, onToggle }) {
  const meta = AGENT_META[stage.agent] || AGENT_META.sistema;
  const status = !enabled && stage.live?.status !== 'working' ? 'off' : stage.live?.status || 'idle';
  const p = stage.live?.progress;
  const Icon = meta.Icon || Play;
  return (
    <article className={`ag-card is-${status}`} style={{ '--c': meta.color }}>
      <header>
        <span className="ag-ico"><Icon size={18} /></span>
        <div>
          <small>Etapa {step}</small>
          <h3>{meta.name}</h3>
        </div>
        <label className="ag-switch" title={enabled ? 'Pausar este agente' : 'Ligar este agente'}>
          <input type="checkbox" checked={enabled} onChange={(e) => onToggle(stage.id, e.target.checked)} />
          <i />
        </label>
      </header>
      <span className="ag-status"><i />{STATUS_TEXT[status] || status}</span>
      <p title={stage.live?.task || meta.role}>{stage.live?.task || meta.role}</p>
      {p?.total ? <div className="ag-progress"><span style={{ width: `${Math.round((p.done / p.total) * 100)}%` }} /></div> : null}
      <footer>
        <span><b>{stage.today}</b> hoje</span>
        <span>{enabled && pilotOn ? `próxima ${nextIn(stage.nextRunAt, now)}` : enabled ? 'aguardando o piloto' : 'pausado'}</span>
        <button type="button" disabled={status === 'working'} onClick={() => onRun(stage.id)} title="Rodar agora"><Play size={12} /> Rodar</button>
      </footer>
    </article>
  );
}

export function ReplyCard({ phone, draft, onNavigate }) {
  const [copied, setCopied] = useState(-1);
  const use = (text) => {
    window.__p4j3PendingChat = { phone, name: draft.name, text };
    window.dispatchEvent(new CustomEvent('sigma:open-chat', { detail: { phone, name: draft.name, text } }));
    onNavigate?.('whatsapp');
  };
  const copy = async (text, index) => {
    try { await navigator.clipboard.writeText(text); setCopied(index); setTimeout(() => setCopied(-1), 1400); } catch { /* sem clipboard */ }
  };
  return (
    <article className="ap-reply">
      <header>
        <div>
          <b>{draft.name || `+55 ${phone}`}</b>
          <span className={`ap-chip m-${draft.momento}`}>{MOMENTO[draft.momento] || draft.momento}</span>
          {draft.etapa && <span className="ap-chip stage">Etapa: {ETAPA[draft.etapa] || draft.etapa}</span>}
        </div>
        <button type="button" className="ap-icon" title="Dispensar" onClick={() => window.autopilotAPI.dismissReply(phone)}><X size={14} /></button>
      </header>
      {draft.ultimaMensagem && <blockquote>“{draft.ultimaMensagem}”</blockquote>}
      {draft.leitura && <p className="ap-reading">{draft.leitura}</p>}
      {draft.time && <p className="ap-reading"><b>Time do cliente:</b> {draft.time}</p>}
      <ol>
        {(draft.sugestoes || []).map((text, index) => (
          <li key={text}>
            <p>{text}</p>
            <div>
              <button type="button" className="ap-mini primary" onClick={() => use(text)}><MessageCircle size={12} /> Abrir conversa com esta</button>
              <button type="button" className="ap-mini" onClick={() => copy(text, index)}><Copy size={12} /> {copied === index ? 'Copiada' : 'Copiar'}</button>
            </div>
          </li>
        ))}
      </ol>
      {draft.proximoPasso && <p className="ap-next">Próximo passo: {draft.proximoPasso}</p>}
      {draft.proposta?.proposta && (
        <details className="ap-proposal">
          <summary>📄 Proposta pronta: {draft.proposta.titulo}</summary>
          <p>{draft.proposta.proposta}</p>
          <button type="button" className="ap-mini primary" onClick={() => use(draft.proposta.proposta)}><MessageCircle size={12} /> Abrir conversa com a proposta</button>
        </details>
      )}
      <span className="ap-when">preparada {timeAgo(draft.at)}</span>
    </article>
  );
}

export function Missions({ settings, onSave, plan }) {
  const [rows, setRows] = useState(settings.missions || []);
  const [dirty, setDirty] = useState(false);
  useEffect(() => { if (!dirty) setRows(settings.missions || []); }, [settings.missions, dirty]);
  const set = (i, patch) => { setRows((r) => r.map((row, idx) => (idx === i ? { ...row, ...patch } : row))); setDirty(true); };
  const save = async () => {
    await onSave({
      missions: rows.map((r) => ({ ...r, neighborhoods: Array.isArray(r.neighborhoods) ? r.neighborhoods : String(r.neighborhoods || '').split(',') })),
    });
    setDirty(false);
  };
  return (
    <section className="ap-panel">
      <header className="ap-panel-head">
        <h2>Missões do Caçador</h2>
        <span>Quando os leads disponíveis ficam abaixo do mínimo, o Caçador (Maps) e o Radar (web) caçam a próxima missão.</span>
      </header>
      <div className="ap-plan">
        <label className="ap-plan-toggle">
          <input type="checkbox" checked={settings.autoMissions !== false} onChange={(e) => onSave({ autoMissions: e.target.checked })} />
          <span><b>Plano Brasil automático</b> — {plan?.niches || 0} nichos (prioridade ticket R$ 300–500) × {plan?.areas || 0} regiões: todo o DF primeiro, depois entorno e capitais. Suas missões abaixo entram intercaladas.</span>
        </label>
        {settings.autoMissions !== false && plan?.progress && (
          <div className="ap-plan-progress">
            {[['cacador', 'Caçador (Maps)', '#f59e0b'], ['radar', 'Radar (web)', '#38bdf8']].map(([id, label, color]) => {
              const p = plan.progress[id];
              return (
                <div key={id} style={{ '--c': color }}>
                  <span>{label}</span>
                  <div className="ai-bar"><i style={{ width: `${Math.max(1, Math.round(((p?.done || 0) / (p?.total || 1)) * 100))}%`, background: color }} /></div>
                  <small>{p?.done || 0}/{p?.total || 0}{p?.current ? ` · última: ${p.current.niche} em ${p.current.city}` : ' · começa por barbearia em Ceilândia'}</small>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <div className="ap-missions">
        {rows.map((row, i) => (
          <div key={i} className={`ap-mission ${row.active === false ? 'off' : ''}`}>
            <input value={row.niche} placeholder="Nicho (ex.: clínica de estética)" onChange={(e) => set(i, { niche: e.target.value })} />
            <input value={row.city} placeholder="Cidade, UF (ex.: Brasília, DF)" onChange={(e) => set(i, { city: e.target.value })} />
            <input
              value={Array.isArray(row.neighborhoods) ? row.neighborhoods.join(', ') : row.neighborhoods || ''}
              placeholder="Bairros (opcional, separados por vírgula)"
              onChange={(e) => set(i, { neighborhoods: e.target.value })}
            />
            <label><input type="checkbox" checked={row.active !== false} onChange={(e) => set(i, { active: e.target.checked })} /> ativa</label>
            <button type="button" className="ap-icon" title="Remover" onClick={() => { setRows((r) => r.filter((_, idx) => idx !== i)); setDirty(true); }}><Trash2 size={14} /></button>
          </div>
        ))}
        <div className="ap-missions-actions">
          <button type="button" className="ap-mini" onClick={() => { setRows((r) => [...r, { niche: '', city: '', neighborhoods: [], active: true }]); setDirty(true); }}>
            <Plus size={12} /> Nova missão
          </button>
          {dirty && <button type="button" className="ap-mini primary" onClick={save}>Salvar missões</button>}
        </div>
      </div>
      <div className="ap-knobs">
        <label>Mínimo de leads disponíveis <input type="number" min={0} max={500} value={settings.reserveLeads} onChange={(e) => onSave({ reserveLeads: e.target.value })} /></label>
        <label>Leads novos por caçada <input type="number" min={5} max={500} value={settings.huntGoal} onChange={(e) => onSave({ huntGoal: e.target.value })} /></label>
        <label>Mensagens esperando aprovação <input type="number" min={0} max={300} value={settings.draftTarget} onChange={(e) => onSave({ draftTarget: e.target.value })} /></label>
        <label>Pesquisas por rodada <input type="number" min={1} max={20} value={settings.researchPerRun} onChange={(e) => onSave({ researchPerRun: e.target.value })} /></label>
      </div>
    </section>
  );
}
