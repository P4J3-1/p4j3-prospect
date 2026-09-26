import React, { useEffect, useMemo, useState } from 'react';
import { Zap, RefreshCw, Settings2 } from 'lucide-react';
import { readLocalArray } from '../leadData';
import { useContactStatus, useWaCheck } from '../useContactStatus';
import { useTriage } from '../useTriage';
import { useQueue } from '../useQueue';
import { useLeadMemory } from '../useLeadMemory';
import { useAutopilot } from '../useAutopilot';
import { resultsBy } from '../intel.mjs';
import { critique, KINDS } from '../critic.mjs';
import { runSuggestion } from '../runSuggestion';
import { useDeals } from '../useDeals';

const COLUMNS = ['agir', 'oportunidade', 'feedback'];

/** Funil acumulado: quem respondeu também foi entregue e lido. */
function funnelOf(contacts) {
  const f = { enviados: 0, entregues: 0, lidos: 0, responderam: 0, sairam: 0 };
  for (const c of Object.values(contacts || {})) {
    if (!c || c.status === 'nao_contatar') continue;
    f.enviados += 1;
    if (['entregue', 'lido', 'respondeu'].includes(c.status)) f.entregues += 1;
    if (['lido', 'respondeu'].includes(c.status)) f.lidos += 1;
    if (c.status === 'respondeu') f.responderam += 1;
    if (c.status === 'descadastrado') f.sairam += 1;
  }
  return f;
}

/**
 * Inteligência: o Agente Crítico lê o funil inteiro e aponta o que fazer,
 * as oportunidades e os pontos fracos, cada um com a ação pronta.
 */
export default function IntelligencePage({ onNavigate }) {
  const contacts = useContactStatus();
  const waCheck = useWaCheck();
  const triage = useTriage();
  const queue = useQueue();
  const memory = useLeadMemory();
  const [autopilot] = useAutopilot();
  const deals = useDeals();
  const [leadsVersion, setLeadsVersion] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [busyId, setBusyId] = useState('');
  const [done, setDone] = useState({});

  useEffect(() => {
    const onLeads = () => setLeadsVersion((v) => v + 1);
    const t = setInterval(() => setNow(Date.now()), 60000);
    window.addEventListener('sigma:leads-updated', onLeads);
    return () => { clearInterval(t); window.removeEventListener('sigma:leads-updated', onLeads); };
  }, []);

  const leads = useMemo(() => readLocalArray('sigma_leads'), [leadsVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  const items = useMemo(
    () => critique({ leads, contacts, queue, autopilot, triage, waCheck, memory, deals, now }),
    [leads, contacts, queue, autopilot, triage, waCheck, memory, deals, now],
  );
  const funnel = useMemo(() => funnelOf(contacts), [contacts]);
  const niches = useMemo(() => resultsBy(leads, contacts, 'nicho').filter((g) => g.sent >= 3).slice(0, 8), [leads, contacts]);
  const regions = useMemo(() => resultsBy(leads, contacts, 'regiao').filter((g) => g.sent >= 3).slice(0, 8), [leads, contacts]);
  const waiting = items.filter((x) => x.id.startsWith('responder:')).length;
  const rate = funnel.enviados ? Math.round((funnel.responderam / funnel.enviados) * 100) : 0;

  const run = async (item) => {
    if (!item.acao || busyId) return;
    setBusyId(item.id);
    try {
      const reply = await runSuggestion(item.acao, onNavigate);
      setDone((d) => ({ ...d, [item.id]: reply || 'Feito.' }));
    } finally {
      setBusyId('');
    }
  };

  const steps = [
    ['Enviados', funnel.enviados],
    ['Entregues', funnel.entregues],
    ['Lidos', funnel.lidos],
    ['Responderam', funnel.responderam],
  ];

  return (
    <section className="ap-shell ig">
      <header className="ag-top">
        <div className="ag-title">
          <span className="ap-kicker">Inteligência · Agente Crítico</span>
          <h1>O que fazer agora, o que rende e o que corrigir</h1>
          <p>Lê conversas, fila, base, nichos e regiões a cada minuto. <b>Cada ponto já vem com a ação pronta.</b></p>
        </div>
        <div className="ig-head-actions">
          <button type="button" className="ag-power" onClick={() => setNow(Date.now())}><RefreshCw size={16} /><span><b>Reavaliar</b><small>sem gastar IA</small></span></button>
          <button
            type="button"
            className="ag-power"
            onClick={() => { window.__p4j3AgentsTab = 'motor'; window.dispatchEvent(new CustomEvent('sigma:agents-tab', { detail: 'motor' })); onNavigate?.('agents'); }}
          >
            <Settings2 size={16} /><span><b>Motor de IA</b><small>chave, modelo e ofertas</small></span>
          </button>
        </div>
      </header>

      <div className="ag-kpis">
        <div className="ag-kpi" style={{ '--c': '#38bdf8' }}><b>{funnel.enviados}</b><span>contatos feitos</span></div>
        <div className="ag-kpi" style={{ '--c': '#34d399' }}><b>{funnel.responderam}</b><span>responderam ({rate}%)</span></div>
        <div className="ag-kpi" style={{ '--c': '#f472b6' }}><b>{waiting}</b><span>esperando você</span></div>
        <div className="ag-kpi" style={{ '--c': '#fbbf24' }}><b>{(queue.items || []).filter((i) => i.status === 'rascunho').length}</b><span>na fila para aprovar</span></div>
        <div className="ag-kpi" style={{ '--c': '#f87171' }}><b>{funnel.sairam}</b><span>pediram para sair</span></div>
      </div>

      <div className="ig-funnel" aria-label="Funil">
        {steps.map(([label, value], i) => {
          const prev = i ? steps[i - 1][1] : value;
          const pct = prev ? Math.round((value / prev) * 100) : 0;
          return (
            <div key={label}>
              <span>{label}</span>
              <b>{value}</b>
              <div className="ag-progress"><span style={{ width: `${funnel.enviados ? Math.max(2, (value / funnel.enviados) * 100) : 0}%`, background: '#67e8f9' }} /></div>
              {i > 0 && <small>{pct}% da etapa anterior</small>}
            </div>
          );
        })}
      </div>

      <div className="ig-cols">
        {COLUMNS.map((kind) => {
          const list = items.filter((x) => x.kind === kind);
          return (
            <section key={kind} className="ag-panel" style={{ '--c': KINDS[kind].color }}>
              <h2><i className="ig-dot" /> {KINDS[kind].label} <em className="ig-count">{list.length}</em></h2>
              {!list.length && <p className="ag-hint">Nada aqui agora.</p>}
              <ul className="ig-list">
                {list.map((item) => (
                  <li key={item.id} className="jv-sug" style={{ '--c': KINDS[kind].color }}>
                    <div>
                      <b>{item.titulo}</b>
                      <span>{done[item.id] || item.detalhe}</span>
                    </div>
                    {item.acao && (
                      <button type="button" disabled={Boolean(busyId)} onClick={() => run(item)}>
                        <Zap size={13} /> {busyId === item.id ? 'Fazendo…' : item.acao.texto}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>

      <div className="ag-two" style={{ marginTop: 14 }}>
        {[['Nichos', niches], ['Regiões', regions]].map(([title, rows]) => (
          <section key={title} className="ag-panel jv-results">
            <h2>O que rende · {title}</h2>
            {!rows.length ? <p className="ag-hint">Aparece a partir de 3 contatos por grupo.</p> : (
              <ul>
                {rows.map((g) => (
                  <li key={g.key}>
                    <span className="jv-r-name">{g.key}</span>
                    <div className="jv-r-bar"><i style={{ width: `${Math.max(3, g.rate)}%` }} /></div>
                    <span className="jv-r-num">{g.rate}% <small>({g.replied}/{g.sent})</small></span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
    </section>
  );
}
