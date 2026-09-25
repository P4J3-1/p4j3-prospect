import { useEffect, useState } from 'react';

/** Fila de envio (itens, configuração e motivo de espera), ao vivo. */
export function useQueue() {
  const [queue, setQueue] = useState({ items: [], settings: {}, wait: '', ab: null });
  useEffect(() => {
    let alive = true;
    window.queueAPI?.get?.()
      .then((res) => { if (alive && res?.success) setQueue({ items: res.items || [], settings: res.settings || {}, wait: res.wait || '', ab: res.ab || null }); })
      .catch(() => {});
    const offChanged = window.queueAPI?.onChanged?.((snap) => {
      if (snap) setQueue((current) => ({ ...current, items: snap.items || [], settings: snap.settings || current.settings }));
    });
    const offStatus = window.queueAPI?.onStatus?.((status) => {
      if (status) setQueue((current) => ({ ...current, wait: status.wait || '' }));
    });
    return () => {
      alive = false;
      if (typeof offChanged === 'function') offChanged();
      if (typeof offStatus === 'function') offStatus();
    };
  }, []);
  return queue;
}

export const QUEUE_ACTIVE = new Set(['rascunho', 'aprovado', 'enviando']);

/** Mapa telefone (sem DDI) → item ativo da fila. */
export function activeQueueByPhone(items = []) {
  const map = {};
  for (const item of items) if (QUEUE_ACTIVE.has(item.status)) map[item.phoneCore] = item;
  return map;
}
