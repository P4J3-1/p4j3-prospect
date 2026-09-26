import { useEffect, useState } from 'react';

/** Negócios em andamento (agendamento, valor, próximo passo), ao vivo. */
export function useDeals() {
  const [deals, setDeals] = useState({});
  useEffect(() => {
    let alive = true;
    window.dealsAPI?.getAll?.().then((res) => { if (alive && res?.success) setDeals(res.deals || {}); }).catch(() => {});
    const off = window.dealsAPI?.onChanged?.((next) => { if (next) setDeals(next); });
    return () => { alive = false; if (typeof off === 'function') off(); };
  }, []);
  return deals;
}
