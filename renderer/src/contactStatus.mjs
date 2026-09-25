// Status de contato por telefone (fonte: processo principal, em tempo real).
export const CONTACT_STATUS = {
  enviado: { label: 'Mensagem enviada', short: 'Enviado', color: '#64748b' },
  entregue: { label: 'Entregue', short: 'Entregue', color: '#3b82f6' },
  lido: { label: 'Lido', short: 'Lido', color: '#0ea5e9' },
  respondeu: { label: 'Respondeu', short: 'Respondeu', color: '#10a37f' },
  descadastrado: { label: 'Pediu para sair', short: 'Saiu', color: '#dc2626' },
};

export function phoneCore(phone) {
  const digits = String(phone || '').replace(/@.*$/, '').replace(/\D/g, '');
  return digits.length >= 12 && digits.startsWith('55') ? digits.slice(2) : digits;
}

export function leadPhone(lead) {
  return lead?.phone || lead?.tel || lead?.telefone || lead?.whatsapp || '';
}

/** Entrada de status do lead, ou null se nunca foi contatado. */
export function contactFor(contacts, lead) {
  const key = phoneCore(leadPhone(lead));
  return (key && contacts?.[key]) || null;
}

export function timeAgo(ts, now = Date.now()) {
  if (!ts) return '';
  const min = Math.round((now - ts) / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  return `há ${Math.round(h / 24)} d`;
}
