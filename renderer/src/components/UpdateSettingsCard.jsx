import React from 'react';
import { CheckCircle2, CircleAlert, Download, RefreshCw } from 'lucide-react';
import { formatMb, useUpdateStatus } from '../useUpdateStatus.mjs';

const STATE_LABEL = {
  checking: 'Verificando atualizações…',
  'up-to-date': 'Você está na versão mais recente.',
  available: 'Uma nova versão está disponível.',
  progress: 'Baixando em segundo plano…',
  downloaded: 'Pronta para instalar.',
  error: 'Não foi possível verificar agora.',
  unavailable: 'Atualizações automáticas indisponíveis nesta instalação.',
};

/** Seção de Configurações: versão instalada, checagem manual e ação de atualizar. */
export default function UpdateSettingsCard() {
  const { state, capability, check, download, install } = useUpdateStatus();
  const busy = state.type === 'checking' || state.type === 'progress';
  const version = capability?.version ? `v${capability.version}` : '—';

  return (
    <section className="settings-update-card" data-od-id="settings-updates" aria-labelledby="updateSettingsTitle">
      <div className="settings-update-head">
        <div>
          <div className="eyebrow">Aplicativo</div>
          <h2 id="updateSettingsTitle">Atualizações</h2>
          <p>
            Versão instalada <b>{version}</b>. A verificação roda sozinha ao abrir o aplicativo.
          </p>
        </div>
        <div className="settings-update-actions">
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={check}>
            <RefreshCw size={14} className={busy ? 'spin-icon' : undefined} /> Verificar agora
          </button>
          {state.type === 'available' ? (
            <button type="button" className="btn btn-primary" onClick={download}>
              <Download size={14} /> Atualizar agora
            </button>
          ) : null}
          {state.type === 'downloaded' ? (
            <button type="button" className="btn btn-primary" onClick={install}>
              <CheckCircle2 size={14} /> Reiniciar e aplicar
            </button>
          ) : null}
        </div>
      </div>

      {state.type === 'progress' ? (
        <div className="settings-update-progress" role="status">
          <div className="update-progress-bar">
            <div className="update-progress-fill" style={{ width: `${state.percent}%` }} />
          </div>
          <small>
            {state.percent}%
            {formatMb(state.transferred) ? ` · ${formatMb(state.transferred)}${formatMb(state.total) ? ` de ${formatMb(state.total)}` : ''}` : ''}
          </small>
        </div>
      ) : null}

      {state.type !== 'progress' && STATE_LABEL[state.type] ? (
        <p className={`settings-update-status ${state.type === 'error' || state.type === 'unavailable' ? 'warn' : ''}`} role="status">
          {state.type === 'error' || state.type === 'unavailable' ? <CircleAlert size={13} /> : null}
          {state.type === 'available' && state.version ? `Nova versão ${state.version} disponível.` : null}
          {state.type === 'error' && state.message ? state.message : null}
          {state.type === 'unavailable' && state.message ? state.message : null}
          {state.type !== 'available' && state.type !== 'error' && state.type !== 'unavailable' ? STATE_LABEL[state.type] : null}
        </p>
      ) : null}
    </section>
  );
}
