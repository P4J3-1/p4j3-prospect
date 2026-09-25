import { useEffect, useState } from 'react';

/** Resultados da triagem por lead, atualizados ao vivo pelo Agente de Triagem. */
export function useTriage() {
  const [triage, setTriage] = useState({});
  useEffect(() => {
    let alive = true;
    window.triageAPI?.getAll?.()
      .then((res) => { if (alive && res?.success) setTriage(res.triage || {}); })
      .catch(() => {});
    const off = window.triageAPI?.onChanged?.((changed) => {
      if (changed && typeof changed === 'object') setTriage((current) => ({ ...current, ...changed }));
    });
    return () => {
      alive = false;
      if (typeof off === 'function') off();
    };
  }, []);
  return triage;
}
