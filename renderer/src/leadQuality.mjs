// Qualidade da informação da base: tira dado repetido que não é do lead e
// completa cidade/bairro/UF a partir do endereço do Google Maps.

/**
 * "Sl 1911 - Águas Claras, Brasília - DF, 71926-000, Brasil"
 *   → { neighborhood: 'Águas Claras', city: 'Brasília', state: 'DF', cep: '71926-000' }
 */
export function parseBrAddress(address) {
  const text = String(address || '').replace(/,\s*Brasil\s*$/i, '').trim();
  const m = text.match(/(?:^|[-,]\s*)([^,–-]+?),\s*([^,–-]+?)\s*[-–]\s*([A-Z]{2})(?:,\s*(\d{5}-?\d{3}))?\s*$/);
  if (!m) {
    const simple = text.match(/([^,–-]+?)\s*[-–]\s*([A-Z]{2})(?:,\s*(\d{5}-?\d{3}))?\s*$/);
    return simple ? { neighborhood: '', city: simple[1].trim(), state: simple[2], cep: simple[3] || '' } : null;
  }
  const neighborhood = m[1].trim();
  // "Loja 3" ou número solto não é bairro.
  // Nem rua/avenida, nem trecho com numeração de lote.
  const looksLikeUnit = /^(sl|sala|loja|lj|bloco|bl|lote|lt|conj|cj|n[º°o]?|\d)/i.test(neighborhood)
    || /^(av\.?|avenida|rua|r\.|rod\.?|rodovia|estrada|travessa|alameda|pra[cç]a)(\s|$)/i.test(neighborhood)
    || /\d{3,}/.test(neighborhood);
  return { neighborhood: looksLikeUnit ? '' : neighborhood, city: m[2].trim(), state: m[3], cep: m[4] || '' };
}

function handleOf(value) {
  return String(value || '').trim().toLowerCase().replace(/^@/, '').replace(/\/+$/, '');
}

function nameWords(name) {
  return String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/**
 * Instagram/e-mail que aparece em 3+ empresas diferentes veio de outro lugar
 * (anúncio, diretório, agendador) e não é do lead: sai da ficha.
 */
export function stripSharedContacts(leads, min = 3) {
  const counts = { instagram: new Map(), email: new Map() };
  for (const lead of leads) {
    for (const field of ['instagram', 'email']) {
      const key = handleOf(lead?.[field]);
      if (!key) continue;
      const names = counts[field].get(key) || new Set();
      names.add(nameWords(lead.name));
      counts[field].set(key, names);
    }
  }
  const shared = (field, value) => {
    const key = handleOf(value);
    const names = key && counts[field].get(key);
    if (!names || names.size < min) return false;
    // O @ que é o próprio nome da empresa fica (rede de franquias, por ex.).
    return true;
  };
  return leads.map((lead) => {
    if (!lead || typeof lead !== 'object') return lead;
    const dropIg = shared('instagram', lead.instagram) && !nameWords(lead.name).includes(handleOf(lead.instagram).replace(/[^a-z0-9]/g, ''));
    const dropEmail = shared('email', lead.email);
    if (!dropIg && !dropEmail) return lead;
    return {
      ...lead,
      ...(dropIg ? { instagram: '', instagramShared: handleOf(lead.instagram) } : {}),
      ...(dropEmail ? { email: '', emailShared: handleOf(lead.email) } : {}),
    };
  });
}

/** Completa cidade, bairro e UF pelo endereço quando vierem vazios. */
export function fillAddressParts(lead) {
  if (!lead || typeof lead !== 'object') return lead;
  if (lead.city && lead.neighborhood && lead.state) return lead;
  const parts = parseBrAddress(lead.address);
  if (!parts) return lead;
  const next = {
    ...lead,
    city: lead.city || parts.city,
    neighborhood: lead.neighborhood || parts.neighborhood,
    state: lead.state || parts.state,
    cep: lead.cep || parts.cep,
  };
  return next.city === lead.city && next.neighborhood === lead.neighborhood && next.state === lead.state && next.cep === lead.cep ? lead : next;
}
