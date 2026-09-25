import { useEffect, useState } from 'react';

/** Mapa telefone → status de contato, atualizado ao vivo pelo WhatsApp. */
export function useContactStatus() {
  const [contacts, setContacts] = useState({});
  useEffect(() => {
    let alive = true;
    window.contactAPI?.getAll?.()
      .then((res) => { if (alive && res?.success) setContacts(res.contacts || {}); })
      .catch(() => {});
    const off = window.contactAPI?.onChanged?.(({ phone, entry }) => {
      if (phone) setContacts((current) => ({ ...current, [phone]: entry }));
    });
    return () => {
      alive = false;
      if (typeof off === 'function') off();
    };
  }, []);
  return contacts;
}

/** Resultado da checagem "tem WhatsApp?" por telefone, atualizado ao vivo. */
export function useWaCheck() {
  const [waCheck, setWaCheck] = useState({});
  useEffect(() => {
    let alive = true;
    window.contactAPI?.getAll?.()
      .then((res) => { if (alive && res?.success) setWaCheck(res.waCheck || {}); })
      .catch(() => {});
    const off = window.contactAPI?.onWaCheck?.(({ changed }) => {
      if (changed) setWaCheck((current) => ({ ...current, ...changed }));
    });
    return () => {
      alive = false;
      if (typeof off === 'function') off();
    };
  }, []);
  return waCheck;
}
