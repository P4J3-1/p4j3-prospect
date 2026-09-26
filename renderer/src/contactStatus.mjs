// Status de contato por telefone (fonte: processo principal, em tempo real).
export const CONTACT_STATUS = {
  enviado: { label: 'Mensagem enviada', short: 'Enviado', color: '#64748b' },
  entregue: { label: 'Entregue', short: 'Entregue', color: '#3b82f6' },
  lido: { label: 'Lido', short: 'Lido', color: '#0ea5e9' },
  respondeu: { label: 'Respondeu', short: 'Respondeu', color: '#10a37f' },
  descadastrado: { label: 'Pediu para sair', short: 'Saiu', color: '#dc2626' },
  nao_contatar: { label: 'Não contatar', short: 'Não contatar', color: '#475569' },
};

/** Aba do Scraper em que o lead aparece, pelo status de contato. */
export function contactBucket(entry) {
  if (!entry) return 'disponiveis';
  if (entry.status === 'nao_contatar' || entry.status === 'descadastrado') return 'nao_contatar';
  if (entry.status === 'respondeu') return 'responderam';
  return 'contatados';
}

export function phoneCore(phone) {
  let digits = String(phone || '').replace(/@.*$/, '').replace(/:\d+$/, '').replace(/\D/g, '');
  if (digits.length >= 12 && digits.startsWith('55')) digits = digits.slice(2);
  // Celular sempre com o 9 (o WhatsApp guarda números antigos sem ele).
  if (digits.length === 10 && /[6-9]/.test(digits[2])) digits = `${digits.slice(0, 2)}9${digits.slice(2)}`;
  return digits;
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
