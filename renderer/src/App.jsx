import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  LayoutGrid,
  Search,
  Sparkles,
  MessageSquare,
  Settings,
  Plus,
  Compass,
  TableProperties,
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
import UsagePanel from './components/UsagePanel';
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
    <div className="cmdk-overlay" onClick={() => onClose(false)} style={{ position:'fixed', inset:0, background:'rgba(15,23,42,.32)', display:'grid', placeItems:'start center', paddingTop:'14vh', zIndex:9999 }}>
      <div onClick={e=>e.stopPropagation()} style={{ width:'min(560px,92vw)', background:'var(--surface)', border:'1px solid var(--border)', borderRadius:12, boxShadow:'0 20px 40px rgba(15,23,42,.18)', overflow:'hidden' }}>
        <div style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 12px', borderBottom:'1px solid var(--border)' }}>
          <Search size={14} style={{ color:'var(--muted)' }}/>
          <input ref={inputRef} value={q} onChange={e=>setQ(e.target.value)} placeholder="Buscar leads, campanhas, ações… (digite para filtrar)" style={{ flex:1, border:'none', outline:'none', fontSize:13, background:'transparent', color:'var(--fg)' }}/>
          <span style={{ fontSize:10, padding:'3px 6px', borderRadius:4, border:'1px solid var(--border)', color:'var(--muted)', background:'var(--surface-2)' }}>ESC</span>
        </div>
        <div style={{ maxHeight:320, overflow:'auto', padding:6 }}>
          {filtered.length===0 ? <div style={{ padding:'18px 12px', textAlign:'center', color:'var(--muted)', fontSize:12 }}>Nenhum resultado para “{q}”.</div> : filtered.map(it=> (
            <button key={it.id} onClick={it.action} style={{ width:'100%', display:'flex', alignItems:'center', gap:10, padding:'9px 10px', borderRadius:8, border:'none', background:'transparent', textAlign:'left', cursor:'pointer' }} onMouseEnter={e=> e.currentTarget.style.background='var(--hover-bg)'} onMouseLeave={e=> e.currentTarget.style.background='transparent'}>
              <span style={{ width:26, height:26, borderRadius:6, background:'var(--accent-soft)', color:'var(--accent)', display:'grid', placeItems:'center', fontSize:12, flexShrink:0 }}>{it.icon}</span>
              <span style={{ minWidth:0 }}><span style={{ display:'block', fontSize:12.5, fontWeight:600, color:'var(--fg)' }}>{it.label}</span><span style={{ display:'block', fontSize:11, color:'var(--muted)' }}>{it.desc}</span></span><span style={{ marginLeft:'auto', fontSize:11, color:'var(--muted)' }}>↵</span>
            </button>
          ))}
        </div>
        <div style={{ padding:'7px 10px', borderTop:'1px solid var(--border)', display:'flex', gap:10, fontSize:10.5, color:'var(--muted)', background:'var(--surface-2)' }}>
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
          <section className="prototype-soon-card">
            <span>Lote 2 · especificado, não construído</span>
            <h2>Painel de análises</h2>
            <p>Metric-strip, filtros por categoria e período e exportação CSV/XLSX com progresso e confirmação visual.</p>
            <button type="button" className="btn" onClick={() => navigate('overview')}>Voltar à Visão Geral</button>
          </section>
        );
      case 'settings':
        return (
          <div style={{ padding: '24px', maxWidth: '820px', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <h2 style={{ fontSize: '20px', fontWeight: 700, marginBottom: '4px' }}>Configurações do Sigma GMaps</h2>
              <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>Preferências, uso anônimo e atualizações.</p>
            </div>
            <div className="wa-card" style={{ padding: '16px', background: '#FFF', borderRadius: '12px', border: '1px solid var(--border)' }}>
              <h4 style={{ margin: '0 0 8px' }}>Modo de Interface</h4>
              <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: '0 0 12px' }}>Tema claro (SaaS Clean) com suporte a dark mode.</p>
              <button className="btn btn-secondary" onClick={() => addNotification({ type: 'info', title: 'Configurações Salvas', message: 'Preferências atualizadas com sucesso.' })}>
                Salvar Preferências
              </button>
            </div>
            <div className="wa-card" style={{ padding: '16px', background: '#FFF', borderRadius: '12px', border: '1px solid var(--border)' }}>
              <h4 style={{ margin: '0 0 8px' }}>Uso do App (anônimo)</h4>
              <p style={{ fontSize: 11, color: 'var(--muted)', margin: '0 0 10px' }}>Contagem local por instalação — sem PII. Ative envio se tiver um endpoint.</p>
              <UsagePanel />
            </div>
          </div>
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
            <Plus size={16} strokeWidth={2.5} />
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
            <LayoutGrid size={18} />
            <span className="nav-label-text">Visão Geral</span><span className="nav-kbd">1</span>
          </button>

          <button
            className={`nav-item ${activeTab === 'scraper' ? 'active' : ''}`}
            onClick={() => navigate('scraper')}
          >
            <Compass size={18} />
            <span className="nav-label-text">Scraper Maps</span><span className="nav-kbd">2</span>
          </button>

          <button
            className={`nav-item ${activeTab === 'base' ? 'active' : ''}`}
            onClick={() => navigate('base')}
          >
            <TableProperties size={18} />
            <span className="nav-label-text">Base de Leads</span><span className="nav-kbd">3</span>
          </button>

          <button
            className={`nav-item ${activeTab === 'scoring' ? 'active' : ''}`}
            onClick={() => navigate('scoring')}
          >
            <Sparkles size={18} />
            <span className="nav-label-text">Lead Scoring</span><span className="nav-kbd">4</span>
          </button>

          <button
            className={`nav-item ${activeTab === 'whatsapp' ? 'active' : ''}`}
            onClick={() => navigate('whatsapp')}
          >
            <MessageSquare size={18} />
            <span className="nav-label-text">WhatsApp</span>
          </button>

          <button
            className={`nav-item ${activeTab === 'dashboard' ? 'active' : ''}`}
            onClick={() => navigate('dashboard')}
          >
            <LayoutGrid size={18} />
            <span className="nav-label-text">Dashboard</span><span className="nav-lote">Lote 2</span>
          </button>
        </nav>

        {/* Sidebar Footer */}
        <div className="sidebar-footer">
          <button className={`nav-item ${activeTab === 'settings' ? 'active' : ''}`} onClick={() => navigate('settings')}>
            <Settings size={18} />
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
