export function readLocalArray(key) {
  try {
    const data = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function repairMojibake(value) {
  const text = String(value ?? '');
  if (!/[\u00c2\u00c3]/.test(text)) return text;

  try {
    const codePoints = Array.from(text, (char) => char.codePointAt(0));
    if (codePoints.some((point) => point > 255)) return text;
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(codePoints));
    return decoded && !decoded.includes('\ufffd') ? decoded : text;
  } catch {
    return text;
  }
}

function foldText(value) {
  return repairMojibake(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Taxonomia conservadora da base. Só reúne sinônimos inequívocos para não
 * reclassificar negócios diferentes sem confirmação do usuário.
 */
export function normalizeLeadCategory(value) {
  const cleaned = repairMojibake(value).replace(/\s+/g, ' ').trim();
  const folded = foldText(cleaned);

  if (!folded || /^(sem categoria|nao informado|n\/a|null|undefined|-)$/.test(folded)) {
    return 'Sem categoria';
  }

  if (
    /(?:odont|dentist|ortodont|endodont|periodont|implantodont)/.test(folded)
    || /cirurgiao dentista|protese dentaria/.test(folded)
  ) {
    return 'Odontologia';
  }

  return cleaned;
}

export function normalizeLeadRecord(lead) {
  if (!lead || typeof lead !== 'object') return lead;
  const category = normalizeLeadCategory(lead.category);
  return category === lead.category ? lead : { ...lead, category };
}

export function normalizeLeadCollection(leads = []) {
  return Array.isArray(leads) ? leads.map(normalizeLeadRecord).filter(Boolean) : [];
}

export function isImportedSearch(search) {
  if (!search || typeof search !== 'object') return false;
  const haystack = foldText([
    search.id,
    search.label,
    search.query,
    search.source,
    search.type,
    search.kind,
  ].filter(Boolean).join(' '));
  return /(?:^|\s)(?:importados?|planilhas?|spreadsheet|csv|xlsx?)(?:\s|$)/.test(haystack);
}

function searchTimestamp(search, fallback = 0) {
  const raw = search?.timestamp ?? search?.createdAt ?? search?.created ?? search?.date;
  const parsed = typeof raw === 'number' ? raw : Date.parse(raw || '');
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  const idAsNumber = Number(search?.id);
  return Number.isFinite(idAsNumber) && idAsNumber > 1e11 ? idAsNumber : fallback;
}

/** Retorna somente extrações reais do Maps, sem agrupadores de importação. */
export function getExtractionSearches(searches = []) {
  const seen = new Set();
  return (Array.isArray(searches) ? searches : [])
    .map((search, index) => ({ search, index }))
    .filter(({ search }) => search && typeof search === 'object' && search.id != null && !isImportedSearch(search))
    .filter(({ search }) => {
      const key = String(search.id);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => searchTimestamp(b.search, b.index) - searchTimestamp(a.search, a.index))
    .map(({ search }) => search);
}

export function getLeadIdentity(lead) {
  return `${lead?.name || ""}||${lead?.address || ""}`.toLowerCase().trim();
}

export function dedupeLeads(leads = []) {
  const seen = new Set();
  return leads.filter((lead) => {
    const key = getLeadIdentity(lead);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function countLeadsByField(leads = [], field) {
  return leads.filter((lead) => lead?.[field]).length;
}

export function getLeadStats(leads = []) {
  return {
    total: leads.length,
    phoneCount: leads.filter((lead) => lead?.phone || lead?.tel || lead?.whatsapp).length,
    webCount: leads.filter((lead) => lead?.website || lead?.site).length,
    igCount: leads.filter((lead) => lead?.instagram || lead?.ig).length,
    emailCount: leads.filter((lead) => lead?.email || lead?.mail).length,
  };
}

export function getSearchLeadCount(leads = [], searchId) {
  return leads.filter((lead) => String(lead?.searchId ?? '') === String(searchId ?? '')).length;
}
