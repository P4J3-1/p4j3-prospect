import React, { useEffect, useMemo, useState } from 'react';
import { Zap, MessageCircle, RefreshCw } from 'lucide-react';
import { readLocalArray } from '../leadData';
import { useContactStatus, useWaCheck } from '../useContactStatus';
import { useTriage } from '../useTriage';
import { useQueue } from '../useQueue';
import { useLeadMemory } from '../useLeadMemory';
import { CONTACT_STATUS } from '../contactStatus.mjs';
import { dailyBriefing, resultsBy, topIntent } from '../intel.mjs';
import { critique, KINDS } from '../critic.mjs';
import { runSuggestion } from '../runSuggestion';
import { useDeals } from '../useDeals';

/**
 * Núcleo J.A.R.V.I.S.: briefing do dia, quem agir agora (intenção) e o que
 * rende por nicho/região. Tudo ao vivo com os dados do WhatsApp e da base.
 */
export default function JarvisCore({ autopilot, onNavigate }) {
  const contacts = useContactStatus();
  const waCheck = useWaCheck();
  const triage = useTriage();
  const queue = useQueue();
  const memory = useLeadMemory();
  const deals = useDeals();
  const [name, setName] = useState('');
  const [by, setBy] = useState('nicho');
  const [leadsVersion, setLeadsVersion] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [busyId, setBusyId] = useState('');
  const [showAll, setShowAll] = useState(false);
  // Reavalia sozinho a cada minuto (tudo local, sem gastar IA).
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    window.leadScoringAPI?.getSettings?.().then((res) => setName(res?.settings?.commercial?.sellerName || '')).catch(() => {});
    const onLeads = () => setLeadsVersion((v) => v + 1);
    window.addEventListener('sigma:leads-updated', onLeads);
    return () => window.removeEventListener('sigma:leads-updated', onLeads);
  }, []);

  const leads = useMemo(() => readLocalArray('sigma_leads'), [leadsVersion, contacts]); // eslint-disable-line react-hooks/exhaustive-deps
  const briefing = useMemo(
    () => dailyBriefing({ name, leads, contacts, queue, autopilot, triage, waCheck, now }),
    [name, leads, contacts, queue, autopilot, triage, waCheck, now],
  );
  const suggestions = useMemo(
    () => critique({ leads, contacts, queue, autopilot, triage, waCheck, memory, deals, now }),
    [leads, contacts, queue, autopilot, triage, waCheck, memory, deals, now],
  );
  const hot = useMemo(() => topIntent(leads, { contacts, triage, memory }), [leads, contacts, triage, memory]);
  const results = useMemo(() => resultsBy(leads, contacts, by).slice(0, 6), [leads, contacts, by]);
  const working = (autopilot?.stages || []).filter((s) => s.live?.status === 'working').length;

  const run = async (item) => {
    if (!item?.acao || busyId) return;
    setBusyId(item.id);
    try { await runSuggestion(item.acao, onNavigate); } finally { setBusyId(''); }
  };
  const visible = showAll ? suggestions : suggestions.slice(0, 5);

  const openChat = (item) => {
    window.__p4j3PendingChat = { phone: item.key, name: item.lead.name, text: '' };
    window.dispatchEvent(new CustomEvent('sigma:open-chat', { detail: { phone: item.key, name: item.lead.name } }));
    onNavigate?.('whatsapp');
  };

  return (
    <section className="jv" aria-label="J.A.R.V.I.S.">
      <div className="jv-core-wrap">
        <div className={`jv-core ${working ? 'busy' : ''} ${autopilot?.settings?.enabled ? 'on' : ''}`} aria-hidden="true">
          <span className="r r1" /><span className="r r2" /><span className="r r3" />
          <span className="jv-core-dot" />
        </div>
        <b className="jv-name">J.A.R.V.I.S.</b>
        <small>{working ? `${working} agente(s) em ação` : autopilot?.settings?.enabled ? 'monitorando' : 'em espera'}</small>
        <button type="button" className="jv-talk" onClick={() => window.dispatchEvent(new CustomEvent('sigma:jarvis-open'))}>Dar uma ordem · Ctrl+J</button>
      </div>

      <div className="jv-brief">
        <h2>{briefing.saudacao}</h2>
        <ul>
          {briefing.linhas.map((l) => <li key={l}>{l}</li>)}
        </ul>
      </div>

      <div className="jv-sugs">
        <div className="jv-results-head">
          <h3>Sugestões <em>crítico · ao vivo</em></h3>
          <button type="button" className="jv-refresh" title="Reavaliar agora" onClick={() => setNow(Date.now())}><RefreshCw size={13} /></button>
        </div>
        {!suggestions.length ? (
          <p className="ap-empty">Tudo em dia, senhor. Nada pendente agora.</p>
        ) : (
          <ul>
            {visible.map((item) => (
              <li key={item.id} className="jv-sug" style={{ '--c': KINDS[item.kind]?.color }}>
                <div>
                  <small>{KINDS[item.kind]?.label}</small>
                  <b>{item.titulo}</b>
                  <span>{item.detalhe}</span>
                </div>
                {item.acao && (
                  <button type="button" disabled={Boolean(busyId)} onClick={() => run(item)}>
                    <Zap size={13} /> {busyId === item.id ? 'Fazendo…' : item.acao.texto}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {suggestions.length > 5 && (
          <button type="button" className="jv-more" onClick={() => setShowAll((v) => !v)}>
            {showAll ? 'Mostrar menos' : `Ver todas (${suggestions.length})`}
          </button>
        )}
      </div>

      <div className="jv-hot">
        <h3>Agir agora <em>intenção</em></h3>
        {!hot.length ? (
          <p className="ap-empty">Ninguém aquecido ainda. Quando os leads lerem ou responderem, eles sobem aqui.</p>
        ) : (
          <ol>
            {hot.map((item) => (
              <li key={item.key}>
                <button type="button" onClick={() => openChat(item)} title="Abrir a conversa">
                  <span className="jv-score" style={{ '--v': item.score }}><b>{item.score}</b></span>
                  <span className="jv-hot-name">{item.lead.name}</span>
                  <span className="jv-hot-status" style={{ '--c': CONTACT_STATUS[item.contact?.status]?.color || '#94a3b8' }}>
                    {CONTACT_STATUS[item.contact?.status]?.short || ''}
                  </span>
                  <MessageCircle size={13} />
                </button>
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="jv-results">
        <div className="jv-results-head">
          <h3>O que rende</h3>
          <div role="tablist">
            {[['nicho', 'Nicho'], ['regiao', 'Região']].map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={by === id} className={by === id ? 'on' : ''} onClick={() => setBy(id)}>{label}</button>
            ))}
          </div>
        </div>
        {!results.length ? (
          <p className="ap-empty">Os resultados aparecem conforme os contatos forem feitos.</p>
        ) : (
          <ul>
            {results.map((g) => (
              <li key={g.key}>
                <span className="jv-r-name">{g.key}</span>
                <div className="jv-r-bar"><i style={{ width: `${Math.max(3, g.rate)}%` }} /></div>
                <span className="jv-r-num">{g.rate}% <small>({g.replied}/{g.sent})</small></span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
