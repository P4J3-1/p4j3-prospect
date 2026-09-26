import React, { useEffect, useState } from 'react';

const FUNNEL = [
  ['enviado', 'Enviadas', '#64748b'],
  ['entregue', 'Entregues', '#3b82f6'],
  ['lido', 'Lidas', '#0ea5e9'],
  ['respondeu', 'Responderam', '#10b981'],
  ['saiu', 'Pediram para sair', '#ef4444'],
];

/** Raio-X do WhatsApp: funil, aberturas campeãs, tempo de resposta e horários. */
export default function XrayPanel() {
  const [x, setX] = useState(null);
  useEffect(() => {
    let alive = true;
    const load = () => window.jarvisAPI?.xray?.().then((res) => { if (alive && res?.success) setX(res); }).catch(() => {});
    load();
    const t = setInterval(load, 60000);
    const off = window.contactAPI?.onChanged?.(() => load());
    return () => { alive = false; clearInterval(t); if (typeof off === 'function') off(); };
  }, []);
  if (!x) return null;
  const max = Math.max(1, x.funnel.enviado);
  const maxHour = Math.max(1, ...x.hours.map((h) => h.sent));
  const fmtMin = (m) => (m == null ? '—' : m < 60 ? `${Math.round(m)} min` : `${Math.round(m / 6) / 10} h`);

  return (
    <section className="ap-panel xr" aria-label="Raio-X do WhatsApp">
      <header className="ap-panel-head">
        <h2>Raio-X do WhatsApp</h2>
        <span>O caminho real de cada mensagem. {x.autoReplies ? `${x.autoReplies} resposta(s) automática(s) foram descartadas da conta.` : ''}</span>
      </header>
      <div className="xr-grid">
        <div>
          <h3>Funil</h3>
          <ul className="xr-funnel">
            {FUNNEL.map(([id, label, color]) => (
              <li key={id} style={{ '--c': color }}>
                <span>{label}</span>
                <div><i style={{ width: `${Math.max(2, Math.round((x.funnel[id] / max) * 100))}%` }} /></div>
                <b>{x.funnel[id]}</b>
                <small>{id !== 'enviado' && x.funnel.enviado ? `${Math.round((x.funnel[id] / x.funnel.enviado) * 100)}%` : ''}</small>
              </li>
            ))}
          </ul>
          <p className="xr-note">Tempo mediano até a resposta: <b>{fmtMin(x.replyMinutesMedian)}</b>. "Lidas" só aparece de quem deixa a confirmação de leitura ligada.</p>
        </div>
        <div>
          <h3>Aberturas que mais respondem</h3>
          {!x.sampleSize ? (
            <p className="ap-empty">Aparece conforme a fila enviar as aberturas curtas. Com ~20 envios de cada, dá para cravar a campeã.</p>
          ) : (
            <ol className="xr-openers">
              {x.openers.filter((o) => o.sent).slice(0, 5).map((o) => (
                <li key={o.index}>
                  <code>{o.template.replace(/\{\{empresa\}\}/g, 'Empresa')}</code>
                  <span><b>{o.rate}%</b> ({o.replied}/{o.sent})</span>
                </li>
              ))}
            </ol>
          )}
          <h3 style={{ marginTop: 12 }}>Horários (envios e resposta)</h3>
          <div className="xr-hours" role="img" aria-label="Envios e taxa de resposta por hora">
            {x.hours.filter((h) => h.hour >= 7 && h.hour <= 22).map((h) => (
              <div key={h.hour} title={`${h.hour}h: ${h.sent} envio(s), ${h.rate}% de resposta`}>
                <i style={{ height: `${Math.max(4, Math.round((h.sent / maxHour) * 100))}%`, opacity: h.sent ? 1 : 0.25, background: h.rate ? `hsl(${Math.min(140, h.rate * 4)}, 70%, 50%)` : '#334155' }} />
                <small>{h.hour}</small>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
