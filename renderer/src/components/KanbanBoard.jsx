import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  BriefcaseBusiness,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Filter,
  GripVertical,
  Mail,
  MapPin,
  Phone,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Settings2,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { readLocalArray } from '../leadData';

const FIELD_OPTIONS = [
  { value: 'score', label: 'Score' },
  { value: 'priority', label: 'Prioridade' },
  { value: 'hasPhone', label: 'Tem telefone' },
  { value: 'hasWebsite', label: 'Tem site' },
  { value: 'hasEmail', label: 'Tem e-mail' },
  { value: 'category', label: 'Categoria' },
  { value: 'city', label: 'Cidade' },
  { value: 'campaignStatus', label: 'Status de campanha' },
  { value: 'prospectingStatus', label: 'Status comercial' },
];

const OPERATOR_OPTIONS = [
  { value: 'gte', label: 'é maior ou igual a' },
  { value: 'lte', label: 'é menor ou igual a' },
  { value: 'equals', label: 'é igual a' },
  { value: 'contains', label: 'contém' },
  { value: 'in', label: 'está em uma lista' },
  { value: 'isTrue', label: 'é verdadeiro' },
  { value: 'isFalse', label: 'é falso' },
];

const TRIGGER_OPTIONS = [
  { value: 'sync', label: 'Ao sincronizar fontes' },
  { value: 'lead.imported', label: 'Ao importar lead' },
  { value: 'scoring.completed', label: 'Ao concluir scoring' },
  { value: 'campaign.sent', label: 'Ao enviar campanha' },
  { value: 'campaign.replied', label: 'Ao receber resposta' },
  { value: 'any', label: 'Em qualquer evento' },
];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function cardName(card) {
  return card?.entity?.profile?.name || 'Lead sem nome';
}

function cardSources(card) {
  const refs = card?.entity?.sourceRefs || {};
  return [
    refs.mapsIds?.length ? 'Maps' : null,
    refs.scoringIds?.length ? 'Scoring' : null,
    refs.campaignRefs?.length ? 'Campanha' : null,
  ].filter(Boolean);
}

function hasNoValueOperator(operator) {
  return operator === 'isTrue' || operator === 'isFalse';
}

function newRule(columns) {
  return {
    id: `rule-${Date.now()}`,
    enabled: true,
    priority: 10,
    trigger: 'sync',
    match: 'all',
    when: [{ field: 'score', operator: 'gte', value: '80' }],
    action: { type: 'move', columnId: columns[0]?.id || 'new' },
  };
}

function newColumn(index) {
  const palette = ['#0ea5e9', '#8b5cf6', '#f59e0b', '#ec4899', '#14b8a6'];
  return {
    id: `stage-${Date.now()}-${index + 1}`,
    name: 'Nova etapa',
    color: palette[index % palette.length],
    terminal: false,
    wipLimit: null,
  };
}

function RuleEditor({ rule, columns, onChange, onRemove }) {
  const updateRule = (patch) => onChange({ ...rule, ...patch });
  const updateCondition = (index, patch) => {
    const when = rule.when.map((condition, itemIndex) => itemIndex === index ? { ...condition, ...patch } : condition);
    updateRule({ when });
  };
  const addCondition = () => updateRule({
    when: [...rule.when, { field: 'score', operator: 'gte', value: '80' }],
  });

  return (
    <section className="kanban-rule-editor">
      <div className="kanban-rule-head">
        <label className="kanban-switch">
          <input type="checkbox" checked={rule.enabled !== false} onChange={(event) => updateRule({ enabled: event.target.checked })} />
          <span>Regra ativa</span>
        </label>
        <button type="button" className="icon-btn" aria-label="Remover regra" title="Remover regra" onClick={onRemove}><X size={15} /></button>
      </div>
      <div className="kanban-rule-grid">
        <label>
          Evento
          <select value={rule.trigger} onChange={(event) => updateRule({ trigger: event.target.value })}>
            {TRIGGER_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label>
          Combinar
          <select value={rule.match || 'all'} onChange={(event) => updateRule({ match: event.target.value })}>
            <option value="all">todas as condições</option>
            <option value="any">qualquer condição</option>
          </select>
        </label>
        <label>
          Prioridade
          <input type="number" min="0" max="999" value={rule.priority ?? 10} onChange={(event) => updateRule({ priority: Number(event.target.value) || 0 })} />
        </label>
        <label>
          Mover para
          <select value={rule.action?.columnId || ''} onChange={(event) => updateRule({ action: { type: 'move', columnId: event.target.value } })}>
            {columns.map((column) => <option key={column.id} value={column.id}>{column.name || 'Etapa'}</option>)}
          </select>
        </label>
      </div>
      <div className="kanban-rule-conditions">
        {rule.when.map((condition, index) => (
          <div className="kanban-condition" key={`${rule.id}-${index}`}>
            <select value={condition.field} onChange={(event) => updateCondition(index, { field: event.target.value })} aria-label="Campo da condição">
              {FIELD_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <select value={condition.operator} onChange={(event) => updateCondition(index, { operator: event.target.value })} aria-label="Operador da condição">
              {OPERATOR_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            {hasNoValueOperator(condition.operator) ? <span className="kanban-condition-static">sem valor</span> : (
              <input value={condition.value ?? ''} onChange={(event) => updateCondition(index, { value: event.target.value })} placeholder="Valor" aria-label="Valor da condição" />
            )}
            <button type="button" className="icon-btn" disabled={rule.when.length <= 1} aria-label="Remover condição" onClick={() => updateRule({ when: rule.when.filter((_, itemIndex) => itemIndex !== index) })}><X size={14} /></button>
          </div>
        ))}
        <button type="button" className="btn btn-ghost btn-compact" onClick={addCondition}><Plus size={14} /> Condição</button>
      </div>
    </section>
  );
}

function KanbanSettingsModal({ board, onClose, onSave, saving }) {
  const [draft, setDraft] = useState(() => clone(board));
  const [formError, setFormError] = useState('');

  const updateColumn = (index, patch) => {
    setDraft((current) => ({
      ...current,
      columns: current.columns.map((column, itemIndex) => itemIndex === index ? { ...column, ...patch } : column),
    }));
  };
  const removeColumn = (index) => {
    if (draft.columns.length <= 1) return;
    const target = draft.columns[index];
    const nextColumns = draft.columns.filter((_, itemIndex) => itemIndex !== index);
    setDraft((current) => ({
      ...current,
      columns: nextColumns,
      rules: current.rules.map((rule) => rule.action?.columnId === target.id
        ? { ...rule, action: { ...rule.action, columnId: nextColumns[0].id } }
        : rule),
    }));
  };
  const updateRule = (index, rule) => setDraft((current) => ({
    ...current,
    rules: current.rules.map((item, itemIndex) => itemIndex === index ? rule : item),
  }));
  const save = async () => {
    if (draft.columns.some((column) => !String(column.name || '').trim())) {
      setFormError('Dê um nome para cada etapa antes de salvar.');
      return;
    }
    setFormError('');
    await onSave(draft);
  };

  return (
    <div className="overlay on kanban-modal-overlay" role="presentation" onClick={onClose}>
      <section className="kanban-settings-modal" role="dialog" aria-modal="true" aria-labelledby="kanban-settings-title" onClick={(event) => event.stopPropagation()}>
        <header className="kanban-modal-head">
          <div>
            <span className="eyebrow">Fluxo comercial</span>
            <h2 id="kanban-settings-title">Configurar Kanban</h2>
            <p>Defina etapas, limites e regras declarativas. Movimentos manuais não são sobrescritos automaticamente.</p>
          </div>
          <button type="button" className="icon-btn" aria-label="Fechar configuração" onClick={onClose}><X size={18} /></button>
        </header>
        <div className="kanban-settings-body">
          <section>
            <div className="kanban-section-title">
              <div><h3>Etapas</h3><p>As colunas determinam o funil visível para todos os leads.</p></div>
              <button type="button" className="btn btn-secondary btn-compact" onClick={() => setDraft((current) => ({ ...current, columns: [...current.columns, newColumn(current.columns.length)] }))}><Plus size={14} /> Etapa</button>
            </div>
            <div className="kanban-stage-settings">
              {draft.columns.map((column, index) => (
                <div className="kanban-stage-row" key={column.id}>
                  <GripVertical size={16} aria-hidden="true" />
                  <input type="color" value={column.color || '#10a37f'} onChange={(event) => updateColumn(index, { color: event.target.value })} aria-label={`Cor da etapa ${column.name || index + 1}`} />
                  <input value={column.name || ''} onChange={(event) => updateColumn(index, { name: event.target.value })} maxLength="60" aria-label={`Nome da etapa ${index + 1}`} />
                  <label className="kanban-checkbox"><input type="checkbox" checked={Boolean(column.terminal)} onChange={(event) => updateColumn(index, { terminal: event.target.checked })} /> Final</label>
                  <label className="kanban-wip">WIP <input type="number" min="1" max="999" value={column.wipLimit || ''} placeholder="—" onChange={(event) => updateColumn(index, { wipLimit: event.target.value ? Number(event.target.value) : null })} /></label>
                  <button type="button" className="icon-btn" disabled={draft.columns.length <= 1} aria-label={`Remover ${column.name || 'etapa'}`} onClick={() => removeColumn(index)}><X size={15} /></button>
                </div>
              ))}
            </div>
          </section>
          <section>
            <div className="kanban-section-title">
              <div><h3>Regras de negócio</h3><p>Sem código executável: apenas condições validadas e uma ação de movimento.</p></div>
              <button type="button" className="btn btn-secondary btn-compact" onClick={() => setDraft((current) => ({ ...current, rules: [...current.rules, newRule(current.columns)] }))}><Plus size={14} /> Regra</button>
            </div>
            {draft.rules.length === 0 ? <div className="kanban-empty-rules">Ainda não há automações. Leads novos entram em “{draft.columns[0]?.name || 'Novos'}”.</div> : (
              <div className="kanban-rules-list">
                {draft.rules.map((rule, index) => <RuleEditor key={rule.id} rule={rule} columns={draft.columns} onChange={(next) => updateRule(index, next)} onRemove={() => setDraft((current) => ({ ...current, rules: current.rules.filter((_, itemIndex) => itemIndex !== index) }))} />)}
              </div>
            )}
          </section>
        </div>
        <footer className="kanban-modal-foot">
          {formError ? <span className="field-err" role="alert">{formError}</span> : <span />}
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button type="button" className="btn btn-primary" disabled={saving} onClick={save}>{saving ? 'Salvando…' : 'Salvar Kanban'}</button>
        </footer>
      </section>
    </div>
  );
}

function CardDetailsModal({ card, board, onClose, onMove, onResumeAutomation, onNavigate, busy }) {
  const profile = card.entity.profile || {};
  return (
    <div className="overlay on kanban-modal-overlay" role="presentation" onClick={onClose}>
      <section className="kanban-card-modal" role="dialog" aria-modal="true" aria-labelledby="kanban-card-title" onClick={(event) => event.stopPropagation()}>
        <header className="kanban-modal-head">
          <div>
            <span className="eyebrow">Lead no Kanban</span>
            <h2 id="kanban-card-title">{cardName(card)}</h2>
          </div>
          <button type="button" className="icon-btn" aria-label="Fechar detalhes do lead" onClick={onClose}><X size={18} /></button>
        </header>
        <div className="kanban-card-details">
          <div className="kanban-detail-grid">
            <span><Phone size={14} /> {profile.phone || 'Sem telefone'}</span>
            <span><Mail size={14} /> {profile.email || 'Sem e-mail'}</span>
            <span><MapPin size={14} /> {[profile.city, profile.state].filter(Boolean).join(' · ') || 'Localização não informada'}</span>
            <span><BriefcaseBusiness size={14} /> {profile.category || 'Sem categoria'}</span>
          </div>
          <div className="kanban-card-score"><span>Score</span><strong>{Number(profile.score || 0)}</strong><small>{profile.priority || 'sem prioridade'}</small></div>
          <label className="field">
            <span>Mover para</span>
            <select value={card.columnId} disabled={busy} onChange={(event) => onMove(card, event.target.value)}>
              {board.columns.map((column) => <option key={column.id} value={column.id}>{column.name}</option>)}
            </select>
          </label>
          <div className="kanban-source-line"><span>Fontes</span>{cardSources(card).map((source) => <b key={source}>{source}</b>)}</div>
          {card.manualOverride ? <div className="kanban-override-note"><CircleAlert size={15} /> Movimento manual: automações estão pausadas para este lead.<button type="button" className="btn btn-ghost btn-compact" onClick={() => onResumeAutomation(card.entityKey)}>Retomar automação</button></div> : null}
        </div>
        <footer className="kanban-modal-foot">
          <button type="button" className="btn btn-secondary" onClick={() => onNavigate?.('base')}><ArrowRight size={14} /> Ver na base</button>
          <button type="button" className="btn btn-primary" onClick={onClose}>Concluir</button>
        </footer>
      </section>
    </div>
  );
}

export default function KanbanBoard({ onNavigate, addLog }) {
  const [board, setBoard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectedCard, setSelectedCard] = useState(null);
  const [draggingKey, setDraggingKey] = useState(null);

  const applyBoard = useCallback((result) => {
    if (!result?.success || !result.board) {
      throw new Error(result?.error || 'Não foi possível carregar o Kanban.');
    }
    setBoard(result.board);
    return result.board;
  }, []);

  const loadBoard = useCallback(async ({ quiet = false } = {}) => {
    if (!window.kanbanAPI) {
      setError('Esta versão do aplicativo não possui o Kanban geral. Atualize o aplicativo.');
      setLoading(false);
      return;
    }
    if (!quiet) setLoading(true);
    try {
      const mapsLeads = readLocalArray('sigma_leads');
      if (mapsLeads.length) applyBoard(await window.kanbanAPI.syncMapsLeads(mapsLeads));
      applyBoard(await window.kanbanAPI.getBoard());
      setError('');
    } catch (loadError) {
      setError(loadError.message || 'Não foi possível sincronizar o Kanban.');
    } finally {
      setLoading(false);
    }
  }, [applyBoard]);

  useEffect(() => {
    loadBoard();
    const refresh = () => loadBoard({ quiet: true });
    window.addEventListener('sigma:leads-updated', refresh);
    return () => window.removeEventListener('sigma:leads-updated', refresh);
  }, [loadBoard]);

  const cards = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('pt-BR');
    return (board?.cards || []).filter((card) => {
      const profile = card.entity?.profile || {};
      if (filter === 'phone' && !profile.phone) return false;
      if (filter === 'high-score' && Number(profile.score || 0) < 80) return false;
      if (filter === 'manual' && !card.manualOverride) return false;
      if (!needle) return true;
      return `${profile.name || ''} ${profile.category || ''} ${profile.city || ''} ${profile.phone || ''}`.toLocaleLowerCase('pt-BR').includes(needle);
    });
  }, [board, filter, query]);

  const moveCard = async (card, toColumnId) => {
    if (!window.kanbanAPI || card.columnId === toColumnId) return;
    setBusy(true);
    setError('');
    try {
      const next = applyBoard(await window.kanbanAPI.moveCard({
        entityKey: card.entityKey,
        toColumnId,
        expectedRevision: card.revision,
        manual: true,
      }));
      const stage = next.board.columns.find((column) => column.id === toColumnId);
      setNotice(`${cardName(card)} movido para ${stage?.name || 'a etapa selecionada'}.`);
      addLog?.(`[KANBAN] ${cardName(card)} movido para ${stage?.name || toColumnId}.`);
      setSelectedCard((current) => current?.entityKey === card.entityKey ? next.cards.find((item) => item.entityKey === card.entityKey) || null : current);
    } catch (moveError) {
      setError(moveError.message || 'Não foi possível mover o card.');
    } finally {
      setBusy(false);
      setDraggingKey(null);
    }
  };

  const saveConfig = async (draft) => {
    setBusy(true);
    setError('');
    try {
      applyBoard(await window.kanbanAPI.saveConfig(draft, board.revision));
      setSettingsOpen(false);
      setNotice('Configuração do Kanban salva.');
    } catch (saveError) {
      setError(saveError.message || 'Não foi possível salvar a configuração.');
    } finally {
      setBusy(false);
    }
  };

  const applyRules = async () => {
    setBusy(true);
    setError('');
    try {
      const result = await window.kanbanAPI.applyRules(true);
      if (!result?.success || !result.board) throw new Error(result?.error || 'Não foi possível reaplicar as regras.');
      setBoard(result.board);
      setNotice(result.moved ? `${result.moved} card(s) atualizado(s) pelas regras.` : 'Nenhum card precisou ser movido pelas regras.');
    } catch (applyError) {
      setError(applyError.message || 'Não foi possível reaplicar as regras.');
    } finally {
      setBusy(false);
    }
  };

  const resumeAutomation = async (entityKey) => {
    setBusy(true);
    try {
      const next = applyBoard(await window.kanbanAPI.resumeAutomation(entityKey));
      setSelectedCard(next.cards.find((card) => card.entityKey === entityKey) || null);
      setNotice('Automações reativadas para este lead.');
    } catch (resumeError) {
      setError(resumeError.message || 'Não foi possível reativar as automações.');
    } finally {
      setBusy(false);
    }
  };

  if (loading && !board) {
    return <section className="kanban-loading"><RefreshCw size={18} className="spin" /> Carregando Kanban…</section>;
  }

  return (
    <section className="kanban-view" data-od-id="global-kanban">
      <header className="kanban-topbar">
        <div>
          <span className="eyebrow">Pipeline comercial</span>
          <h1>Kanban</h1>
          <p>Todos os leads conectados às suas fontes, em um único funil.</p>
        </div>
        <div className="kanban-actions">
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => loadBoard()}><RefreshCw size={14} /> Atualizar</button>
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={applyRules}><RotateCcw size={14} /> Reaplicar regras</button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => setSettingsOpen(true)}><Settings2 size={15} /> Configurar Kanban</button>
        </div>
      </header>

      <div className="kanban-toolbar">
        <label className="kanban-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar empresa, cidade ou telefone…" aria-label="Buscar no Kanban" /></label>
        <label className="kanban-filter"><Filter size={14} /><select value={filter} onChange={(event) => setFilter(event.target.value)} aria-label="Filtrar cards"><option value="all">Todos os leads</option><option value="high-score">Score 80+</option><option value="phone">Com telefone</option><option value="manual">Movidos manualmente</option></select><ChevronDown size={13} aria-hidden="true" /></label>
        <span className="kanban-total">{cards.length} lead{cards.length === 1 ? '' : 's'} visível{cards.length === 1 ? '' : 'eis'}</span>
      </div>

      {error ? <div className="kanban-feedback error" role="alert"><CircleAlert size={16} /> {error}</div> : null}
      {notice ? <div className="kanban-feedback success" role="status"><CheckCircle2 size={16} /> {notice}<button type="button" aria-label="Fechar mensagem" onClick={() => setNotice('')}><X size={14} /></button></div> : null}

      <div className="kanban-columns" aria-label="Quadro Kanban">
        {(board?.board?.columns || []).map((column) => {
          const stageCards = cards.filter((card) => card.columnId === column.id);
          return (
            <section
              key={column.id}
              className="kanban-column"
              style={{ '--kanban-stage': column.color }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                const card = cards.find((item) => item.entityKey === draggingKey);
                if (card) moveCard(card, column.id);
              }}
            >
              <header className="kanban-column-head">
                <div><span className="kanban-stage-dot" /><h2>{column.name}</h2>{column.wipLimit ? <small>limite {column.wipLimit}</small> : null}</div>
                <b>{stageCards.length}</b>
              </header>
              <div className="kanban-column-cards">
                {stageCards.length === 0 ? <div className="kanban-column-empty">Arraste um lead para esta etapa</div> : stageCards.map((card) => {
                  const profile = card.entity.profile || {};
                  return (
                    <article key={card.entityKey} className="kanban-card" draggable onDragStart={() => setDraggingKey(card.entityKey)} onDragEnd={() => setDraggingKey(null)} onClick={() => setSelectedCard(card)}>
                      <div className="kanban-card-title"><GripVertical size={15} aria-hidden="true" /><strong>{cardName(card)}</strong>{card.manualOverride ? <span title="Movido manualmente">Manual</span> : null}</div>
                      <div className="kanban-card-meta"><span>{profile.category || 'Sem categoria'}</span>{profile.city ? <span>{profile.city}</span> : null}</div>
                      <div className="kanban-card-bottom"><span className="kanban-score">Score <b>{Number(profile.score || 0)}</b></span><span className="kanban-source-chips">{cardSources(card).map((source) => <i key={source}>{source}</i>)}</span></div>
                      <label className="kanban-card-move" onClick={(event) => event.stopPropagation()}>
                        <span className="sr-only">Mover {cardName(card)} para</span>
                        <select value={card.columnId} disabled={busy} onChange={(event) => moveCard(card, event.target.value)}>{board.board.columns.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select>
                      </label>
                    </article>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      {settingsOpen ? <KanbanSettingsModal board={board.board} onClose={() => setSettingsOpen(false)} onSave={saveConfig} saving={busy} /> : null}
      {selectedCard ? <CardDetailsModal card={selectedCard} board={board.board} onClose={() => setSelectedCard(null)} onMove={moveCard} onResumeAutomation={resumeAutomation} onNavigate={onNavigate} busy={busy} /> : null}
    </section>
  );
}
