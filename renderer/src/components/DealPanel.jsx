import React, { useEffect, useState } from 'react';
import { CalendarClock, Check, X } from 'lucide-react';
import { phoneCore } from '../contactStatus.mjs';
import { useDeals } from '../useDeals';

const toLocalInput = (ts) => {
  if (!ts) return '';
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/**
 * Campos do negócio na conversa: etapa do funil, agendamento (o Agente de
 * Negócios detecta na conversa; você confirma ou corrige), valor e próximo passo.
 */
export default function DealPanel({ phone }) {
  const key = phoneCore(phone);
  const deals = useDeals();
  const deal = deals[key] || {};
  const [card, setCard] = useState(null);
  const [columns, setColumns] = useState([]);
  const [meeting, setMeeting] = useState('');
  const [value, setValue] = useState('');
  const [nextStep, setNextStep] = useState('');
  const [saved, setSaved] = useState('');

  useEffect(() => {
    let alive = true;
    if (key.length < 10) return undefined;
    window.dealsAPI?.card?.(key).then((res) => {
      if (!alive || !res?.success) return;
      setCard(res.card);
      setColumns(res.columns || []);
    }).catch(() => {});
    return () => { alive = false; };
  }, [key, deal.updatedAt]);

  useEffect(() => {
    setMeeting(toLocalInput(deal.meetingAt));
    setValue(deal.value ? String(deal.value) : card?.dealValue ? String(card.dealValue) : '');
    setNextStep(deal.nextStep || '');
  }, [key, deal.meetingAt, deal.value, deal.nextStep, card?.dealValue]);

  if (key.length < 10) return null;

  const save = async (patch, msg) => {
    const res = await window.dealsAPI?.update?.(key, patch);
    if (res?.success) {
      if (res.card) setCard(res.card);
      setSaved(msg);
      setTimeout(() => setSaved(''), 2200);
    } else {
      setSaved(res?.error || 'Não salvou.');
    }
  };

  const upcoming = deal.meetingAt && deal.meetingAt > Date.now() - 2 * 3600000;

  return (
    <div className="clp-section deal-panel">
      <span className="clp-label">Negócio</span>

      {upcoming && (
        <div className={`deal-meeting ${deal.meetingConfirmed ? 'ok' : ''}`}>
          <CalendarClock size={16} />
          <div>
            <b>Reunião {deal.meetingLabel}</b>
            <span>{deal.meetingSource === 'manual' ? 'Informado por você' : `Detectado na conversa${deal.meetingQuote ? `: “${deal.meetingQuote.slice(0, 90)}”` : ''}`}</span>
            {card?.reminderAt ? <span>Lembrete no Kanban: {new Date(card.reminderAt).toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span> : null}
          </div>
          {deal.meetingSource !== 'manual' && (
            <div className="deal-meeting-actions">
              <button type="button" title="Está certo" onClick={() => save({ meetingAt: deal.meetingAt }, 'Agendamento confirmado.')}><Check size={13} /></button>
              <button type="button" title="Não é reunião" onClick={() => save({ meetingAt: null }, 'Agendamento removido.')}><X size={13} /></button>
            </div>
          )}
        </div>
      )}

      <label className="deal-field">
        <span>Etapa do funil</span>
        <select value={card?.columnId || ''} disabled={!card} onChange={(e) => save({ columnId: e.target.value }, 'Etapa atualizada.')}>
          {!card && <option value="">Fora do funil</option>}
          {columns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>

      <label className="deal-field">
        <span>Agendamento</span>
        <input type="datetime-local" value={meeting} onChange={(e) => setMeeting(e.target.value)} onBlur={() => {
          const at = meeting ? new Date(meeting).getTime() : null;
          if ((at || null) !== (deal.meetingAt || null)) save({ meetingAt: at }, at ? 'Agendado, com lembrete na véspera.' : 'Agendamento removido.');
        }} />
      </label>

      <div className="deal-row">
        <label className="deal-field">
          <span>Valor (R$)</span>
          <input type="number" min="0" step="50" value={value} placeholder="0" onChange={(e) => setValue(e.target.value)} onBlur={() => {
            if (Number(value || 0) !== Number(deal.value || card?.dealValue || 0)) save({ value: Number(value || 0) }, 'Valor salvo.');
          }} />
        </label>
      </div>

      <label className="deal-field">
        <span>Próximo passo</span>
        <input type="text" maxLength={200} value={nextStep} placeholder="Ex.: apresentar a proposta na reunião" onChange={(e) => setNextStep(e.target.value)} onBlur={() => {
          if (nextStep !== (deal.nextStep || '')) save({ nextStep }, 'Próximo passo salvo.');
        }} />
      </label>

      {saved && <span className="deal-saved" role="status">{saved}</span>}
    </div>
  );
}
