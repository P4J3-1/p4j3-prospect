// Triagem por lead (Agente de Triagem). A chave segue a mesma regra de
// lead-scoring/lead-triage.js: telefone sem DDI, ou o nome normalizado.
export const SEGMENTS = {
  sem_site: { label: 'Sem site', color: '#dc2626' },
  so_rede_social: { label: 'Só rede social', color: '#db2777' },
  site_fora_do_ar: { label: 'Site fora do ar', color: '#dc2626' },
  site_fraco: { label: 'Site fraco', color: '#d97706' },
  atendimento_manual: { label: 'WhatsApp sem automação', color: '#7c3aed' },
  ja_automatizado: { label: 'Já tem chat/bot', color: '#64748b' },
  alto_potencial: { label: 'Alto potencial', color: '#10a37f' },
};

function words(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

export function triageKey(lead = {}) {
  const digits = String(lead.phone || lead.tel || '').replace(/\D/g, '');
  const phone = digits.length >= 12 && digits.startsWith('55') ? digits.slice(2) : digits;
  if (phone.length >= 10) return `p:${phone}`;
  const name = words(lead.name || lead.company || lead.title).join('-');
  return name ? `n:${name}` : '';
}

export function triageFor(map, lead) {
  const key = triageKey(lead);
  return (key && map?.[key]) || null;
}
