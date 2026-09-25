import { useEffect, useState } from 'react';

export const TEMPERATURE = {
  quente: { label: 'Quente', color: '#dc2626', rank: 3 },
  morno: { label: 'Morno', color: '#d97706', rank: 2 },
  frio: { label: 'Frio', color: '#3b82f6', rank: 1 },
};

/** Temperatura e momento de cada lead que respondeu (telefone sem DDI → dados). */
export function useLeadMemory() {
  const [memory, setMemory] = useState({});
  useEffect(() => {
    let alive = true;
    const load = () => window.aiAPI?.leadMemory?.()
      .then((res) => { if (alive && res?.success) setMemory(res.memory || {}); })
      .catch(() => {});
    load();
    const off = window.aiAPI?.onLeadReplied?.(() => setTimeout(load, 1000));
    const timer = setInterval(load, 60000);
    return () => {
      alive = false;
      clearInterval(timer);
      if (typeof off === 'function') off();
    };
  }, []);
  return memory;
}
