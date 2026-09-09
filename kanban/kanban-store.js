const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const VERSION = 1;
const MAX_COLUMNS = 12;
const MAX_RULES = 50;
const MAX_EVENTS = 500;

const ALLOWED_FIELDS = new Set([
  'score',
  'priority',
  'hasPhone',
  'hasWebsite',
  'hasEmail',
  'category',
  'city',
  'source',
  'campaignStatus',
  'prospectingStatus',
]);

const ALLOWED_OPERATORS = new Set([
  'gte',
  'lte',
  'equals',
  'contains',
  'isTrue',
  'isFalse',
  'in',
]);

const ALLOWED_TRIGGERS = new Set([
  'any',
  'lead.imported',
  'scoring.completed',
  'campaign.sent',
  'campaign.replied',
  'sync',
]);

const DEFAULT_COLUMNS = [
  { id: 'new', name: 'Novos', color: '#10a37f', position: 0, terminal: false, wipLimit: null },
  { id: 'contacted', name: 'Em contato', color: '#3b82f6', position: 1, terminal: false, wipLimit: null },
  { id: 'qualified', name: 'Qualificados', color: '#8b5cf6', position: 2, terminal: false, wipLimit: null },
  { id: 'proposal', name: 'Proposta', color: '#f59e0b', position: 3, terminal: false, wipLimit: null },
  { id: 'won', name: 'Ganhos', color: '#16a34a', position: 4, terminal: true, wipLimit: null },
  { id: 'lost', name: 'Perdidos', color: '#ef4444', position: 5, terminal: true, wipLimit: null },
];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function now() {
  return Date.now();
}

function cleanText(value, max = 160) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function fold(value) {
  return cleanText(value, 500)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR');
}

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 24);
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function normalizePhone(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits.length >= 8 && digits.length <= 18 ? digits : '';
}

function slug(value, fallback) {
  const normalized = fold(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return normalized || fallback;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function isHexColor(value) {
  return /^#[0-9a-f]{6}$/i.test(String(value ?? ''));
}

function defaultState() {
  return {
    version: VERSION,
    revision: 1,
    board: {
      columns: clone(DEFAULT_COLUMNS),
      rules: [],
    },
    entities: {},
    cards: {},
    events: [],
    updatedAt: now(),
  };
}

function normalizeColumn(column, index, seen) {
  const fallbackId = `stage-${index + 1}`;
  let id = slug(column?.id || column?.name, fallbackId);
  let suffix = 2;
  while (seen.has(id)) {
    id = `${slug(column?.id || column?.name, fallbackId)}-${suffix}`;
    suffix += 1;
  }
  seen.add(id);
  const rawWip = Number(column?.wipLimit);
  return {
    id,
    name: cleanText(column?.name || 'Etapa', 60) || 'Etapa',
    color: isHexColor(column?.color) ? column.color.toLowerCase() : DEFAULT_COLUMNS[index % DEFAULT_COLUMNS.length].color,
    position: index,
    terminal: Boolean(column?.terminal),
    wipLimit: Number.isInteger(rawWip) && rawWip > 0 && rawWip <= 999 ? rawWip : null,
  };
}

function normalizeRule(rule, index, columnIds) {
  const when = Array.isArray(rule?.when) ? rule.when.slice(0, 6) : [];
  const normalizedWhen = when.map((condition) => {
    const field = ALLOWED_FIELDS.has(condition?.field) ? condition.field : 'score';
    const operator = ALLOWED_OPERATORS.has(condition?.operator) ? condition.operator : 'gte';
    return {
      field,
      operator,
      value: cleanText(condition?.value, 160),
    };
  });
  const columnId = String(rule?.action?.columnId || '');
  if (!columnIds.has(columnId)) return null;
  return {
    id: slug(rule?.id || `rule-${index + 1}`, `rule-${index + 1}`),
    enabled: rule?.enabled !== false,
    priority: Math.max(0, Math.min(999, Math.trunc(toNumber(rule?.priority)))),
    trigger: ALLOWED_TRIGGERS.has(rule?.trigger) ? rule.trigger : 'sync',
    match: rule?.match === 'any' ? 'any' : 'all',
    when: normalizedWhen,
    action: { type: 'move', columnId },
  };
}

function normalizeBoard(board) {
  const sourceColumns = Array.isArray(board?.columns) && board.columns.length
    ? board.columns.slice(0, MAX_COLUMNS)
    : DEFAULT_COLUMNS;
  const seen = new Set();
  const columns = sourceColumns.map((column, index) => normalizeColumn(column, index, seen));
  const columnIds = new Set(columns.map((column) => column.id));
  const seenRuleIds = new Set();
  const rules = (Array.isArray(board?.rules) ? board.rules : [])
    .slice(0, MAX_RULES)
    .map((rule, index) => normalizeRule(rule, index, columnIds))
    .filter(Boolean)
    .map((rule, index) => ({ ...rule, id: uniqueRuleId(rule.id, index, seenRuleIds) }));
  return { columns, rules };
}

function uniqueRuleId(value, index, seen) {
  let id = slug(value, `rule-${index + 1}`);
  let suffix = 2;
  while (seen.has(id)) {
    id = `${slug(value, `rule-${index + 1}`)}-${suffix}`;
    suffix += 1;
  }
  seen.add(id);
  return id;
}

function profileFrom(raw = {}) {
  const company = raw.company && typeof raw.company === 'object' ? raw.company : raw;
  const scoreSource = raw.score?.value ?? raw.score ?? company.score?.value ?? company.score;
  const priority = raw.score?.priority ?? raw.priority ?? raw.prioridade ?? company.score?.priority ?? company.priority ?? company.prioridade;
  return {
    name: cleanText(company.name || company.company || raw.name || raw.companyName || '', 140),
    phone: normalizePhone(company.phone || company.whatsapp || raw.phone || raw.whatsapp || raw.phoneRaw || raw.jid),
    website: cleanText(company.website || company.site || raw.website || raw.site || '', 300),
    email: cleanText(company.email || company.mail || raw.email || raw.mail || '', 180),
    category: cleanText(company.category || company.cat || raw.category || raw.cat || '', 100),
    address: cleanText(company.address || raw.address || '', 220),
    city: cleanText(company.city || company.cidade || raw.city || raw.cidade || '', 100),
    state: cleanText(company.state || company.uf || raw.state || raw.uf || '', 8),
    score: toNumber(scoreSource),
    priority: cleanText(priority, 40),
    prospectingStatus: cleanText(raw.prospecting?.status || raw.status || company.prospecting?.status || '', 60),
    campaignStatus: cleanText(raw.campaignStatus || raw.status || '', 60),
    lastInteractionAt: toNumber(raw.repliedAt || raw.readAt || raw.sentAt || raw.updatedAt || company.updatedAt),
  };
}

function identityKeys(profile) {
  const name = fold(profile.name);
  const address = fold(profile.address);
  const place = fold(`${profile.name}|${profile.address}|${profile.city}|${profile.state}`);
  const website = fold(profile.website);
  const values = [];
  if (profile.phone) values.push(`phone:${profile.phone}`);
  // O Maps nem sempre retorna cidade/UF, enquanto o scoring as deriva do
  // endereço. A chave nome+endereço mantém as duas fontes no mesmo card.
  if (name && address.length > 4) values.push(`name-address:${hash(`${name}|${address}`)}`);
  if (name && place.replace(/\|/g, '').length > 4) values.push(`place:${hash(place)}`);
  if (website && name) values.push(`web:${hash(`${name}|${website}`)}`);
  if (name && profile.city) values.push(`name-city:${hash(`${name}|${fold(profile.city)}`)}`);
  return unique(values);
}

function sourceReference(source, raw, profile) {
  const rawId = cleanText(raw?.id || raw?.leadId || raw?.jid || profile.phone || '', 160);
  if (source === 'scoring') return { field: 'scoringIds', value: rawId };
  if (source === 'campaign') return { field: 'campaignRefs', value: cleanText(`${raw?.campaignId || ''}:${rawId}`, 180) || rawId };
  return { field: 'mapsIds', value: rawId };
}

function eventForSource(source, raw = {}) {
  if (source === 'scoring') return 'scoring.completed';
  if (source === 'campaign') {
    if (raw.status === 'replied') return 'campaign.replied';
    if (raw.status === 'sent' || raw.status === 'delivered' || raw.status === 'read') return 'campaign.sent';
    return 'sync';
  }
  return 'lead.imported';
}

function getFieldValue(entity, field) {
  const profile = entity?.profile || {};
  if (field === 'hasPhone') return Boolean(profile.phone);
  if (field === 'hasWebsite') return Boolean(profile.website);
  if (field === 'hasEmail') return Boolean(profile.email);
  if (field === 'source') {
    const refs = entity?.sourceRefs || {};
    return [
      refs.mapsIds?.length ? 'maps' : '',
      refs.scoringIds?.length ? 'scoring' : '',
      refs.campaignRefs?.length ? 'campaign' : '',
    ].filter(Boolean).join(',');
  }
  return profile[field] ?? '';
}

function matchCondition(entity, condition) {
  const actual = getFieldValue(entity, condition.field);
  const expected = condition.value;
  if (condition.operator === 'isTrue') return Boolean(actual);
  if (condition.operator === 'isFalse') return !actual;
  if (condition.operator === 'gte') return toNumber(actual) >= toNumber(expected);
  if (condition.operator === 'lte') return toNumber(actual) <= toNumber(expected);
  if (condition.operator === 'equals') return fold(actual) === fold(expected);
  if (condition.operator === 'contains') return fold(actual).includes(fold(expected));
  if (condition.operator === 'in') return String(expected || '').split(',').map(fold).includes(fold(actual));
  return false;
}

function ruleMatches(entity, rule) {
  if (!rule.when.length) return true;
  const results = rule.when.map((condition) => matchCondition(entity, condition));
  return rule.match === 'any' ? results.some(Boolean) : results.every(Boolean);
}

class KanbanStore {
  constructor(userDataPath) {
    this.filePath = path.join(userDataPath, 'kanban.json');
    this.state = this._load();
    this.state.board = normalizeBoard(this.state.board);
    this.identityIndex = new Map();
    this.nextRankByColumn = new Map();
    this._rebuildIdentityIndex();
    this._rebuildRankIndex();
  }

  _load() {
    if (!fs.existsSync(this.filePath)) return defaultState();
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Formato inválido');
      return {
        ...defaultState(),
        ...parsed,
        version: VERSION,
        entities: parsed.entities && typeof parsed.entities === 'object' ? parsed.entities : {},
        cards: parsed.cards && typeof parsed.cards === 'object' ? parsed.cards : {},
        events: Array.isArray(parsed.events) ? parsed.events.slice(-MAX_EVENTS) : [],
      };
    } catch (error) {
      const corruptPath = `${this.filePath}.corrupt-${now()}`;
      try { fs.renameSync(this.filePath, corruptPath); } catch {}
      return defaultState();
    }
  }

  _writeAtomic() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.tmp`;
    const backup = `${this.filePath}.bak`;
    if (fs.existsSync(this.filePath)) {
      try { fs.copyFileSync(this.filePath, backup); } catch {}
    }
    fs.writeFileSync(temporary, JSON.stringify(this.state, null, 2), { mode: 0o600 });
    fs.renameSync(temporary, this.filePath);
  }

  _touch() {
    this.state.updatedAt = now();
    this.state.revision = Math.max(1, toNumber(this.state.revision) + 1);
  }

  _record(type, payload = {}) {
    this.state.events.push({ id: `evt_${now()}_${Math.random().toString(36).slice(2, 8)}`, type, at: now(), ...payload });
    this.state.events = this.state.events.slice(-MAX_EVENTS);
  }

  _rebuildIdentityIndex() {
    this.identityIndex.clear();
    for (const [entityKey, entity] of Object.entries(this.state.entities)) {
      if (!entity || typeof entity !== 'object') continue;
      const aliases = unique([
        ...(Array.isArray(entity.identityKeys) ? entity.identityKeys : []),
        ...identityKeys(entity.profile || {}),
      ]);
      entity.identityKeys = aliases;
      this._indexEntity(entityKey, entity);
    }
  }

  _indexEntity(entityKey, entity) {
    for (const key of Array.isArray(entity?.identityKeys) ? entity.identityKeys : []) {
      if (!key || (this.identityIndex.has(key) && this.identityIndex.get(key) !== entityKey)) continue;
      this.identityIndex.set(key, entityKey);
    }
  }

  _rebuildRankIndex() {
    this.nextRankByColumn.clear();
    for (const card of Object.values(this.state.cards)) {
      if (!card || typeof card !== 'object' || !card.columnId) continue;
      const nextRank = toNumber(card.rank) + 1;
      const current = this.nextRankByColumn.get(card.columnId) || 0;
      if (nextRank > current) this.nextRankByColumn.set(card.columnId, nextRank);
    }
  }

  _findEntityByIdentity(keys) {
    for (const key of keys) {
      const entityKey = this.identityIndex.get(key);
      if (entityKey && this.state.entities[entityKey]) return entityKey;
    }
    return null;
  }

  _mergeProfile(current = {}, incoming = {}) {
    const merged = { ...current };
    for (const [key, value] of Object.entries(incoming)) {
      if (key === 'score') {
        merged.score = Math.max(toNumber(current.score), toNumber(value));
      } else if (key === 'lastInteractionAt') {
        merged.lastInteractionAt = Math.max(toNumber(current.lastInteractionAt), toNumber(value));
      } else if (value !== '' && value != null) {
        merged[key] = value;
      }
    }
    return merged;
  }

  _columnById(columnId) {
    return this.state.board.columns.find((column) => column.id === columnId) || null;
  }

  _stageFor(entity, card, trigger, force = false) {
    if (card.manualOverride && !force) return card.columnId;
    const rules = this.state.board.rules
      .filter((rule) => rule.enabled && (rule.trigger === 'any' || rule.trigger === trigger || trigger === 'sync'))
      .sort((a, b) => a.priority - b.priority);
    const match = rules.find((rule) => ruleMatches(entity, rule));
    return match?.action?.columnId || card.columnId || this.state.board.columns[0].id;
  }

  _nextRank(columnId) {
    const rank = this.nextRankByColumn.get(columnId) || 0;
    this.nextRankByColumn.set(columnId, rank + 1);
    return rank;
  }

  _upsertEntity(raw, source, trigger) {
    const profile = profileFrom(raw);
    const keys = identityKeys(profile);
    if (!keys.length) return null;
    let entityKey = this._findEntityByIdentity(keys);
    if (!entityKey) entityKey = keys.find((key) => key.startsWith('phone:')) || keys[0];
    const current = this.state.entities[entityKey] || {
      entityKey,
      identityKeys: [],
      sourceRefs: { mapsIds: [], scoringIds: [], campaignRefs: [] },
      profile: {},
      createdAt: now(),
    };
    const ref = sourceReference(source, raw, profile);
    current.identityKeys = unique([...(current.identityKeys || []), ...keys]);
    current.sourceRefs = {
      mapsIds: unique(current.sourceRefs?.mapsIds || []),
      scoringIds: unique(current.sourceRefs?.scoringIds || []),
      campaignRefs: unique(current.sourceRefs?.campaignRefs || []),
    };
    if (ref.value) current.sourceRefs[ref.field] = unique([...current.sourceRefs[ref.field], ref.value]);
    current.profile = this._mergeProfile(current.profile, profile);
    current.updatedAt = now();
    this.state.entities[entityKey] = current;
    this._indexEntity(entityKey, current);

    const existingCard = this.state.cards[entityKey] || {
      entityKey,
      columnId: this.state.board.columns[0].id,
      rank: this._nextRank(this.state.board.columns[0].id),
      revision: 1,
      manualOverride: false,
      movedAt: now(),
      createdAt: now(),
    };
    const nextColumnId = this._stageFor(current, existingCard, trigger, false);
    if (nextColumnId !== existingCard.columnId && !existingCard.manualOverride) {
      existingCard.columnId = nextColumnId;
      existingCard.rank = this._nextRank(nextColumnId);
      existingCard.revision = toNumber(existingCard.revision) + 1;
      existingCard.movedAt = now();
    }
    existingCard.updatedAt = now();
    this.state.cards[entityKey] = existingCard;
    return entityKey;
  }

  syncLeads(leads, source = 'maps') {
    const list = Array.isArray(leads) ? leads : [];
    const synced = [];
    for (const raw of list) {
      if (!raw || typeof raw !== 'object') continue;
      const entityKey = this._upsertEntity(raw, source, eventForSource(source, raw));
      if (entityKey) synced.push(entityKey);
    }
    if (synced.length) {
      this._record('leads_synced', { source, count: synced.length });
      this._touch();
      this._writeAtomic();
    }
    return this.getBoard();
  }

  syncCampaigns(campaigns) {
    const list = Array.isArray(campaigns) ? campaigns : [];
    const flattened = [];
    for (const campaign of list) {
      for (const lead of Array.isArray(campaign?.leads) ? campaign.leads : []) {
        flattened.push({ ...lead, campaignId: campaign.id, campaignStatus: campaign.status });
      }
    }
    return this.syncLeads(flattened, 'campaign');
  }

  applyRules({ force = false, trigger = 'sync' } = {}) {
    let moved = 0;
    for (const [entityKey, entity] of Object.entries(this.state.entities)) {
      const card = this.state.cards[entityKey];
      if (!card) continue;
      const columnId = this._stageFor(entity, card, trigger, force);
      if (columnId !== card.columnId) {
        card.columnId = columnId;
        card.rank = this._nextRank(columnId);
        card.revision = toNumber(card.revision) + 1;
        card.movedAt = now();
        card.updatedAt = now();
        moved += 1;
      }
    }
    if (moved) {
      this._record('rules_applied', { moved, force: Boolean(force), trigger });
      this._touch();
      this._writeAtomic();
    }
    return { moved, board: this.getBoard() };
  }

  saveConfig(board, expectedRevision) {
    if (expectedRevision != null && toNumber(expectedRevision) !== toNumber(this.state.revision)) {
      const error = new Error('O Kanban mudou em outra tela. Atualize e tente novamente.');
      error.code = 'KANBAN_CONFLICT';
      throw error;
    }
    const normalized = normalizeBoard(board);
    if (!normalized.columns.length) throw new Error('O Kanban precisa ter pelo menos uma etapa.');
    this.state.board = normalized;
    const fallback = normalized.columns[0].id;
    for (const card of Object.values(this.state.cards)) {
      if (!this._columnById(card.columnId)) {
        card.columnId = fallback;
        card.rank = this._nextRank(fallback);
        card.revision = toNumber(card.revision) + 1;
      }
    }
    this._record('board_configured', { columns: normalized.columns.length, rules: normalized.rules.length });
    this._touch();
    this._writeAtomic();
    return this.getBoard();
  }

  moveCard({ entityKey, toColumnId, expectedRevision, manual = true }) {
    const key = cleanText(entityKey, 180);
    const card = this.state.cards[key];
    if (!card || !this.state.entities[key]) throw new Error('Lead não encontrado no Kanban.');
    const column = this._columnById(toColumnId);
    if (!column) throw new Error('Etapa do Kanban inválida.');
    if (expectedRevision != null && toNumber(expectedRevision) !== toNumber(card.revision)) {
      const error = new Error('Este card foi alterado em outra tela. Atualize e tente novamente.');
      error.code = 'KANBAN_CONFLICT';
      throw error;
    }
    if (card.columnId !== column.id && column.wipLimit) {
      const current = Object.values(this.state.cards).filter((item) => item.columnId === column.id).length;
      if (current >= column.wipLimit) throw new Error(`A etapa “${column.name}” atingiu o limite de ${column.wipLimit} cards.`);
    }
    card.columnId = column.id;
    card.rank = this._nextRank(column.id);
    card.manualOverride = Boolean(manual);
    card.movedAt = now();
    card.updatedAt = now();
    card.revision = toNumber(card.revision) + 1;
    this._record('card_moved', { entityKey: key, columnId: column.id, manual: Boolean(manual) });
    this._touch();
    this._writeAtomic();
    return this.getBoard();
  }

  resumeAutomation(entityKey) {
    const key = cleanText(entityKey, 180);
    const card = this.state.cards[key];
    if (!card) throw new Error('Lead não encontrado no Kanban.');
    card.manualOverride = false;
    card.updatedAt = now();
    card.revision = toNumber(card.revision) + 1;
    this._record('automation_resumed', { entityKey: key });
    this._touch();
    this._writeAtomic();
    return this.getBoard();
  }

  getBoard() {
    const columns = [...this.state.board.columns].sort((a, b) => a.position - b.position);
    const cards = Object.entries(this.state.cards)
      .map(([entityKey, card]) => ({
        ...clone(card),
        entity: clone(this.state.entities[entityKey] || {}),
      }))
      .filter((card) => card.entity?.entityKey)
      .sort((a, b) => a.rank - b.rank || a.entity.profile.name.localeCompare(b.entity.profile.name, 'pt-BR'));
    return clone({
      version: VERSION,
      revision: this.state.revision,
      board: { columns, rules: this.state.board.rules },
      cards,
      updatedAt: this.state.updatedAt,
    });
  }
}

module.exports = {
  KanbanStore,
  ALLOWED_FIELDS,
  ALLOWED_OPERATORS,
  ALLOWED_TRIGGERS,
  defaultState,
  normalizeBoard,
  profileFrom,
  identityKeys,
  ruleMatches,
};
