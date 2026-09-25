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
