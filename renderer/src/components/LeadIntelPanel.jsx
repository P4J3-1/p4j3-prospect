import React, { useCallback, useEffect, useState } from 'react';
import { X, Search, RefreshCw, Copy, MessageCircle, ExternalLink, UserRound, Building2, Target, Lightbulb } from 'lucide-react';

const CHANCE_COLORS = { alta: 'var(--success, #10a37f)', media: '#d97706', baixa: '#dc2626' };

function Section({ icon: Icon, title, children }) {
  return (
    <div className="intel-section">
      <div className="intel-section-title"><Icon size={14} /> {title}</div>
      {children}
    </div>
  );
}

/**
 * Ficha de pesquisa do lead: busca web + Receita Federal + IA.
 * `onSave(intel)` grava o resultado no lead para reaproveitar em campanhas.
 */
export default function LeadIntelPanel({ lead, onClose, onSave, onOpenWhatsApp }) {
  const [intel, setIntel] = useState(lead?.intel || null);
  const [aiConfigured, setAiConfigured] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const research = useCallback(async () => {
    if (!window.aiAPI?.researchLead) {
      setError('Pesquisa indisponível nesta versão.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await window.aiAPI.researchLead({
        name: lead.name || lead.title || lead.company,
        category: lead.category || lead.cat,
        address: lead.address,
        city: lead.city,
        phone: lead.phone || lead.tel,
        website: lead.website || lead.site,
        instagram: lead.instagram,
        rating: lead.rating,
        totalReviews: lead.totalReviews || lead.reviews,
      });
      if (!res?.success) throw new Error(res?.error || 'Não foi possível pesquisar este lead.');
      setIntel(res.intel);
      setAiConfigured(res.aiConfigured !== false);
      onSave?.(res.intel);
    } catch (err) {
      setError(err?.message || 'Falha na pesquisa.');
    } finally {
      setLoading(false);
    }
  }, [lead, onSave]);

  useEffect(() => {
    if (!lead?.intel) research();
    // Pesquisa só ao abrir; "Pesquisar novamente" refaz sob demanda.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const copy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard indisponível */ }
  };

  const company = intel?.company;
  const chance = intel?.chance;
  const phone = lead.phone || lead.tel;

  return (
    <div className="overlay on intel-overlay" role="dialog" aria-modal="true" aria-labelledby="intelTitle" onClick={onClose}>
      <aside className="intel-panel" onClick={(e) => e.stopPropagation()}>
        <header className="intel-head">
          <div style={{ minWidth: 0 }}>
            <h2 id="intelTitle">{lead.name || lead.title || 'Lead'}</h2>
            <div className="intel-meta">
              {[lead.category, lead.address].filter(Boolean).join(' · ')}
            </div>
            <div className="intel-meta">
              {[phone && `☎ ${phone}`, lead.rating && `★ ${lead.rating}${lead.totalReviews ? ` (${lead.totalReviews})` : ''}`].filter(Boolean).join('   ')}
            </div>
          </div>
          <button type="button" className="icon-btn" aria-label="Fechar" onClick={onClose}><X size={16} /></button>
        </header>

        <div className="intel-body">
          {loading && (
            <div className="intel-loading" role="status">
              <Search size={16} /> Pesquisando na web, na Receita Federal e analisando com IA…
            </div>
          )}
          {error && <div className="camp-alert od-alert">{error}</div>}
          {!aiConfigured && intel && (
            <div className="camp-alert od-alert">
              Resultado sem IA (só busca e regras). Configure a IA em <a href="#ai" onClick={onClose}>Inteligência Artificial</a> para decisor, abordagem e chance de fechamento completos.
            </div>
          )}
          {intel?.aiError && <div className="camp-alert od-alert">IA indisponível agora: {intel.aiError}</div>}

          {intel && (
            <>
              <Section icon={UserRound} title="Com quem falar">
                {intel.decisor ? (
                  <p className="intel-strong">
                    {intel.decisor.nome}
                    <span className="intel-muted"> · {intel.decisor.cargo} · confiança {intel.decisor.confianca}</span>
                  </p>
                ) : (
                  <p className="intel-muted">Nenhum nome confiável encontrado nos dados públicos.</p>
                )}
                {intel.decisor?.fonte && <p className="intel-muted">Fonte: {intel.decisor.fonte}</p>}
                <p>Saudação nas mensagens: <b>“Olá, {intel.saudacao}!”</b> <span className="intel-muted">(variável {'{{saudacao}}'})</span></p>
              </Section>

              {chance && (
                <Section icon={Target} title="Chance de fechar (lead frio)">
                  <div className="intel-chance">
                    <div className="intel-chance-bar"><span style={{ width: `${chance.percentual}%`, background: CHANCE_COLORS[chance.classificacao] || 'var(--accent)' }} /></div>
                    <b style={{ color: CHANCE_COLORS[chance.classificacao] }}>{chance.percentual}% · {chance.classificacao}</b>
                  </div>
                  {chance.justificativa && <p>{chance.justificativa}</p>}
                  {chance.sinais_positivos?.length > 0 && <ul className="intel-list good">{chance.sinais_positivos.map((s) => <li key={s}>{s}</li>)}</ul>}
                  {chance.riscos?.length > 0 && <ul className="intel-list bad">{chance.riscos.map((s) => <li key={s}>{s}</li>)}</ul>}
                </Section>
              )}

              {intel.abordagem?.mensagem && (
                <Section icon={Lightbulb} title="Abordagem sugerida">
                  {intel.abordagem.angulo && <p><b>Ângulo:</b> {intel.abordagem.angulo}</p>}
                  <div className="camp-msg-bubble" style={{ whiteSpace: 'pre-wrap' }}>{intel.abordagem.mensagem}</div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                    <button type="button" className="btn btn-sm" onClick={() => copy(intel.abordagem.mensagem)}>
                      <Copy size={13} /> {copied ? 'Copiado!' : 'Copiar'}
                    </button>
                    {phone && onOpenWhatsApp && (
                      <button type="button" className="btn btn-sm btn-primary" onClick={() => onOpenWhatsApp(intel.abordagem.mensagem)}>
                        <MessageCircle size={13} /> Abrir conversa com esta mensagem
                      </button>
                    )}
                  </div>
                  {intel.proximosPassos?.length > 0 && (
                    <ol className="intel-list">{intel.proximosPassos.map((s) => <li key={s}>{s}</li>)}</ol>
                  )}
                </Section>
              )}

              {company && (
                <Section icon={Building2} title="Empresa (Receita Federal)">
                  <p className="intel-strong">{company.nomeFantasia || company.razaoSocial}</p>
                  <p className="intel-muted">
                    {company.razaoSocial} · CNPJ {company.cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')}
                  </p>
                  <p className="intel-muted">
                    {[company.situacao && `Situação: ${company.situacao}`, company.abertura && `Aberta em ${company.abertura}`, company.porte, company.municipio && `${company.municipio}/${company.uf}`].filter(Boolean).join(' · ')}
                  </p>
                  {company.atividade && <p className="intel-muted">{company.atividade}</p>}
                  {company.socios?.length > 0 && (
                    <ul className="intel-list">{company.socios.map((s) => <li key={s.nome}>{s.nome} <span className="intel-muted">· {s.qualificacao}</span></li>)}</ul>
                  )}
                  <p className="intel-muted">Correspondência com o lead: {Math.round((company.matchScore || 0) * 100)}%</p>
                </Section>
              )}

              {intel.results?.length > 0 && (
                <Section icon={Search} title="Resultados na web">
                  <ul className="intel-results">
                    {intel.results.map((r) => (
                      <li key={r.url}>
                        <button type="button" className="intel-link" onClick={() => window.electronAPI?.openExternal?.(r.url)}>
                          {r.title} <ExternalLink size={11} />
                        </button>
                        <div className="intel-url">{r.url.replace(/^https?:\/\//, '').slice(0, 80)}</div>
                        {r.snippet && <div className="intel-snippet">{r.snippet}</div>}
                      </li>
                    ))}
                  </ul>
                </Section>
              )}
            </>
          )}
        </div>

        <footer className="intel-foot">
          <span className="intel-muted">
            {intel?.researchedAt ? `Pesquisado em ${new Date(intel.researchedAt).toLocaleString('pt-BR')}` : ''}
            {intel?.ai ? ` · IA: ${intel.ai.provider} ${intel.ai.model || ''}` : ''}
          </span>
          <button type="button" className="btn btn-sm" disabled={loading} onClick={research}>
            <RefreshCw size={13} /> Pesquisar novamente
          </button>
        </footer>
      </aside>
    </div>
  );
}
