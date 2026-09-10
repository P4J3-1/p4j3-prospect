import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Target,
  Settings,
  Download,
  Play,
  Pause,
  RotateCcw,
  CheckCircle,
  AlertTriangle,
  Sparkles,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  Search,
  Users,
  Eye,
  EyeOff
} from 'lucide-react';
import { dedupeLeads, normalizeLeadCollection, readLocalArray } from '../leadData';

const AUDITS = {
  sites: { name: 'Venda de Sites', hint: 'Qualidade e ausência de site, mobile, performance, SEO, hero, CTA e conversão.' },
  seo: { name: 'SEO', hint: 'Estrutura, títulos, conteúdo e sinais técnicos para buscadores.' },
  mkt: { name: 'Marketing Digital', hint: 'Presença, conteúdo e canais como ativo de aquisição.' },
  pres: { name: 'Presença Digital', hint: 'Visão geral da pegada digital da empresa.' },
  custom: { name: 'Customizado', hint: 'Direcionado pelo objetivo definido abaixo.' }
};

const PROVIDERS = {
  opencode: {
    name: 'OpenCode',
    base: 'https://opencode.ai/zen/v1',
    models: ['deepseek-v4-flash-free']
  },
  openrouter: {
    name: 'OpenRouter',
    base: 'https://openrouter.ai/api/v1',
    models: [
      'anthropic/claude-3.5-sonnet',
      'openai/gpt-4o-mini',
      'google/gemini-flash-1.5',
      'meta-llama/llama-3.1-70b'
    ]
  },
  custom: { name: 'Custom API', base: '', models: [] }
};

function defaultAiConfig() {
  return {
    provider: 'opencode',
    baseUrl: 'https://opencode.ai/zen/v1',
    key: '',
    hasApiKey: false,
    model: 'deepseek-v4-flash-free',
    preset: 'sites',
    objective: ''
  };
}

function readAiConfig() {
  try {
    const a = JSON.parse(localStorage.getItem('sigma_ai') || 'null');
    if (a && a.provider) {
      const fallback = defaultAiConfig();
      const isLegacyDemo = a.provider === 'openrouter' && a.key === 'sk-demo-0000-ficticia';
      return {
        ...fallback,
        ...a,
        provider: isLegacyDemo ? fallback.provider : a.provider,
        baseUrl: isLegacyDemo ? fallback.baseUrl : (a.baseUrl || PROVIDERS[a.provider]?.base || fallback.baseUrl),
        key: isLegacyDemo ? '' : (a.key || ''),
      };
    }
  } catch {}
  return defaultAiConfig();
}

function saveAiConfig(cfg) {
  try {
    const { key, ...safeConfig } = cfg || {};
    localStorage.setItem('sigma_ai', JSON.stringify(safeConfig));
  } catch {}
}

function toUiAiConfig(settings, current = defaultAiConfig()) {
  const ai = settings?.ai || {};
  const provider = ai.provider || current.provider || 'opencode';
  return {
    ...current,
    provider,
    baseUrl: ai.baseUrl || PROVIDERS[provider]?.base || current.baseUrl,
    key: '',
    hasApiKey: Boolean(ai.hasApiKey || (ai.apiKey && ai.apiKey !== '')),
    model: ai.model || current.model || 'deepseek-v4-flash-free',
  };
}

function scBand(score) {
  return score >= 80 ? 'alta' : score >= 50 ? 'media' : 'baixa';
}

function fmtShort(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function analysisFromService(savedLead, preset = 'sites') {
  const company = savedLead?.company || savedLead || {};
  const site = savedLead?.siteAnalysis || {};
  const ai = savedLead?.aiAnalysis || {};
  const score = Number(savedLead?.score?.value ?? savedLead?.score ?? 0);
  const positive = [
    site.hasHttps ? 'HTTPS ativo' : '',
    site.mobile?.isResponsive ? 'Layout responsivo identificado' : '',
    site.conversion?.hasWhatsappButton ? 'Canal de WhatsApp identificado' : '',
    site.conversion?.hasForm ? 'Formulário de contato identificado' : '',
  ].filter(Boolean);
  const negative = [
    ...(Array.isArray(ai.principais_dores) ? ai.principais_dores : []),
    ...(Array.isArray(savedLead?.score?.sitePains) ? savedLead.score.sitePains : []),
  ].filter(Boolean);
  const opportunities = [
    ...(Array.isArray(ai.principais_oportunidades) ? ai.principais_oportunidades : []),
    ...(Array.isArray(site.siteSummary?.conversion?.likelyLeaks) ? site.siteSummary.conversion.likelyLeaks : []),
  ].filter(Boolean);
  const noSite = !site.finalUrl && !company.website;
  const sections = [
    {
      t: 'Diagnóstico técnico',
      items: [
        noSite ? 'Nenhum site próprio foi localizado na análise.' : `Site analisado: ${site.finalUrl || company.website}`,
        site.performance?.loadTimeMs ? `Carregamento medido: ${Math.round(site.performance.loadTimeMs)} ms` : '',
      ].filter(Boolean),
    },
    ai.resumo ? { t: 'Resumo comercial', items: [ai.resumo] } : null,
  ].filter(Boolean);
  return {
    score,
    band: scBand(score),
    pos: positive,
    neg: negative.length ? negative : (Array.isArray(savedLead?.score?.reasons) ? savedLead.score.reasons : []),
    opp: opportunities,
    sections,
    noSite,
    provider: ai.rawProvider || (ai.providerModel ? 'IA' : 'regras locais'),
    model: ai.providerModel || '',
    preset,
    ts: savedLead?.updatedAt || savedLead?.createdAt || Date.now(),
  };
}

export default function LeadScoring({ onUpdateScoringCount, addLog }) {
  const [leads, setLeads] = useState(() => normalizeLeadCollection(readLocalArray('sigma_leads')));
  const [groups, setGroups] = useState(() => readLocalArray('sigma_groups'));

  // Grupo ativo
  const [selectedGroupId, setSelectedGroupId] = useState(() => {
    try {
      const saved = localStorage.getItem('sigma_scgroup');
      if (saved !== null) return saved;
    } catch {}
    return '';
  });

  // Configuração de IA
  const [aiConfig, setAiConfig] = useState(() => readAiConfig());
  const [isAiModalOpen, setIsAiModalOpen] = useState(false);
  const [aiDraft, setAiDraft] = useState(() => readAiConfig());
  const [showKey, setShowKey] = useState(false);
  const [testStatusMsg, setTestStatusMsg] = useState('');

  const [analysisMap, setAnalysisMap] = useState({});

  // Estado de execução do scoring
  const [isRunning, setIsRunning] = useState(false);
  const [runStates, setRunStates] = useState({}); // { [leadId]: 'wait' | 'run' | 'done' | 'fail' | 'nosite' }
  const [progressCount, setProgressCount] = useState({ current: 0, total: 0 });
  const [progressText, setProgressText] = useState('');

  // Seleção na tabela
  const [selectedRowIds, setSelectedRowIds] = useState(new Set());

  // Modal de Detalhes do Lead
  const [detailLead, setDetailLead] = useState(null);
  const [openAccSections, setOpenAccSections] = useState({});

  const activeJobRef = useRef(null);

  useEffect(() => {
    let disposed = false;
    window.leadScoringAPI?.getSettings?.().then((response) => {
      if (disposed || !response?.success) return;
      setAiConfig((current) => {
        const next = toUiAiConfig(response.settings, current);
        saveAiConfig(next);
        return next;
      });
      setAiDraft((current) => toUiAiConfig(response.settings, current));
    }).catch(() => {});
    return () => { disposed = true; };
  }, []);

  useEffect(() => {
    let disposed = false;
    const loadCanonicalScoring = async () => {
      if (!window.leadScoringAPI?.getAll) return;
      try {
        const [analysisResponse, groupsResponse] = await Promise.all([
          window.leadScoringAPI.getAll({}),
          window.leadScoringAPI.listGroups?.() || Promise.resolve(null),
        ]);
        if (disposed) return;
        if (analysisResponse?.success) {
          const next = {};
          for (const savedLead of analysisResponse.leads || []) {
            if (savedLead?.id) next[savedLead.id] = analysisFromService(savedLead);
          }
          setAnalysisMap(next);
        }
        if (groupsResponse?.success && Array.isArray(groupsResponse.groups) && groupsResponse.groups.length) {
          setGroups(groupsResponse.groups.map((group) => ({
            ...group,
            members: Array.isArray(group.members) ? group.members : (group.leadIds || []),
          })));
        }
      } catch {
        // The empty state remains truthful until the canonical store is available.
      }
    };
    loadCanonicalScoring();
    return () => { disposed = true; };
  }, []);

  // Sincronizar dados do localStorage
  useEffect(() => {
    const refreshData = () => {
      setLeads(normalizeLeadCollection(readLocalArray('sigma_leads')));
      setGroups(readLocalArray('sigma_groups'));
    };
    window.addEventListener('storage', refreshData);
    window.addEventListener('sigma:leads-updated', refreshData);
    window.addEventListener('sigma:groups-updated', refreshData);
    return () => {
      window.removeEventListener('storage', refreshData);
      window.removeEventListener('sigma:leads-updated', refreshData);
      window.removeEventListener('sigma:groups-updated', refreshData);
    };
  }, []);

  // Notificar contagem de leads analisados
  useEffect(() => {
    const scoredCount = Object.keys(analysisMap).length;
    onUpdateScoringCount?.(scoredCount);
  }, [analysisMap, onUpdateScoringCount]);

  // Objeto do grupo ativo
  const currentGroup = useMemo(() => {
    return groups.find((g) => g.id === selectedGroupId) || null;
  }, [groups, selectedGroupId]);

  // Lista de leads do grupo ativo
  const groupLeads = useMemo(() => {
    if (!currentGroup) return [];
    const members = currentGroup.members || currentGroup.leadIds || [];
    if (!members.length) return [];
    const filtered = leads.filter((l, idx) =>
      members.includes(l.id) ||
      members.includes(idx) ||
      members.includes(String(idx)) ||
      members.includes(String(l.id))
    );
    return filtered;
  }, [currentGroup, leads]);

  // Salvar grupo selecionado
  const handleSelectGroup = (id) => {
    setSelectedGroupId(id);
    try {
      if (id) localStorage.setItem('sigma_scgroup', id);
      else localStorage.setItem('sigma_scgroup', '');
    } catch {}
  };

  // Abrir modal de IA
  const handleOpenAiModal = () => {
    setAiDraft({ ...aiConfig });
    setTestStatusMsg('');
    setShowKey(false);
    setIsAiModalOpen(true);
  };

  // Salvar modal de IA
  const handleSaveAiModal = async () => {
    const ai = {
      enabled: Boolean(aiDraft.key || aiDraft.hasApiKey),
      provider: aiDraft.provider,
      apiKey: aiDraft.key || (aiDraft.hasApiKey ? '********' : ''),
      model: aiDraft.model,
      baseUrl: aiDraft.baseUrl,
    };
    if (window.leadScoringAPI?.updateSettings) {
      const response = await window.leadScoringAPI.updateSettings({ ai });
      if (!response?.success) {
        setTestStatusMsg(response?.error || 'Não foi possível salvar a configuração.');
        return;
      }
      const next = toUiAiConfig(response.settings, aiDraft);
      setAiConfig(next);
      setAiDraft(next);
      saveAiConfig(next);
      setIsAiModalOpen(false);
      return;
    }
    const next = { ...aiDraft, key: '' };
    setAiConfig(next);
    saveAiConfig(next);
    setIsAiModalOpen(false);
  };

  // Testa a rota do provedor de verdade; não aceita validação apenas visual.
  const handleTestAi = async () => {
    setTestStatusMsg('Testando conexão…');
    if (!window.leadScoringAPI?.testConnection) {
      setTestStatusMsg('Teste real indisponível nesta versão do aplicativo.');
      return;
    }
    try {
      const response = await window.leadScoringAPI.testConnection({
        provider: aiDraft.provider,
        apiKey: aiDraft.key || (aiDraft.hasApiKey ? '********' : ''),
        model: aiDraft.model,
        baseUrl: aiDraft.baseUrl,
      });
      if (!response?.success) throw new Error(response?.error || 'A conexão foi recusada.');
      setTestStatusMsg(`Conexão confirmada: ${response.provider} · ${response.model}.`);
    } catch (error) {
      setTestStatusMsg(error?.message || 'Não foi possível testar a conexão.');
    }
  };

  const saveServiceAnalysis = (uiLeadId, savedLead) => {
    if (!uiLeadId || !savedLead) return;
    const analysis = analysisFromService(savedLead, aiConfig.preset);
    setAnalysisMap((previous) => ({ ...previous, [uiLeadId]: analysis }));
    return analysis;
  };

  // O processamento é delegado ao serviço persistido; não há timer ou resultado local simulado.
  const handleRunScoring = async () => {
    if (isRunning) {
      if (activeJobRef.current) await window.leadScoringAPI?.cancel?.(activeJobRef.current);
      activeJobRef.current = null;
      setIsRunning(false);
      setProgressText('Cancelamento solicitado. Resultados já salvos foram preservados.');
      return;
    }
    if (!groupLeads.length) return;
    if (!window.leadScoringAPI?.analyzeBatch) {
      setProgressText('Serviço de scoring indisponível. Nenhuma análise foi simulada.');
      return;
    }

    const jobId = `ui_batch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    activeJobRef.current = jobId;
    const total = groupLeads.length;
    const initialStates = Object.fromEntries(groupLeads.map((lead) => [lead.id, 'wait']));
    setRunStates(initialStates);
    setProgressCount({ current: 0, total });
    setProgressText(`Enviando ${total} lead${total === 1 ? '' : 's'} para análise…`);
    setIsRunning(true);

    try {
      const response = await window.leadScoringAPI.analyzeBatch(groupLeads, { jobId });
      if (!response?.success) throw new Error(response?.error || 'A análise em lote falhou.');

      const nextStates = { ...initialStates };
      const nextAnalyses = {};
      for (const row of response.results || []) {
        const savedLead = row?.lead;
        const matchingLead = groupLeads.find((lead) => String(lead.id) === String(savedLead?.id));
        const uiLeadId = matchingLead?.id || savedLead?.id;
        if (row?.success && uiLeadId && savedLead) {
          const analysis = analysisFromService(savedLead, aiConfig.preset);
          nextAnalyses[uiLeadId] = analysis;
          nextStates[uiLeadId] = analysis.noSite ? 'nosite' : 'done';
        } else if (uiLeadId) {
          nextStates[uiLeadId] = 'fail';
        }
      }
      setAnalysisMap((previous) => ({ ...previous, ...nextAnalyses }));
      setRunStates(nextStates);
      const completed = Object.values(nextStates).filter((state) => state === 'done' || state === 'nosite').length;
      setProgressCount({ current: completed, total });
      setProgressText(response.failures ? `Concluída com ${response.failures} falha(s).` : 'Análise concluída.');
      addLog?.(`[SCORING] ${completed}/${total} análises persistidas no serviço.`);
    } catch (error) {
      setRunStates((previous) => Object.fromEntries(groupLeads.map((lead) => [lead.id, previous[lead.id] === 'done' ? 'done' : 'fail'])));
      setProgressText(error?.message || 'Não foi possível concluir a análise.');
      addLog?.(`[SCORING] Falha: ${error?.message || 'erro desconhecido'}`);
    } finally {
      if (activeJobRef.current === jobId) activeJobRef.current = null;
      setIsRunning(false);
    }
  };

  const handleRetrySingle = async (lead) => {
    if (!window.leadScoringAPI?.analyzeLead) return;
    const jobId = `ui_single_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    setRunStates((previous) => ({ ...previous, [lead.id]: 'run' }));
    try {
      const response = await window.leadScoringAPI.analyzeLead(lead, { jobId });
      if (!response?.success || !response.lead) throw new Error(response?.error || 'A reanálise falhou.');
      const analysis = saveServiceAnalysis(lead.id, response.lead);
      setRunStates((previous) => ({ ...previous, [lead.id]: analysis?.noSite ? 'nosite' : 'done' }));
    } catch (error) {
      setRunStates((previous) => ({ ...previous, [lead.id]: 'fail' }));
      setProgressText(error?.message || 'A reanálise falhou.');
    }
  };

  useEffect(() => {
    if (!window.leadScoringAPI?.onProgress) return undefined;
    return window.leadScoringAPI.onProgress((payload) => {
      if (!payload || (activeJobRef.current && payload.jobId !== activeJobRef.current)) return;
      const uiLeadId = payload.leadId || payload.lead?.id;
      if (payload.event === 'started' && uiLeadId) {
        setRunStates((previous) => ({ ...previous, [uiLeadId]: 'run' }));
      } else if (payload.event === 'saved' && payload.lead && uiLeadId) {
        const analysis = analysisFromService(payload.lead, aiConfig.preset);
        setAnalysisMap((previous) => ({ ...previous, [uiLeadId]: analysis }));
        setRunStates((previous) => ({ ...previous, [uiLeadId]: analysis.noSite ? 'nosite' : 'done' }));
      } else if (payload.event === 'failed' && uiLeadId) {
        setRunStates((previous) => ({ ...previous, [uiLeadId]: 'fail' }));
      }
      if (Number.isFinite(payload.index) && Number.isFinite(payload.total)) {
        setProgressCount({ current: payload.index, total: payload.total });
      }
      if (payload.message) setProgressText(payload.message);
    });
  }, [aiConfig.preset]);

  // Alternar seleção de linha
  const toggleRowSelect = (id) => {
    setSelectedRowIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Selecionar todos
  const toggleSelectAll = () => {
    if (selectedRowIds.size === groupLeads.length) {
      setSelectedRowIds(new Set());
    } else {
      setSelectedRowIds(new Set(groupLeads.map((l) => l.id)));
    }
  };

  // Exportar selecionados
  const handleExportSelected = () => {
    const itemsToExport = groupLeads.filter((l) => selectedRowIds.has(l.id));
    window.electronAPI?.exportLeads?.(itemsToExport, 'csv');
  };

  // Toggle accordion section in detail modal
  const toggleAcc = (secTitle) => {
    setOpenAccSections((prev) => ({ ...prev, [secTitle]: !prev[secTitle] }));
  };

  const progressPct = progressCount.total > 0
    ? Math.round((progressCount.current / progressCount.total) * 100)
    : 0;

  const currentPresetName = AUDITS[aiConfig.preset]?.name || aiConfig.preset;
  const currentProviderName = PROVIDERS[aiConfig.provider]?.name || aiConfig.provider;

  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Se nenhum grupo selecionado: Estado Vazio (#scEmpty) */}
      {!currentGroup ? (
        <div id="scEmpty">
          <div className="empty" style={{ padding: '56px 20px' }}>
            <div className="e-icon">◎</div>
            <b style={{ color: 'var(--fg)', fontSize: 15 }}>Selecione um grupo para analisar</b>
            <span style={{ maxWidth: '46ch', textAlign: 'center', lineHeight: 1.5 }}>
              O scoring investiga a presença digital das empresas de um grupo, uma por uma.
            </span>

            <div className="field" style={{ minWidth: 'min(320px, 80vw)', marginTop: 8 }}>
              <select
                id="scGroupPick"
                aria-label="Selecionar grupo"
                value={selectedGroupId}
                onChange={(e) => handleSelectGroup(e.target.value)}
              >
                <option value="">Escolher grupo…</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name} ({g.members ? g.members.length : 0})
                  </option>
                ))}
              </select>
            </div>

            {groups.length === 0 && (
              <div id="scNoGroups" style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center', marginTop: 12 }}>
                <span style={{ fontSize: 13, color: 'var(--muted)' }}>Você ainda não possui grupos de leads.</span>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    window.location.hash = '#base';
                  }}
                >
                  Criar grupo na Base de Leads
                </button>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Quando grupo está selecionado: Área de Trabalho (#scWork) */
        <div id="scWork" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Top 3 Steps */}
          <div className="sc-steps" data-od-id="scoring-steps">
            {/* Step 1: Grupo */}
            <div className="sc-step">
              <div className="lb">1 · Grupo</div>
              <button
                type="button"
                className="sc-pick"
                id="scGroupBtn"
                title="Clique para trocar de grupo"
                onClick={() => handleSelectGroup('')}
              >
                {currentGroup.name}
              </button>
              <span className="result-count" id="scGroupN">
                {groupLeads.length} leads
              </span>
            </div>

            {/* Step 2: IA e Análise */}
            <div className="sc-step">
              <div className="lb">2 · IA e análise</div>
              <div className="sc-cfg" id="scCfgLine">
                IA: {currentProviderName} · {aiConfig.model || 'modelo padrão'} · {currentPresetName}
              </div>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                id="scCfgBtn"
                onClick={handleOpenAiModal}
              >
                Configurar
              </button>
            </div>

            {/* Step 3: Ação */}
            <div className="sc-step">
              <div className="lb">3 · Ação</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  id="scRunBtn"
                  onClick={handleRunScoring}
                >
                  {isRunning ? 'Pausar análise' : 'Analisar grupo'}
                </button>
                <span className="result-count" id="scRunN">
                  {isRunning
                    ? `${progressCount.current}/${progressCount.total}`
                    : `${groupLeads.length} leads serão analisados.`}
                </span>
              </div>
            </div>
          </div>

          {/* Painel de Progresso (#scProgPanel) */}
          {(isRunning || progressCount.current > 0) && (
            <div className="panel" id="scProgPanel" data-od-id="scoring-progress" style={{ padding: 14, background: '#fff', border: '1px solid var(--border)', borderRadius: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <b style={{ fontSize: 13.5 }} id="scProgTxt">{progressText}</b>
                <span style={{ flex: 1 }} />
                <span className="result-count" id="scProgN">
                  {progressCount.current} / {progressCount.total}
                </span>
              </div>

              <div className="progress-track" style={{ marginTop: 8 }}>
                <div
                  className="progress-fill"
                  id="scProgFill"
                  style={{ width: `${progressPct}%` }}
                />
              </div>

              {/* Fila ao vivo */}
              <div
                id="scRunList"
                style={{
                  marginTop: 10,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  maxHeight: 200,
                  overflowY: 'auto'
                }}
              >
                {groupLeads.map((l) => {
                  const st = runStates[l.id] || (analysisMap[l.id] ? (analysisMap[l.id].noSite ? 'nosite' : 'done') : 'wait');
                  const pillConfig = {
                    wait: { label: 'Aguardando', cls: 'st-wait' },
                    run: { label: 'Analisando', cls: 'st-run' },
                    done: { label: 'Concluído', cls: 'st-ok' },
                    fail: { label: 'Falhou', cls: 'st-fail' },
                    nosite: { label: 'Sem site', cls: 'st-nosite' }
                  }[st] || { label: 'Aguardando', cls: 'st-wait' };

                  return (
                    <div key={l.id} className="run-row" id={`run-${l.id}`}>
                      <span className="nm">{l.name || 'Empresa'}</span>
                      <span className={`st-pill ${pillConfig.cls}`}>
                        {pillConfig.label}
                      </span>
                      {st === 'fail' && (
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => handleRetrySingle(l)}
                        >
                          Tentar de novo
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Tabela de Resultados (#scResults) */}
          <div id="scResults" data-od-id="scoring-results">
            {/* Barra de Seleção */}
            {selectedRowIds.size > 0 && (
              <div className="selbar" id="scSelBar" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: 'var(--surface-warm)', border: '1px solid var(--border)', borderRadius: 10, marginBottom: 8 }}>
                <b id="scSelCount">{selectedRowIds.size}</b>
                <span>selecionados</span>
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  id="scSelExp"
                  onClick={handleExportSelected}
                >
                  Exportar CSV
                </button>
              </div>
            )}

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 36 }}>
                      <input
                        type="checkbox"
                        className="rowcheck"
                        id="scChkAll"
                        aria-label="Selecionar todos"
                        checked={selectedRowIds.size > 0 && selectedRowIds.size === groupLeads.length}
                        onChange={toggleSelectAll}
                      />
                    </th>
                    <th>Empresa</th>
                    <th>Score</th>
                    <th>Site</th>
                    <th>Situação</th>
                    <th>Oportunidades</th>
                    <th>Atualizado</th>
                    <th style={{ width: 90 }}></th>
                  </tr>
                </thead>
                <tbody id="scResBody">
                  {groupLeads.map((lead) => {
                    const an = analysisMap[lead.id];
                    const isRowChecked = selectedRowIds.has(lead.id);

                    const score = an ? an.score : null;
                    const band = score != null ? (score >= 80 ? ['high', 'Alta'] : score >= 50 ? ['mid', 'Média'] : ['low', 'Baixa']) : null;

                    const sit = an ? (an.noSite ? ['Sem site', 'st-nosite'] : ['Concluído', 'st-ok']) : ['Não analisado', 'st-wait'];

                    return (
                      <tr key={lead.id} className={isRowChecked ? 'selrow' : ''}>
                        <td>
                          <input
                            type="checkbox"
                            className="rowcheck"
                            checked={isRowChecked}
                            aria-label={`Selecionar ${lead.name}`}
                            onChange={() => toggleRowSelect(lead.id)}
                          />
                        </td>
                        <td>
                          <b
                            style={{ cursor: 'pointer', color: 'var(--teal-deep)' }}
                            onClick={() => setDetailLead(lead)}
                          >
                            {lead.name || 'Empresa'}
                          </b>
                        </td>
                        <td>
                          {an ? (
                            <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                              <b style={{ fontVariantNumeric: 'tabular-nums' }}>{score}</b>
                              <span className={`ftag ${band[0]}`} style={{ marginLeft: 6 }}>
                                {band[1]}
                              </span>
                            </span>
                          ) : (
                            <span style={{ fontSize: 12, color: 'var(--meta)' }}>Não analisado</span>
                          )}
                        </td>
                        <td style={{ fontSize: 12.5 }}>
                          {lead.website ? (
                            <a
                              href={lead.website}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{ color: 'var(--accent)', textDecoration: 'none' }}
                            >
                              {lead.website.replace(/^https?:\/\//, '').replace(/\/.*$/, '')}
                            </a>
                          ) : (
                            'Sem site'
                          )}
                        </td>
                        <td>
                          <span className={`st-pill ${sit[1]}`}>{sit[0]}</span>
                        </td>
                        <td style={{ fontSize: 12.5, maxWidth: 220 }} title={an ? an.opp.join('; ') : ''}>
                          {an && an.opp.length > 0 ? an.opp.slice(0, 2).join(' · ') : '—'}
                        </td>
                        <td style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                          {an ? fmtShort(an.ts) : '—'}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="btn btn-sm"
                            onClick={() => handleRetrySingle(lead)}
                          >
                            Reanalisar
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Configuração de IA (#aiCfgOv) */}
      {isAiModalOpen && (
        <div className="overlay on" id="aiCfgOv" data-od-id="modal-config-ia">
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="aiCfgTitle"
            style={{ width: 'min(520px, 94vw)' }}
          >
            <div className="modal-head">
              <h2 id="aiCfgTitle">Configurar análise</h2>
            </div>

            <div className="modal-body" style={{ gridTemplateColumns: '1fr', gap: 14 }}>
              <div className="exp-sec">Provedor de IA — quem executa</div>
              <div id="aiProv" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {Object.keys(PROVIDERS).map((k) => {
                  const p = PROVIDERS[k];
                  const isSel = aiDraft.provider === k;
                  return (
                    <div
                      key={k}
                      className={`exp-row ${isSel ? 'sel' : ''}`}
                      role="radio"
                      aria-checked={isSel}
                      tabIndex={0}
                      onClick={() => {
                        setAiDraft((prev) => ({
                          ...prev,
                          provider: k,
                          baseUrl: k !== 'custom' && p.base ? p.base : prev.baseUrl
                        }));
                      }}
                    >
                      <b>{p.name}</b>
                      <span>{isSel ? 'em uso' : 'usar'}</span>
                    </div>
                  );
                })}
              </div>

              <div className="field">
                <label htmlFor="aiBase">Base URL</label>
                <input
                  id="aiBase"
                  autoComplete="off"
                  spellCheck="false"
                  readOnly={aiDraft.provider !== 'custom'}
                  placeholder={aiDraft.provider === 'custom' ? 'https://sua-api.com/v1' : ''}
                  value={aiDraft.baseUrl || ''}
                  onChange={(e) => setAiDraft({ ...aiDraft, baseUrl: e.target.value })}
                />
              </div>

              <div className="field">
                <label htmlFor="aiKey">API Key</label>
                <div className="hood-add" style={{ display: 'flex', gap: 8 }}>
                  <input
                    id="aiKey"
                    type={showKey ? 'text' : 'password'}
                    autoComplete="new-password"
                    spellCheck="false"
                    style={{ flex: 1 }}
                    placeholder={aiDraft.hasApiKey ? 'Chave salva — informe outra para substituir' : 'Informe a API key do provedor'}
                    value={aiDraft.key || ''}
                    onChange={(e) => setAiDraft({ ...aiDraft, key: e.target.value, hasApiKey: Boolean(e.target.value) || aiDraft.hasApiKey })}
                  />
                  <button
                    type="button"
                    className="btn btn-sm"
                    id="aiShow"
                    onClick={() => setShowKey((v) => !v)}
                  >
                    {showKey ? 'Ocultar' : 'Mostrar'}
                  </button>
                </div>
              </div>

              <div className="field">
                <label htmlFor="aiModel">Modelo</label>
                <input
                  id="aiModel"
                  list="aiModelsList"
                  autoComplete="off"
                  spellCheck="false"
                  value={aiDraft.model || ''}
                  onChange={(e) => setAiDraft({ ...aiDraft, model: e.target.value })}
                />
                <datalist id="aiModelsList">
                  {(PROVIDERS[aiDraft.provider]?.models || []).map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <button type="button" className="btn btn-sm" id="aiTest" onClick={handleTestAi}>
                  Testar conexão
                </button>
                <span className="result-count" id="aiTestMsg" role="status">
                  {testStatusMsg}
                </span>
              </div>

              <div className="exp-sec">Foco da auditoria — o que procurar</div>
              <div id="auditPresets" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {Object.keys(AUDITS).map((k) => {
                  const audit = AUDITS[k];
                  const isSel = aiDraft.preset === k;
                  return (
                    <div
                      key={k}
                      className={`exp-row ${isSel ? 'sel' : ''}`}
                      role="radio"
                      aria-checked={isSel}
                      tabIndex={0}
                      onClick={() => setAiDraft({ ...aiDraft, preset: k })}
                    >
                      <b>{audit.name}</b>
                      <span>{audit.hint}</span>
                    </div>
                  );
                })}
              </div>

              {aiDraft.preset === 'custom' && (
                <div className="field" id="auditObjWrap">
                  <label htmlFor="auditObj">Objetivo da análise</label>
                  <input
                    id="auditObj"
                    placeholder="Ex.: empresas com presença fraca e boa reputação local"
                    autoComplete="off"
                    value={aiDraft.objective || ''}
                    onChange={(e) => setAiDraft({ ...aiDraft, objective: e.target.value })}
                  />
                </div>
              )}
            </div>

            <div className="modal-foot">
              <button
                type="button"
                className="btn btn-ghost"
                id="aiCancel"
                onClick={() => setIsAiModalOpen(false)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary"
                id="aiSave"
                onClick={handleSaveAiModal}
              >
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Detalhe do Lead (com Score e Auditoria) */}
      {detailLead && (
        <div className="overlay on" onClick={() => setDetailLead(null)}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            style={{ width: 'min(640px, 94vw)', maxHeight: '88vh', overflowY: 'auto' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-head">
              <h2>{detailLead.name || 'Empresa'}</h2>
            </div>

            <div className="modal-body" style={{ gridTemplateColumns: '1fr', gap: 12 }}>
              {analysisMap[detailLead.id] ? (
                <div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 6 }}>
                    <span style={{ fontFamily: 'var(--font-display)', fontSize: 42, fontWeight: 700, lineHeight: 1 }}>
                      {analysisMap[detailLead.id].score}
                    </span>
                    <span className={`ftag ${analysisMap[detailLead.id].score >= 80 ? 'high' : analysisMap[detailLead.id].score >= 50 ? 'mid' : 'low'}`}>
                      {analysisMap[detailLead.id].score >= 80 ? 'Alta' : analysisMap[detailLead.id].score >= 50 ? 'Média' : 'Baixa'}
                    </span>
                  </div>

                  <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
                    {AUDITS[analysisMap[detailLead.id].preset]?.name || analysisMap[detailLead.id].preset} · {fmtShort(analysisMap[detailLead.id].ts)} · {analysisMap[detailLead.id].provider}
                  </div>

                  {/* Accordions */}
                  {[
                    { t: `Pontos positivos (${analysisMap[detailLead.id].pos.length})`, items: analysisMap[detailLead.id].pos },
                    { t: `Problemas encontrados (${analysisMap[detailLead.id].neg.length})`, items: analysisMap[detailLead.id].neg },
                    { t: `Oportunidades (${analysisMap[detailLead.id].opp.length})`, items: analysisMap[detailLead.id].opp },
                    ...(analysisMap[detailLead.id].sections || [])
                  ].map((sec, idx) => {
                    const isOpen = Boolean(openAccSections[sec.t]);
                    return (
                      <div key={idx} className={`acc ${isOpen ? 'open' : ''}`}>
                        <button
                          type="button"
                          className="acc-head"
                          onClick={() => toggleAcc(sec.t)}
                        >
                          <span>{sec.t}</span>
                          <span className="chev">›</span>
                        </button>
                        <div className="acc-body">
                          <ul>
                            {sec.items.map((it, i) => (
                              <li key={i}>{it}</li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="empty">
                  <div className="e-icon">○</div>
                  <b style={{ color: 'var(--fg)' }}>Não analisado</b>
                  <span>Execute a análise do grupo para visualizar o raio-x deste lead.</span>
                </div>
              )}
            </div>

            <div className="modal-foot">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setDetailLead(null)}
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
