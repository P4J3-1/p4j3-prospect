import React, { useEffect, useState } from 'react';
import { PROVIDERS } from '../aiProviders.mjs';

const TONES = [
  { id: 'consultivo', label: 'Consultivo' },
  { id: 'direto', label: 'Direto' },
  { id: 'amigavel', label: 'Amigável' },
];

function fromSettings(settings = {}) {
  const ai = settings.ai || {};
  const commercial = settings.commercial || {};
  const provider = PROVIDERS[ai.provider] ? ai.provider : 'openrouter';
  return {
    provider,
    model: ai.model || PROVIDERS[provider].defaultModel,
    baseUrl: ai.baseUrl || PROVIDERS[provider].base,
    key: '',
    hasApiKey: Boolean(ai.hasApiKey),
    sellerName: commercial.sellerName || '',
    agencyName: commercial.agencyName || '',
    services: (Array.isArray(commercial.services) ? commercial.services : []).join(', '),
    proof: commercial.proof || '',
    tone: commercial.tone || 'consultivo',
    autoAnalyze: settings.analysis?.autoAnalyzeAfterScrape === true,
  };
}

function formatHour(hour) {
  return `${String(hour).padStart(2, '0')}h`;
}

export default function AiSettingsPage() {
  const [draft, setDraft] = useState(null);
  const [showKey, setShowKey] = useState(false);
  const [status, setStatus] = useState({ text: '', ok: false });
  const [busy, setBusy] = useState(false);
  const [insights, setInsights] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await window.leadScoringAPI?.getSettings?.();
        if (alive) setDraft(fromSettings(res?.settings));
      } catch {
        if (alive) setDraft(fromSettings());
      }
      try {
        const res = await window.aiAPI?.getInsights?.();
        if (alive && res?.success) setInsights(res.insights);
      } catch { /* sem campanhas ainda */ }
    })();
    return () => { alive = false; };
  }, []);

  if (!draft) return <section className="settings-open-design-view"><p className="camp-hint">Carregando…</p></section>;

  const set = (patch) => setDraft((current) => ({ ...current, ...patch }));
  const provider = PROVIDERS[draft.provider] || PROVIDERS.openrouter;
  const apiKeyPayload = draft.key || (draft.hasApiKey ? '********' : '');

  const chooseProvider = (id) => {
    const next = PROVIDERS[id];
    // Trocar de provedor exige a chave do novo provedor.
    set({ provider: id, model: next.defaultModel, baseUrl: next.base, key: '', hasApiKey: id === draft.provider ? draft.hasApiKey : false });
    setStatus({ text: '', ok: false });
  };

  const handleTest = async () => {
    setBusy(true);
    setStatus({ text: 'Testando conexão…', ok: false });
    try {
      const res = await window.leadScoringAPI.testConnection({
        provider: draft.provider, apiKey: apiKeyPayload, model: draft.model, baseUrl: draft.baseUrl,
      });
      if (!res?.success) throw new Error(res?.error || 'A conexão foi recusada.');
      setStatus({ text: `Conexão confirmada: ${res.provider} · ${res.model}.`, ok: true });
    } catch (error) {
      setStatus({ text: error?.message || 'Não foi possível testar a conexão.', ok: false });
    } finally {
      setBusy(false);
    }
  };

  const handleSave = async () => {
    setBusy(true);
    try {
      const res = await window.leadScoringAPI.updateSettings({
        ai: {
          enabled: Boolean(draft.key || draft.hasApiKey),
          provider: draft.provider,
          apiKey: apiKeyPayload,
          model: draft.model,
          baseUrl: draft.baseUrl,
        },
        commercial: {
          sellerName: draft.sellerName.trim(),
          agencyName: draft.agencyName.trim(),
          services: draft.services.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 10),
          proof: draft.proof.trim(),
          tone: draft.tone,
        },
        analysis: { autoAnalyzeAfterScrape: draft.autoAnalyze },
      });
      if (!res?.success) throw new Error(res?.error || 'Não foi possível salvar.');
      const next = fromSettings(res.settings);
      setDraft(next);
      // Mantém o Lead Scoring em sincronia (ele lê este espelho sem a chave).
      try {
        const previous = JSON.parse(localStorage.getItem('sigma_ai') || '{}');
        localStorage.setItem('sigma_ai', JSON.stringify({ ...previous, provider: next.provider, baseUrl: next.baseUrl, model: next.model, hasApiKey: next.hasApiKey }));
      } catch { /* espelho opcional */ }
      setStatus({ text: next.hasApiKey ? 'Configuração salva. A IA já está ativa em todo o sistema.' : 'Salvo. Informe a API key para ativar a IA.', ok: next.hasApiKey });
    } catch (error) {
      setStatus({ text: error?.message || 'Não foi possível salvar.', ok: false });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="settings-open-design-view ai-settings-page">
      <div className="page-head">
        <div>
          <h1 style={{ fontSize: 20 }}>Inteligência Artificial</h1>
          <p className="camp-hint" style={{ marginTop: 4 }}>
            A IA pesquisa cada lead, identifica o decisor, sugere a abordagem, estima a chance de fechamento e reescreve suas mensagens com base nos resultados das campanhas.
          </p>
        </div>
      </div>

      <div className="table-wrap settings-open-design-card">
        <div className="field">
          <label>Provedor</label>
          <div className="ai-provider-grid" role="radiogroup" aria-label="Provedor de IA">
            {Object.entries(PROVIDERS).map(([id, p]) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={draft.provider === id}
                className={`btn btn-sm ${draft.provider === id ? 'btn-primary' : ''}`}
                onClick={() => chooseProvider(id)}
              >
                {p.name}
              </button>
            ))}
          </div>
          {draft.provider === 'deepseek' && (
            <span className="camp-hint">Crie a chave em platform.deepseek.com → API Keys. Modelo recomendado: deepseek-flash (rápido); deepseek-v4-pro para análises mais profundas.</span>
          )}
        </div>

        <div className="field">
          <label htmlFor="aiPageKey">API Key</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              id="aiPageKey"
              type={showKey ? 'text' : 'password'}
              autoComplete="new-password"
              spellCheck="false"
              style={{ flex: 1 }}
              placeholder={draft.hasApiKey ? 'Chave salva — cole outra para substituir' : 'Cole a API key do provedor'}
              value={draft.key}
              onChange={(e) => set({ key: e.target.value.trim() })}
            />
            <button type="button" className="btn btn-sm" onClick={() => setShowKey((v) => !v)}>
              {showKey ? 'Ocultar' : 'Mostrar'}
            </button>
          </div>
          <span className="camp-hint">Fica salva só neste computador e nunca aparece de novo na tela.</span>
        </div>

        <div className="field">
          <label htmlFor="aiPageModel">Modelo</label>
          <input
            id="aiPageModel"
            list="aiPageModels"
            spellCheck="false"
            value={draft.model}
            onChange={(e) => set({ model: e.target.value })}
          />
          <datalist id="aiPageModels">
            {provider.models.map((m) => <option key={m} value={m} />)}
          </datalist>
        </div>

        {draft.provider === 'custom' && (
          <div className="field">
            <label htmlFor="aiPageBase">Base URL</label>
            <input
              id="aiPageBase"
              spellCheck="false"
              placeholder="https://sua-api.com/v1"
              value={draft.baseUrl}
              onChange={(e) => set({ baseUrl: e.target.value })}
            />
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="button" className="btn" disabled={busy || !(draft.key || draft.hasApiKey)} onClick={handleTest}>Testar conexão</button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={handleSave}>Salvar</button>
          {status.text && (
            <span className="camp-hint" style={{ color: status.ok ? 'var(--success)' : 'var(--danger, #dc2626)' }} role="status">{status.text}</span>
          )}
        </div>
      </div>

      <div className="table-wrap settings-open-design-card">
        <h2 style={{ fontSize: 15, margin: 0 }}>Seu negócio</h2>
        <p className="camp-hint" style={{ margin: 0 }}>A IA usa estes dados para escolher a abordagem e avaliar se o lead tem perfil para fechar com você.</p>
        <div className="camp-field-row" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
          <div className="field">
            <label htmlFor="aiSeller">Seu nome</label>
            <input id="aiSeller" value={draft.sellerName} onChange={(e) => set({ sellerName: e.target.value })} placeholder="Ex.: João" />
          </div>
          <div className="field">
            <label htmlFor="aiAgency">Sua empresa</label>
            <input id="aiAgency" value={draft.agencyName} onChange={(e) => set({ agencyName: e.target.value })} placeholder="Ex.: P4J3" />
          </div>
        </div>
        <div className="field">
          <label htmlFor="aiServices">O que você vende (separe por vírgula)</label>
          <input id="aiServices" value={draft.services} onChange={(e) => set({ services: e.target.value })} placeholder="Sites, Landing Pages, Tráfego pago, Automação de WhatsApp" />
        </div>
        <div className="field">
          <label htmlFor="aiProof">Prova social / resultado que você já entregou</label>
          <textarea id="aiProof" rows={2} value={draft.proof} onChange={(e) => set({ proof: e.target.value })} placeholder="Ex.: Dobramos os agendamentos de 3 clínicas em 60 dias" />
        </div>
        <div className="field">
          <label htmlFor="aiTone">Tom das mensagens</label>
          <select id="aiTone" value={draft.tone} onChange={(e) => set({ tone: e.target.value })}>
            {TONES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </div>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
          <input type="checkbox" style={{ width: 'auto', margin: 0 }} checked={draft.autoAnalyze} onChange={(e) => set({ autoAnalyze: e.target.checked })} />
          Analisar automaticamente os leads com site ao terminar cada extração
        </label>
        <div>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={handleSave}>Salvar perfil</button>
        </div>
      </div>

      <div className="table-wrap settings-open-design-card">
        <h2 style={{ fontSize: 15, margin: 0 }}>Aprendizado das campanhas</h2>
        <p className="camp-hint" style={{ margin: 0 }}>
          Cada mensagem enviada e cada resposta alimentam a IA: as próximas pesquisas de lead e o botão “Melhorar com IA” das campanhas usam estes dados.
        </p>
        {!insights || !insights.sent ? (
          <p className="camp-hint">Ainda sem envios. Dispare a primeira campanha para a IA começar a aprender.</p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
            <div><b style={{ fontSize: 20 }}>{insights.sent}</b><div className="camp-hint">mensagens enviadas</div></div>
            <div><b style={{ fontSize: 20 }}>{insights.replyRate}%</b><div className="camp-hint">taxa de resposta</div></div>
            <div><b style={{ fontSize: 20 }}>{insights.followUpReplyRate}%</b><div className="camp-hint">responderam após o follow-up</div></div>
            <div><b style={{ fontSize: 20 }}>{insights.optOutRate}%</b><div className="camp-hint">pediram para sair</div></div>
          </div>
        )}
        {insights?.bestHours?.length > 0 && (
          <p className="camp-hint" style={{ margin: 0 }}>
            Melhores horários: {insights.bestHours.map((h) => `${formatHour(h.hour)} (${h.replyRate}%)`).join(' · ')}
          </p>
        )}
        {insights?.bestCategories?.length > 0 && (
          <p className="camp-hint" style={{ margin: 0 }}>
            Nichos que mais respondem: {insights.bestCategories.map((c) => `${c.category} (${c.replyRate}%)`).join(' · ')}
          </p>
        )}
        {insights && insights.sent > 0 && !insights.enoughData && (
          <p className="camp-hint" style={{ margin: 0 }}>Com menos de 20 envios os números ainda oscilam; a IA considera isso nas sugestões.</p>
        )}
      </div>
    </section>
  );
}
