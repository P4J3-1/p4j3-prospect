import React, { useState } from 'react';
import { Download, RefreshCw, CheckCircle2, AlertCircle, X } from 'lucide-react';
import { formatMb, useUpdateStatus } from '../useUpdateStatus.mjs';

/** Aviso compacto no topo: aparece quando há algo para atualizar. */
export default function UpdateBanner() {
  const { state, check, download, install } = useUpdateStatus();
  const [dismissed, setDismissed] = useState(false);

  if (state.type === 'loading' || state.type === 'idle' || state.type === 'unavailable' || state.type === 'up-to-date') {
    return null;
  }
  if (dismissed) return null;

  if (state.type === 'checking') {
    return (
      <div className="update-banner checking">
        <RefreshCw size={14} className="spin-icon" />
        <span>Verificando atualizações…</span>
      </div>
    );
  }

  if (state.type === 'progress') {
    const size = formatMb(state.transferred);
    const total = formatMb(state.total);
    return (
      <div className="update-banner downloading" role="status">
        <RefreshCw size={13} className="spin-icon" />
        <span>Atualizando em segundo plano… {state.percent}%</span>
        {size ? <small>{size}{total ? ` de ${total}` : ''}</small> : null}
        <div className="update-progress-bar"><div className="update-progress-fill" style={{ width: `${state.percent}%` }} /></div>
      </div>
    );
  }

  if (state.type === 'available') {
    return (
      <div className="update-banner available" role="status">
        <Download size={14} />
        <span>Nova versão {state.version} disponível</span>
        <button type="button" className="btn btn-primary btn-compact" onClick={download}>Atualizar agora</button>
        <button type="button" className="icon-btn" aria-label="Depois" title="Depois" onClick={() => setDismissed(true)}><X size={14} /></button>
      </div>
    );
  }

  if (state.type === 'downloaded') {
    return (
      <div className="update-banner downloaded" role="status">
        <CheckCircle2 size={14} />
        <span>Atualização pronta — reinicie para aplicar</span>
        <button type="button" className="btn btn-primary btn-compact" onClick={install}>Reiniciar agora</button>
        <button type="button" className="icon-btn" aria-label="Depois" title="Depois" onClick={() => setDismissed(true)}><X size={14} /></button>
      </div>
    );
  }

  if (state.type === 'error') {
    return (
      <div className="update-banner error" role="alert">
        <AlertCircle size={14} />
        <span title={state.message || ''}>{state.message || 'Falha ao verificar atualização'}</span>
        <button type="button" className="btn btn-ghost btn-compact" onClick={check}>Tentar de novo</button>
        <button type="button" className="icon-btn" aria-label="Fechar" onClick={() => setDismissed(true)}><X size={14} /></button>
      </div>
    );
  }

  return null;
}
