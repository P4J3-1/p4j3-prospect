import React, { useEffect, useState } from 'react';

/** Backup diário automático dos dados (últimos 7 dias) + backup na hora. */
export default function BackupCard() {
  const [backups, setBackups] = useState([]);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    window.backupAPI?.status?.().then((res) => res?.success && setBackups(res.backups || [])).catch(() => {});
  }, []);

  const runNow = async () => {
    setBusy(true);
    try {
      const res = await window.backupAPI.run();
      if (!res?.success) throw new Error(res?.error || 'Não foi possível fazer o backup.');
      setBackups(res.backups || []);
      setStatus(`Backup feito: ${res.files.length} arquivo(s) salvos.`);
    } catch (error) {
      setStatus(error?.message || 'Falhou.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="update-settings-card backup-card">
      <div>
        <div className="eyebrow">Segurança</div>
        <b>Backup dos seus dados</b>
        <p className="camp-hint" style={{ margin: '4px 0 0' }}>
          Todo dia o app guarda uma cópia de leads, contatados, fila, campanhas, Kanban, triagem e configurações (mantém 7 dias).
          {' '}{backups.length ? `Último: ${backups[0].split('-').reverse().join('/')}.` : 'Nenhum backup ainda.'}
        </p>
        {status && <p className="camp-hint" style={{ margin: '4px 0 0' }} role="status">{status}</p>}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={runNow}>{busy ? 'Salvando…' : 'Fazer backup agora'}</button>
        <button type="button" className="btn btn-sm" onClick={() => window.backupAPI?.openFolder?.()}>Abrir pasta</button>
      </div>
    </div>
  );
}
