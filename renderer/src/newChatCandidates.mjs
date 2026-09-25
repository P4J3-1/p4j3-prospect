const digitsOf = (value) => String(value || '').replace(/\D/g, '');

// Compara números com e sem DDI do Brasil: "11999990001" ≡ "5511999990001".
const corePhone = (digits) => (digits.length >= 12 && digits.startsWith('55') ? digits.slice(2) : digits);

/**
 * Monta a lista do modal "Nova conversa" a partir de chats, contatos e leads.
 * A busca aceita o telefone formatado ("(11) 99999-0001"), e um número com
 * 10+ dígitos sempre pode ser aberto, mesmo fora da agenda do WhatsApp.
 */
export function buildNewChatCandidates(sources, search = '', limit = 100) {
  const seen = new Set();
  const candidates = [];
  const append = (item) => {
    if (!item || item.isGroup || String(item.jid || '').endsWith('@g.us')) return;
    const rawPhone = String(item.phone || item.phoneNumber || item.number || item.jid || '');
    const phone = rawPhone.includes('@') ? rawPhone.replace(/@.*$/, '') : rawPhone;
    const digits = digitsOf(phone);
    const key = corePhone(digits) || item.jid;
    if (!key || seen.has(key)) return;
    seen.add(key);
    // Lead sem JID real fica sem JID: o backend normaliza o telefone (DDI 55).
    // Montar "<dígitos>@s.whatsapp.net" aqui abriria conversa com número errado.
    candidates.push({
      ...item,
      jid: item.jid || '',
      phone: digits || phone,
      phoneJid: item.phoneJid || item.jid || '',
      name: item.name || item.company || item.pushName || phone || 'Contato',
    });
  };
  sources.forEach((list) => (Array.isArray(list) ? list : []).forEach(append));

  const query = String(search || '').trim().toLowerCase();
  const queryDigits = corePhone(digitsOf(query));
  const matches = (item) => {
    if (!query) return true;
    if (`${item.name} ${item.phone} ${item.jid}`.toLowerCase().includes(query)) return true;
    return queryDigits.length >= 4 && corePhone(digitsOf(item.phone)).includes(queryDigits);
  };
  const filtered = candidates.filter(matches).slice(0, limit);

  const manualDigits = digitsOf(search);
  const exactHit = filtered.some((item) => corePhone(digitsOf(item.phone)) === corePhone(manualDigits));
  if (manualDigits.length >= 10 && !exactHit) {
    filtered.unshift({
      leadId: `manual_${manualDigits}`,
      name: 'Número informado',
      phone: String(search).trim(),
      jid: '',
      phoneJid: '',
      isManual: true,
    });
  }
  return filtered.slice(0, limit);
}
