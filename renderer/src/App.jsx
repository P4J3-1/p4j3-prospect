import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Search,
  Menu,
  Minus,
  Square,
  X
} from 'lucide-react';
import Overview from './components/Overview';
import MapScraperView from './components/MapScraperView';
import LeadsManager from './components/LeadsManager';
import LeadScoring from './components/LeadScoring';
import WhatsAppPanel from './components/WhatsAppPanel';
import NewExtractionModal from './components/NewExtractionModal';
import OnboardingTour from './components/OnboardingTour';
import { NotificationProvider, useNotifications } from './components/NotificationCenter';
import UpdateBanner from './components/UpdateBanner';
import { dedupeLeads, normalizeLeadCollection, readLocalArray } from './leadData';

function organizeStoredLeads() {
  const raw = readLocalArray('sigma_leads');
  const organized = normalizeLeadCollection(raw);
  try {
    if (organized.some((lead, index) => lead?.category !== raw[index]?.category)) {
      localStorage.setItem('sigma_leads', JSON.stringify(organized));
    }
  } catch {}
  return organized;
}

class ErrorBoundaryLite extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error(`[UI ERROR] ${this.props.label || 'view'}:`, error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 30, color: 'var(--fg)', overflow: 'auto' }}>
          <h3 style={{ color: 'var(--danger)', marginTop: 0 }}>
            Erro ao carregar componente ({this.props.label || 'Tela'})
          </h3>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, background: 'var(--surface-warm)', padding: 16, borderRadius: 8 }}>
            {String(this.state.error?.stack || this.state.error)}
          </pre>
          <button type="button" className="btn btn-primary" onClick={() => this.setState({ error: null })}>
            Recarregar Tela
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function CommandPalette({ open, onClose, onNavigate, onNewExtraction }) {
  const [q, setQ] = useState('');
  const inputRef = useRef(null);
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 30);
      setQ('');
    }
  }, [open]);
  useEffect(() => {
    const h = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); onClose?.( !open ); }
      if (e.key === 'Escape' && open) onClose?.(false);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  const items = [
    { id: 'scraper', label: 'Ir para Scraper Maps', desc: 'Mapa + feed de leads', icon: '◎', action: () => { onNavigate('scraper'); onClose(false); } },
    { id: 'overview', label: 'Ir para Visão Geral', desc: 'Centro de comando', icon: '▦', action: () => { onNavigate('overview'); onClose(false); } },
    { id: 'base', label: 'Ir para Base de Leads', desc: 'Filtrar, organizar e exportar', icon: '▤', action: () => { onNavigate('base'); onClose(false); } },
    { id: 'scoring', label: 'Ir para Lead Scoring', desc: 'Quem ligar primeiro', icon: '✦', action: () => { onNavigate('scoring'); onClose(false); } },
    { id: 'whatsapp', label: 'Ir para WhatsApp', desc: 'Chats e campanhas', icon: '◐', action: () => { onNavigate('whatsapp'); onClose(false); } },
    { id: 'dashboard', label: 'Ir para Dashboard', desc: 'Métricas e categorias', icon: '▭', action: () => { onNavigate('dashboard'); onClose(false); } },
    { id: 'new', label: 'Nova Extração…', desc: 'Criar busca no Google Maps', icon: '＋', action: () => { onClose(false); onNewExtraction(); } },
  ];
  const filtered = q.trim() ? items.filter(i => (`${i.label} ${i.desc}`.toLowerCase().includes(q.toLowerCase()))) : items;
  return (
    <div className="overlay on" id="cmdkOv" data-od-id="cmdk" onClick={() => onClose(false)}>
      <div className="cmdk" role="dialog" aria-modal="true" aria-label="Busca global" onClick={e=>e.stopPropagation()}>
        <div className="cmdk-row">
          <span aria-hidden="true">⌕</span>
          <input ref={inputRef} value={q} onChange={e=>setQ(e.target.value)} placeholder="Buscar leads, campanhas, ações…" />
          <span className="tag-lote">ESC</span>
        </div>
        <div className="cmdk-list">
          {filtered.length===0 ? <div className="empty"><b>Nenhum resultado</b><span>Tente outro termo.</span></div> : filtered.map(it=> (
            <button key={it.id} className="cmdk-item" onClick={it.action}>
              <span className="cmdk-ic">{it.icon}</span>
              <span style={{ minWidth:0 }}><b style={{ display:'block', fontSize:13 }}>{it.label}</b><span style={{ display:'block', fontSize:12, color:'var(--muted)' }}>{it.desc}</span></span>
            </button>
          ))}
        </div>
        <div className="cmdk-row" style={{ fontSize:11, color:'var(--muted)', gap:12 }}>
          <span><b>↵</b> selecionar</span><span><b>↑↓</b> navegar</span><span><b>⌘K</b> abrir/fechar</span>
        </div>
      </div>
    </div>
  );
}

function AppInner() {
  const [activeTab, setActiveTab] = useState(() => {
    try { const h = location.hash.slice(1); if(['overview','scraper','base','scoring','whatsapp','dashboard','settings'].includes(h)) return h; } catch{}
    return 'overview';
  });
  const [isNewExtractionOpen, setIsNewExtractionOpen] = useState(false);
  const [isCmdOpen, setIsCmdOpen] = useState(false);
  const [isSidebarLocked, setIsSidebarLocked] = useState(false);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const [waStatus, setWaStatus] = useState('disconnected');
  const [leadsCount, setLeadsCount] = useState(() => dedupeLeads(organizeStoredLeads()).length);
  const [scoringCount, setScoringCount] = useState(0);

  const { addNotification } = useNotifications();
  const mapScraperRef = useRef(null);

  // Persist hash + shortcuts ⌘1-5
  useEffect(()=>{ try{ history.replaceState(null,'','#'+activeTab); }catch{} }, [activeTab]);
  useEffect(()=>{
    const onKey=(e)=>{
      if((e.metaKey||e.ctrlKey) && /^[1-5]$/.test(e.key)){
        e.preventDefault();
        const map=['overview','scraper','base','scoring','whatsapp'];
        const i=Number(e.key)-1; if(map[i]) setActiveTab(map[i]);
      }
      if((e.metaKey||e.ctrlKey) && e.key.toLowerCase()==='k'){ e.preventDefault(); setIsCmdOpen(v=>!v); }
    };
    window.addEventListener('keydown', onKey);
    return()=> window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    document.body.classList.toggle('side-locked', isSidebarLocked);
    document.body.classList.toggle('nav-open', isMobileNavOpen);
    document.body.classList.toggle('route-whatsapp', activeTab === 'whatsapp');
    return () => {
      document.body.classList.remove('side-locked', 'nav-open', 'route-whatsapp');
    };
  }, [isSidebarLocked, isMobileNavOpen, activeTab]);

  const navigate = (tab) => {
    setActiveTab(tab);
    setIsMobileNavOpen(false);
  };

  const handleMinimize = () => window.electronAPI?.winMinimize();
  const handleMaximize = () => window.electronAPI?.winMaximize();
  const handleClose = () => window.electronAPI?.winClose();

  const handleStartExtraction = ({ niche, neigh, city, limit }) => {
    setActiveTab('scraper');
    // Start extraction through electron IPC directly
    const qstr = `${niche} ${neigh} ${city}`;
    const searchId = `scrape_${Date.now()}`;
    addNotification({
      type: 'info',
      category: 'scraper',
      title: 'Iniciando Extração',
      message: `Buscando ${niche} em ${neigh}, ${city}...`
    });

    if (window.electronAPI && typeof window.electronAPI.startScrape === 'function') {
      window.electronAPI.startScrape(qstr, limit, searchId)
        .then((res) => {
          if (res && res.success && res.data) {
            addNotification({
              type: 'success',
              category: 'scraper',
              title: 'Extração Concluída',
              message: `${res.data.length} leads adicionados!`
            });
            // Update local storage
            try {
              const current = JSON.parse(localStorage.getItem('sigma_leads') || '[]');
              const combined = normalizeLeadCollection([
                ...res.data.map(d => ({ ...d, searchId, id: d.id || Math.random().toString(36).slice(2) })),
                ...current,
              ]);
              const currentSearches = readLocalArray('sigma_searches');
              const nextSearches = [
                ...currentSearches.filter((search) => String(search?.id) !== searchId),
                {
                  id: searchId,
                  query: qstr,
                  label: `${niche} · ${neigh}${city ? ` · ${city}` : ''}`,
                  source: 'maps',
                  timestamp: Date.now(),
                },
              ];
              localStorage.setItem('sigma_leads', JSON.stringify(combined));
              localStorage.setItem('sigma_searches', JSON.stringify(nextSearches));
              setLeadsCount(combined.length);
              window.dispatchEvent(new CustomEvent('sigma:leads-updated', {
                detail: { leads: combined, searches: nextSearches },
              }));
            } catch {}
          }
        })
        .catch((err) => {
          addNotification({
            type: 'error',
            category: 'scraper',
            title: 'Erro na Extração',
            message: err.message
          });
        });
    }
  };

  const renderContent = () => {
    switch (activeTab) {
      case 'overview':
        return <Overview onNavigate={navigate} onNewExtraction={() => setIsNewExtractionOpen(true)} waStatus={waStatus} leadsCount={leadsCount} scoringCount={scoringCount} />;
      case 'scraper':
        return (
          <ErrorBoundaryLite label="Scraper">
            <MapScraperView
              onUpdateLeadsCount={setLeadsCount}
              addLog={(msg) => console.log(msg)}
              onOpenNewExtraction={() => setIsNewExtractionOpen(true)}
            />
          </ErrorBoundaryLite>
        );
      case 'scoring':
        return (
          <ErrorBoundaryLite label="Lead Scoring">
            <LeadScoring onUpdateScoringCount={setScoringCount} addLog={(msg) => console.log(msg)} />
          </ErrorBoundaryLite>
        );
      case 'base':
        return (
          <ErrorBoundaryLite label="Base de Leads">
            <LeadsManager onUpdateLeadsCount={setLeadsCount} addLog={(msg) => console.log(msg)} />
          </ErrorBoundaryLite>
        );
      case 'whatsapp':
        return (
          <ErrorBoundaryLite label="WhatsApp">
            <WhatsAppPanel waStatus={waStatus} setWaStatus={setWaStatus} addLog={(msg) => console.log(msg)} />
          </ErrorBoundaryLite>
        );
      case 'campaigns': // compat: alias → whatsapp/campanhas tab
        return (
          <ErrorBoundaryLite label="Campanhas">
            <WhatsAppPanel waStatus={waStatus} setWaStatus={setWaStatus} addLog={(msg) => console.log(msg)} initialTab="campaigns" />
          </ErrorBoundaryLite>
        );
      case 'dashboard':
        return (
          <section className="soon-card">
            <div className="eyebrow">Lote 2 · especificado, não construído</div>
            <h2 style={{ fontSize:20, color:'var(--fg)' }}>Painel de análises</h2>
            <p>Metric-strip + filtros por categoria e período + exportação CSV/XLSX com progresso e toast.</p>
            <button type="button" className="btn" onClick={() => navigate('overview')}>Voltar à Visão Geral</button>
          </section>
        );
      case 'settings':
        return (
          <section className="settings-open-design-view">
            <div className="page-head">
              <div><h1 style={{ fontSize: 20 }}>Configurações</h1></div>
            </div>
            <div className="table-wrap settings-open-design-card">
              <div className="field">
                <label htmlFor="themeSel">Modo de interface</label>
                <select id="themeSel" defaultValue="light">
                  <option value="light">Claro (padrão travado)</option>
                  <option value="dark">Escuro (override futuro)</option>
                </select>
              </div>
              <div>
                <button className="btn btn-primary" onClick={() => addNotification({ type: 'info', title: 'Preferências salvas', message: 'Modo de interface atualizado.' })}>
                  Salvar preferências
                </button>
              </div>
              <p>Contagem local por instalação. Nenhum dado pessoal sai do app sem endpoint configurado.</p>
            </div>
          </section>
        );
      default:
        return (
          <MapScraperView
            onUpdateLeadsCount={setLeadsCount}
            addLog={(msg) => console.log(msg)}
            onOpenNewExtraction={() => setIsNewExtractionOpen(true)}
          />
        );
    }
  };

  return (
    <div className="app-layout-root">
      {/* Left Sidebar */}
      <aside className="app-sidebar">
        {/* Brand Header */}
        <button
          type="button"
          className="sidebar-brand"
          onClick={() => setIsSidebarLocked((value) => !value)}
          aria-pressed={isSidebarLocked}
          title="Fixar ou soltar o menu"
        >
          <div className="brand-icon-box">
            Σ
          </div>
          <div className="brand-text-col">
            <span className="brand-name">Sigma GMaps</span>
            <span className="brand-tag">COMMUNITY</span>
          </div>
        </button>

        {/* Primary CTA Button */}
        <div className="sidebar-action-wrap">
          <button
            className="btn-new-extraction"
            onClick={() => setIsNewExtractionOpen(true)}
          >
            <span className="sidebar-plus" aria-hidden="true">+</span>
            <span>Nova Extração</span>
          </button>
        </div>

        {/* Navigation Menu */}
        <nav className="sidebar-nav">
          <div className="sidebar-nav-label">Produto</div>
          <button
            className={`nav-item ${activeTab === 'overview' ? 'active' : ''}`}
            onClick={() => navigate('overview')}
          >
            <span className="ico" aria-hidden="true">▦</span>
            <span className="nav-label-text">Visão Geral</span><span className="nav-kbd">1</span>
          </button>

          <button
            className={`nav-item ${activeTab === 'scraper' ? 'active' : ''}`}
            onClick={() => navigate('scraper')}
          >
            <span className="ico" aria-hidden="true">◎</span>
            <span className="nav-label-text">Scraper Maps</span><span className="nav-kbd">2</span>
          </button>

          <button
            className={`nav-item ${activeTab === 'base' ? 'active' : ''}`}
            onClick={() => navigate('base')}
          >
            <span className="ico" aria-hidden="true">▤</span>
            <span className="nav-label-text">Base de Leads</span><span className="nav-kbd">3</span>
          </button>

          <button
            className={`nav-item ${activeTab === 'scoring' ? 'active' : ''}`}
            onClick={() => navigate('scoring')}
          >
            <span className="ico" aria-hidden="true">✦</span>
            <span className="nav-label-text">Lead Scoring</span><span className="nav-kbd">4</span>
          </button>

          <button
            className={`nav-item ${activeTab === 'whatsapp' ? 'active' : ''}`}
            onClick={() => navigate('whatsapp')}
          >
            <span className="ico" aria-hidden="true">◐</span>
            <span className="nav-label-text">WhatsApp</span>
          </button>

          <button
            className={`nav-item ${activeTab === 'dashboard' ? 'active' : ''}`}
            onClick={() => navigate('dashboard')}
          >
            <span className="ico" aria-hidden="true">▭</span>
            <span className="nav-label-text">Dashboard</span><span className="nav-lote">Lote 2</span>
          </button>
        </nav>

        {/* Sidebar Footer */}
        <div className="sidebar-footer">
          <button className={`nav-item ${activeTab === 'settings' ? 'active' : ''}`} onClick={() => navigate('settings')}>
            <span className="ico" aria-hidden="true">⚙</span>
            <span className="nav-label-text">Configurações</span>
          </button>
          <div className="sidebar-release">Lote 1 · Teal · Light</div>
        </div>
      </aside>
      <button type="button" className="app-nav-scrim" aria-label="Fechar navegação" onClick={() => setIsMobileNavOpen(false)} />

      {/* Main Container (Header + Main Screen Area) */}
      <div className="app-main-viewport">
        {/* Top Header Bar — 48px, light, blur */}
        <header className="app-header-bar" onDoubleClick={handleMaximize}>
          <button type="button" className="mobile-menu-btn" onClick={() => setIsMobileNavOpen(true)} aria-label="Abrir navegação"><Menu size={18} /></button>
          <button type="button" className="header-search-wrap" onClick={() => setIsCmdOpen(true)} title="Abrir busca global (⌘K)">
            <Search size={14} className="header-search-icon" />
            <span>Buscar leads, campanhas, ações…</span>
          </button>

          {/* Right Header Actions */}
          <div className="header-right-actions">
            <button type="button" className="wa-status-pill" onClick={() => navigate('whatsapp')}>
              <span className={`wa-status-dot ${waStatus === 'connected' ? 'online' : ''}`} />
              <span>{waStatus === 'connected' ? '1 WhatsApp online' : 'WhatsApp desconectado'}</span>
            </button>

            {/* Window Controls (Frameless Drag/Close) */}
            <div className="window-control-buttons">
              <button onClick={handleMinimize} title="Minimizar" className="win-btn"><Minus size={13} /></button>
              <button onClick={handleMaximize} title="Maximizar" className="win-btn"><Square size={11} /></button>
              <button onClick={handleClose} title="Fechar" className="win-btn win-close"><X size={13} /></button>
            </div>
          </div>
        </header>

        {/* Screen Content — view-transition */}
        <main className="app-screen-container">
          <UpdateBanner />
          <div key={activeTab} className="view-transition" style={{ flex:1, display:'flex', flexDirection:'column' }}>
            {renderContent()}
          </div>
        </main>
        <CommandPalette open={isCmdOpen} onClose={setIsCmdOpen} onNavigate={setActiveTab} onNewExtraction={() => setIsNewExtractionOpen(true)} />
        <OnboardingTour onNavigate={setActiveTab} />
      </div>

      {/* New Extraction Modal */}
      <NewExtractionModal
        isOpen={isNewExtractionOpen}
        onClose={() => setIsNewExtractionOpen(false)}
        onStartExtraction={handleStartExtraction}
        onAddToQueue={({ niche, neigh, city }) => {
          addNotification({
            type: 'info',
            category: 'scraper',
            title: 'Adicionado à Fila',
            message: `${niche} em ${neigh}, ${city}`
          });
        }}
        isProcessing={false}
      />
    </div>
  );
}

export default function App() {
  return (
    <NotificationProvider>
      <AppInner />
    </NotificationProvider>
  );
}
