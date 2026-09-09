import React, { useEffect, useMemo, useState } from 'react';
import {
  Globe,
  Instagram,
  Mail,
  MessageCircle,
  Percent,
  Phone,
  Send,
  Users,
} from 'lucide-react';
import {
  dedupeLeads,
  getExtractionSearches,
  getLeadStats,
  getSearchLeadCount,
  normalizeLeadCategory,
  normalizeLeadCollection,
  readLocalArray,
} from '../leadData';

const METRICS = [
  { id: 'leads', Icon: Users, label: 'Leads', title: 'Quantidade de leads', color: '#10a37f' },
  { id: 'sent', Icon: Send, label: 'Enviadas', title: 'Mensagens enviadas', color: '#2563eb' },
  { id: 'replies', Icon: MessageCircle, label: 'Respostas', title: 'Respostas recebidas', color: '#f59e0b' },
  { id: 'rate', Icon: Percent, label: 'Taxa de resposta', title: 'Taxa de resposta', color: '#db2777' },
];

const BarsIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <line x1="4" y1="7" x2="20" y2="7" /><line x1="4" y1="12" x2="15" y2="12" /><line x1="4" y1="17" x2="20" y2="17" />
  </svg>
);

const ColumnsIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <line x1="6" y1="20" x2="6" y2="13" /><line x1="12" y1="20" x2="12" y2="6" /><line x1="18" y1="20" x2="18" y2="10" />
  </svg>
);

const ListIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <line x1="9" y1="6" x2="20" y2="6" /><line x1="9" y1="12" x2="20" y2="12" /><line x1="9" y1="18" x2="20" y2="18" />
    <circle cx="5" cy="6" r="1" fill="currentColor" stroke="none" /><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="5" cy="18" r="1" fill="currentColor" stroke="none" />
  </svg>
);

const TableIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <rect x="4" y="4" width="16" height="16" rx="2" /><line x1="4" y1="10" x2="20" y2="10" /><line x1="10" y1="10" x2="10" y2="20" />
  </svg>
);

function metricDefinition(id) {
  return METRICS.find((item) => item.id === id) || METRICS[0];
}

function metricValue(category, id) {
  if (id === 'rate') return category.sent ? (category.replies / category.sent) * 100 : 0;
  return Number(category[id] || 0);
}

function formatMetric(id, value) {
  return id === 'rate' ? `${Math.round(value)}%` : Number(value || 0).toLocaleString('pt-BR');
}

function aggregateCategories(rows, name = 'Outros') {
  const aggregate = rows.reduce((acc, row) => ({
    leads: acc.leads + row.leads,
    sent: acc.sent + row.sent,
    replies: acc.replies + row.replies,
  }), { leads: 0, sent: 0, replies: 0 });
  return { name, ...aggregate, isOther: true, members: rows };
}

function getCampaignsFromResponse(response) {
  if (Array.isArray(response)) return response;
  return Array.isArray(response?.campaigns) ? response.campaigns : [];
}

function getCampaignCategoryMetrics(campaigns) {
  const byCategory = new Map();
  campaigns.forEach((campaign) => {
    (Array.isArray(campaign?.leads) ? campaign.leads : []).forEach((lead) => {
      const category = normalizeLeadCategory(lead?.category || lead?.company?.category);
      const current = byCategory.get(category) || { sent: 0, replies: 0 };
      const status = String(lead?.status || '').toLowerCase();
      const sent = Boolean(lead?.sentAt || lead?.messageId || ['sent', 'delivered', 'read', 'replied'].includes(status));
      const replied = Boolean(lead?.repliedAt || lead?.replyCount > 0 || status === 'replied');
      if (sent) current.sent += 1;
      if (replied) current.replies += 1;
      byCategory.set(category, current);
    });
  });
  return byCategory;
}

function Overview({ onNewExtraction, leadsCount = 0 }) {
  const [categoryView, setCategoryView] = useState(() => localStorage.getItem('sigma_overview_category_view') || 'bars');
  const [searchView, setSearchView] = useState(() => localStorage.getItem('sigma_overview_search_view') || 'bars');
  const [selectedMetrics, setSelectedMetrics] = useState(['leads']);
  const [expandedOther, setExpandedOther] = useState(false);
  const [selectedCategories, setSelectedCategories] = useState([]);
  const [campaigns, setCampaigns] = useState([]);

  useEffect(() => {
    let mounted = true;
    window.campaignAPI?.getAll?.()
      .then((response) => {
        if (mounted) setCampaigns(getCampaignsFromResponse(response));
      })
      .catch(() => {
        if (mounted) setCampaigns([]);
      });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    try { localStorage.setItem('sigma_overview_category_view', categoryView); } catch {}
  }, [categoryView]);

  useEffect(() => {
    try { localStorage.setItem('sigma_overview_search_view', searchView); } catch {}
  }, [searchView]);

  const data = useMemo(() => {
    const leads = dedupeLeads(normalizeLeadCollection(readLocalArray('sigma_leads')));
    const searches = getExtractionSearches(readLocalArray('sigma_searches'));
    const stats = getLeadStats(leads);
    const campaignMetrics = getCampaignCategoryMetrics(campaigns);
    const categoryMap = new Map();

    leads.forEach((lead) => {
      const name = normalizeLeadCategory(lead.category);
      categoryMap.set(name, (categoryMap.get(name) || 0) + 1);
    });

    const categories = [...categoryMap.entries()]
      .map(([name, count]) => ({
        name,
        leads: count,
        sent: campaignMetrics.get(name)?.sent || 0,
        replies: campaignMetrics.get(name)?.replies || 0,
      }))
      .sort((a, b) => b.leads - a.leads || a.name.localeCompare(b.name, 'pt-BR'));

    const recent = searches.slice(0, 7).map((search) => ({
      ...search,
      label: String(search.label || search.query || 'Extração sem nome').trim(),
      count: getSearchLeadCount(leads, search.id),
    }));

    return {
      total: stats.total || Number(leadsCount || 0),
      phone: stats.phoneCount,
      web: stats.webCount,
      instagram: stats.igCount,
      email: stats.emailCount,
      categories,
      recent,
    };
  }, [campaigns, leadsCount]);

  const displayedCategories = useMemo(() => {
    if (data.categories.length <= 5) return data.categories;
    const top = data.categories.slice(0, 4);
    const rest = data.categories.slice(4);
    const other = aggregateCategories(rest);
    return expandedOther
      ? [...top, other, ...rest.map((item) => ({ ...item, isOtherMember: true }))]
      : [...top, other];
  }, [data.categories, expandedOther]);

  const metricMax = useMemo(() => Object.fromEntries(selectedMetrics.map((id) => [
    id,
    Math.max(...displayedCategories.map((category) => metricValue(category, id)), 1),
  ])), [displayedCategories, selectedMetrics]);

  const maxSearch = Math.max(...data.recent.map((item) => item.count), 1);

  const toggleMetric = (id) => {
    setSelectedMetrics((current) => {
      if (current.includes(id)) return current.length === 1 ? current : current.filter((metricId) => metricId !== id);
      return current.length >= 2 ? [current[1], id] : [...current, id];
    });
  };

  const toggleCategory = (category) => {
    if (category.isOther) {
      setExpandedOther((value) => !value);
      return;
    }
    setSelectedCategories((current) => (
      current.includes(category.name)
        ? current.filter((name) => name !== category.name)
        : [...current, category.name]
    ));
  };

  const categoryClassName = (category) => [
    category.isOtherMember ? 'is-other-member' : '',
    selectedCategories.length && !selectedCategories.includes(category.name) && !category.isOther ? 'is-dimmed' : '',
  ].filter(Boolean).join(' ');

  const renderCategoryValues = (category) => (
    <span className="overview-values">
      {selectedMetrics.map((id) => {
        const metric = metricDefinition(id);
        return (
          <span key={id} title={`${metric.label}: ${formatMetric(id, metricValue(category, id))}`}>
            <i style={{ background: metric.color }} />
            {formatMetric(id, metricValue(category, id))}
          </span>
        );
      })}
    </span>
  );

  const renderCategoryBody = () => {
    if (!displayedCategories.length) {
      return (
        <div className="overview-empty">
          <b>Nenhum lead na base</b>
          <span>Faça uma extração para ver as categorias reais aqui.</span>
        </div>
      );
    }

    if (categoryView === 'columns') {
      return (
        <div className="overview-columns">
          {displayedCategories.map((category) => (
            <button
              type="button"
              className={categoryClassName(category)}
              key={`${category.name}-${category.isOtherMember ? 'member' : 'main'}`}
              onClick={() => toggleCategory(category)}
              aria-pressed={!category.isOther && selectedCategories.includes(category.name)}
              title={category.isOther ? `${expandedOther ? 'Recolher' : 'Ver'} categorias agrupadas` : category.name}
            >
              {renderCategoryValues(category)}
              <span className="overview-column-bars">
                {selectedMetrics.map((id) => (
                  <i
                    key={id}
                    style={{
                      height: `${Math.max(6, (metricValue(category, id) / metricMax[id]) * 112)}px`,
                      background: metricDefinition(id).color,
                    }}
                  />
                ))}
              </span>
              <span title={category.name}>{category.isOther ? `Outros ${expandedOther ? '−' : '+'}` : category.name}</span>
            </button>
          ))}
        </div>
      );
    }

    return (
      <div className={`overview-bar-list ${categoryView === 'list' ? 'is-list' : ''} ${selectedMetrics.length === 2 ? 'is-comparing' : ''}`}>
        {displayedCategories.map((category, index) => (
          <button
            type="button"
            className={categoryClassName(category)}
            key={`${category.name}-${category.isOtherMember ? 'member' : 'main'}`}
            onClick={() => toggleCategory(category)}
            aria-pressed={!category.isOther && selectedCategories.includes(category.name)}
          >
            {categoryView === 'list' && <em>{category.isOtherMember ? '↳' : `#${index + 1}`}</em>}
            <span title={category.name}>{category.isOther ? `Outros ${expandedOther ? '−' : '+'}` : category.name}</span>
            {categoryView === 'bars' && (
              <span className="overview-compare-bars">
                {selectedMetrics.map((id) => (
                  <i key={id} title={`${metricDefinition(id).label}: ${formatMetric(id, metricValue(category, id))}`}>
                    <i style={{ width: `${(metricValue(category, id) / metricMax[id]) * 100}%`, background: metricDefinition(id).color }} />
                  </i>
                ))}
              </span>
            )}
            {renderCategoryValues(category)}
          </button>
        ))}
      </div>
    );
  };

  return (
    <div className="overview-view">
      <section className="overview-hero hero-op" aria-label="Resumo da base" data-od-id="dashboard-total">
        <div className="overview-hero-main hero-main">
          <div className="overview-kicker lb">Total de leads na base</div>
          <div className="big">{Number(data.total || 0).toLocaleString('pt-BR')}</div>
        </div>
        <div className="hero-cta">
          <button type="button" className="btn btn-primary overview-new-button" onClick={onNewExtraction}>+ Nova Extração</button>
        </div>
        <div className="overview-coverage hero-contacts" data-od-id="coverage">
          <span className="hc" title="Com telefone" aria-label={`${data.phone} com telefone`}><Phone /><b>{data.phone}</b></span>
          <span className="hc" title="Com site" aria-label={`${data.web} com site`}><Globe /><b>{data.web}</b></span>
          <span className="hc" title="Com Instagram" aria-label={`${data.instagram} com Instagram`}><Instagram /><b>{data.instagram}</b></span>
          <span className="hc" title="Com e-mail" aria-label={`${data.email} com e-mail`}><Mail /><b>{data.email}</b></span>
        </div>
      </section>

      <div className="overview-grid dash-grid">
        <section className="overview-panel panel" data-od-id="dashboard-categories">
          <div className="overview-panel-head panel-head">
            <h3>Leads por categoria</h3>
            <div className="overview-segment seg" aria-label="Visualização de categorias">
              <button type="button" aria-pressed={categoryView === 'bars'} onClick={() => setCategoryView('bars')} title="Barras"><BarsIcon /></button>
              <button type="button" aria-pressed={categoryView === 'columns'} onClick={() => setCategoryView('columns')} title="Colunas"><ColumnsIcon /></button>
              <button type="button" aria-pressed={categoryView === 'list'} onClick={() => setCategoryView('list')} title="Lista"><ListIcon /></button>
            </div>
          </div>
          <div className="overview-metrics mxrow" aria-label="Selecione até duas métricas para comparar">
            {METRICS.map(({ id, Icon, title }) => (
              <button
                key={id}
                type="button"
                className={`mx ${selectedMetrics.indexOf(id) === 1 ? 'is-secondary' : ''}`}
                aria-pressed={selectedMetrics.includes(id)}
                onClick={() => toggleMetric(id)}
                title={`${title} — selecione até 2`}
              >
                <Icon size={15} />
              </button>
            ))}
            <span className="overview-metric-legend">
              {selectedMetrics.map((id) => {
                const metric = metricDefinition(id);
                return <span key={id}><i style={{ background: metric.color }} />{metric.label}</span>;
              })}
            </span>
          </div>

          <div className="scrollbox">{renderCategoryBody()}</div>
        </section>

        <section className="overview-panel panel" data-od-id="dashboard-recent">
          <div className="overview-panel-head panel-head">
            <h3>Últimas extrações</h3>
            <div className="overview-segment seg" aria-label="Visualização de extrações">
              <button type="button" aria-pressed={searchView === 'bars'} onClick={() => setSearchView('bars')} title="Barras"><BarsIcon /></button>
              <button type="button" aria-pressed={searchView === 'table'} onClick={() => setSearchView('table')} title="Tabela"><TableIcon /></button>
            </div>
          </div>
          {data.recent.length ? (
            <div className={`overview-search-list ${searchView === 'table' ? 'is-table' : ''}`}>
              {data.recent.map((item) => (
                <div key={item.id}>
                  <span title={item.label}>{item.label}</span>
                  {searchView === 'bars' && <i><i style={{ width: `${Math.max(2, (item.count / maxSearch) * 100)}%` }} /></i>}
                  <b>{item.count} <small>leads</small></b>
                </div>
              ))}
            </div>
          ) : (
            <div className="overview-empty">
              <b>Nenhuma extração ainda</b>
              <span>Importações de planilha não aparecem neste histórico.</span>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export default Overview;
