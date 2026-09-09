import React, { useState, useEffect, useMemo } from 'react';
import * as XLSX from 'xlsx';
import {
  Phone,
  Globe,
  Instagram,
  Mail,
  Search,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Layers,
  Download,
  Filter,
  Columns,
  X,
  Check,
  Tag
} from 'lucide-react';
import { dedupeLeads, normalizeLeadCategory, normalizeLeadCollection, readLocalArray } from '../leadData';

const DEFAULT_COLS = [
  { id: 'nome', label: 'Empresa' },
  { id: 'cat', label: 'Nicho' },
  { id: 'tel', label: 'Telefone' },
  { id: 'wa', label: 'WhatsApp' },
  { id: 'ig', label: 'Instagram' },
  { id: 'site', label: 'Site' },
  { id: 'mail', label: 'E-mail' },
  { id: 'av', label: 'Avaliação' },
  { id: 'uf', label: 'Estado' },
  { id: 'city', label: 'Cidade' },
  { id: 'hood', label: 'Bairro' },
  { id: 'orig', label: 'Origem' },
  { id: 'status', label: 'Status' },
  { id: 'grupos', label: 'Grupos' }
];

function norm(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function fmtDur(ms) {
  if (ms == null) return '—';
  const m = Math.round(ms / 6e4);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}min`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

function fmtDate(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} · ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function LeadsManager({ onUpdateLeadsCount, addLog }) {
  // Load data from localStorage
  const [leads, setLeads] = useState(() => {
    const raw = readLocalArray('sigma_leads');
    if (raw.length > 0) return normalizeLeadCollection(raw);
    return [
      { id: 'lead-1', name: 'Odonto Lume', category: 'Odontologia', neighborhood: 'Copacabana', city: 'Rio de Janeiro', state: 'RJ', rating: '4,8', reviews: 126, phone: '+55 21 98765-0142', website: 'odonto-lume.com.br', email: 'contato@odonto-lume.com.br', searchQuery: 'dentistas · Copacabana' },
      { id: 'lead-2', name: 'Café Aurora', category: 'Cafeteria', neighborhood: 'Ipanema', city: 'Rio de Janeiro', state: 'RJ', rating: '4,6', reviews: 89, instagram: '@cafe.aurora', website: 'cafeaurora.com', searchQuery: 'cafés · Ipanema' },
      { id: 'lead-3', name: 'Almeida Advocacia', category: 'Advocacia', neighborhood: 'Centro', city: 'Rio de Janeiro', state: 'RJ', rating: '4,9', reviews: 211, email: 'contato@almeidaadv.com.br', searchQuery: 'advogados · Centro' },
      { id: 'lead-4', name: 'Studio Prisma', category: 'Design', neighborhood: 'Botafogo', city: 'Rio de Janeiro', state: 'RJ', rating: '4,7', reviews: 64, phone: '+55 21 97654-8890', website: 'studioprisma.design', searchQuery: 'designers · Botafogo' },
    ];
  });

  const [groups, setGroups] = useState(() => {
    try {
      const g = JSON.parse(localStorage.getItem('sigma_groups') || 'null');
      if (Array.isArray(g) && g.length > 0) return g;
    } catch {}
    return [
      { id: 'g1', name: 'Com WhatsApp', members: ['lead-1', 'lead-4'], created: new Date(2026, 8, 1, 9, 0).getTime() },
      { id: 'g-demo', name: 'Teste Scoring — RJ', members: ['lead-1', 'lead-2', 'lead-3'], created: new Date(2026, 8, 2, 10, 0).getTime() }
    ];
  });

  const [hist, setHist] = useState(() => {
    try {
      const h = JSON.parse(localStorage.getItem('sigma_history') || 'null');
      if (h && typeof h === 'object') return h;
    } catch {}
    return {
      'lead-1': [
        { k: 'sent', ts: new Date(2026, 8, 3, 14, 32).getTime(), text: 'Olá, tudo bem? Vi que o site da Odonto Lume está sem HTTPS — consigo resolver isso e ativar o botão de WhatsApp em 1 dia. Posso te mostrar?', wa: 'Sigma · +55 21 90000-0001', camp: 'Lançamento Setembro' },
        { k: 'reply', ts: new Date(2026, 8, 3, 15, 4).getTime(), text: 'Olá! Pode me explicar melhor?' }
      ],
      'lead-2': [
        { k: 'sent', ts: new Date(2026, 8, 2, 10, 15).getTime(), text: 'Oi! Aqui é da Sigma — percebi que o site do Café Aurora não tem botão de WhatsApp. Coloco isso no ar hoje. Quer ver?', wa: 'Sigma · +55 21 90000-0001', camp: 'Cafés Zona Sul' }
      ]
    };
  });

  const [analysis, setAnalysis] = useState(() => {
    try {
      const a = JSON.parse(localStorage.getItem('sigma_analysis') || 'null');
      if (a && typeof a === 'object') return a;
    } catch {}
    return {
      'lead-1': {
        score: 92,
        band: 'alta',
        pos: ['Tem WhatsApp (+12)', 'Site ativo (+15)', 'Avaliação 4,8 (+15)', '126 avaliações (+12)', 'Já respondeu mensagem (+18)', 'Layout adaptável (+5)'],
        neg: ['Site sem HTTPS — sinal negativo para buscadores'],
        opp: ['Ativar HTTPS', 'Otimizar performance'],
        ts: new Date(2026, 8, 2, 16, 20).getTime(),
        provider: 'openrouter',
        model: 'anthropic/claude-3.5-sonnet',
        preset: 'sites',
        sections: [
          { t: 'SEO', items: ['Site sem HTTPS — sinal negativo para buscadores'] },
          { t: 'Performance', items: ['Carregamento dentro do esperado'] },
          { t: 'Conversão', items: ['Botão de WhatsApp presente', 'Telefone visível para contato'] }
        ]
      }
    };
  });

  // State for visible columns
  const [visCols, setVisCols] = useState(['nome', 'tel', 'ig', 'av', 'status', 'city', 'hood']);
  const [showColPop, setShowColPop] = useState(false);

  // Filters
  const [bq, setBq] = useState('');
  const [bCat, setBCat] = useState('');
  const [bUf, setBUf] = useState('');
  const [bCity, setBCity] = useState('');
  const [bHood, setBHood] = useState('');
  const [bGrupo, setBGrupo] = useState('');
  const [bRate, setBRate] = useState(0);
  const [bChans, setBChans] = useState([]);
  const [showFilters, setShowFilters] = useState(false);

  // Period
  const [bPeriod, setBPeriod] = useState('all');
  const [bD0, setBD0] = useState('');
  const [bD1, setBD1] = useState('');

  // Chart
  const [bDim, setBDim] = useState('cat');
  const [bMet, setBMet] = useState('leads');
  const [bMode, setBMode] = useState('bars');

  // Table pagination and sorting
  const [bSort, setBSort] = useState({ key: 'nome', dir: 1 });
  const [bPage, setBPage] = useState(1);
  const PAGE_SIZE = 8;

  // Selected leads
  const [sel, setSel] = useState(new Set());

  // Modals
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [expFmt, setExpFmt] = useState('xlsx');
  const [expScope, setExpScope] = useState('filtered');
  const [expColsScope, setExpColsScope] = useState('vis');

  const [isCreateGroupOpen, setIsCreateGroupOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');

  const [isAddGroupOpen, setIsAddGroupOpen] = useState(false);
  const [groupSearch, setGroupSearch] = useState('');

  const [activeLead, setActiveLead] = useState(null);
  const [leadModalTab, setLeadModalTab] = useState('dados');

  // Persist state
  useEffect(() => {
    localStorage.setItem('sigma_leads', JSON.stringify(leads));
    onUpdateLeadsCount?.(dedupeLeads(leads).length);
  }, [leads, onUpdateLeadsCount]);

  useEffect(() => {
    localStorage.setItem('sigma_groups', JSON.stringify(groups));
  }, [groups]);

  useEffect(() => {
    localStorage.setItem('sigma_history', JSON.stringify(hist));
  }, [hist]);

  // Normalized accessors
  const getLeadId = (l, idx) => l.id || `lead-${idx}`;
  const getLeadName = (l) => l.name || l.n || 'Sem nome';
  const getLeadCat = (l) => normalizeLeadCategory(l.category || l.cat || 'Geral');
  const getLeadTel = (l) => l.phone || l.tel || '';
  const getLeadSite = (l) => l.website || l.site || '';
  const getLeadIg = (l) => l.instagram || l.ig || '';
  const getLeadMail = (l) => l.email || l.mail || '';
  const getLeadCity = (l) => l.city || '';
  const getLeadUf = (l) => l.state || l.uf || '';
  const getLeadHood = (l) => l.neighborhood || l.hood || '';
  const getLeadRating = (l) => l.rating || l.rn || '—';
  const getLeadReviews = (l) => l.reviews || 0;
  const getLeadOrig = (l) => l.searchQuery || l.orig || '—';

  const leadHasChan = (l, ch) => {
    if (ch === 'tel' || ch === 'wa') return Boolean(getLeadTel(l));
    if (ch === 'ig') return Boolean(getLeadIg(l));
    if (ch === 'site') return Boolean(getLeadSite(l));
    if (ch === 'mail') return Boolean(getLeadMail(l));
    return false;
  };

  const leadStatus = (leadId) => {
    const h = hist[leadId] || [];
    if (h.some((e) => e.k === 'reply')) return 'resp';
    if (h.some((e) => e.k === 'sent')) return 'env';
    return 'novo';
  };

  // Period filtering
  const periodRange = useMemo(() => {
    if (bPeriod === 'all') return null;
    if (bPeriod === 'custom') {
      if (!bD0 || !bD1) return null;
      return [new Date(`${bD0}T00:00`).getTime(), new Date(`${bD1}T23:59`).getTime()];
    }
    return [Date.now() - Number(bPeriod) * 864e5, Date.now()];
  }, [bPeriod, bD0, bD1]);

  const evInPeriod = (e) => {
    if (!periodRange) return true;
    return e.ts >= periodRange[0] && e.ts <= periodRange[1];
  };

  // Filtered rows
  const filteredLeads = useMemo(() => {
    const q = norm(bq).trim();
    return leads.filter((l, idx) => {
      const id = getLeadId(l, idx);
      const name = getLeadName(l);
      const cat = getLeadCat(l);
      const city = getLeadCity(l);
      const uf = getLeadUf(l);
      const hood = getLeadHood(l);
      const tel = getLeadTel(l);
      const ig = getLeadIg(l);
      const rn = parseFloat(String(getLeadRating(l)).replace(',', '.')) || 0;

      if (bCat && cat !== bCat) return false;
      if (bUf && uf !== bUf) return false;
      if (bCity && city !== bCity) return false;
      if (bHood && hood !== bHood) return false;
      if (bRate > 0 && rn < bRate) return false;
      if (bGrupo) {
        const grp = groups.find((g) => g.id === bGrupo);
        if (!grp || !grp.members.includes(id)) return false;
      }
      for (const ch of bChans) {
        if (!leadHasChan(l, ch)) return false;
      }
      if (q) {
        const fullText = norm(`${name} ${cat} ${city} ${uf} ${hood} ${tel} ${ig}`);
        if (!fullText.includes(q)) return false;
      }
      return true;
    });
  }, [leads, bq, bCat, bUf, bCity, bHood, bRate, bGrupo, bChans, groups]);

  // Stats calculation
  const stats = useMemo(() => {
    let sent = 0;
    let replies = 0;
    const responseTimes = [];

    filteredLeads.forEach((l, idx) => {
      const id = getLeadId(l, idx);
      const h = (hist[id] || []).filter(evInPeriod);
      h.forEach((e) => {
        if (e.k === 'sent') sent += 1;
        if (e.k === 'reply') replies += 1;
      });
      const s = h.find((e) => e.k === 'sent');
      const r = h.find((e) => e.k === 'reply' && s && e.ts > s.ts);
      if (s && r) responseTimes.push(r.ts - s.ts);
    });

    const avgTime = responseTimes.length > 0 ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length : null;
    const taxa = sent > 0 ? replies / sent : null;

    return {
      sent,
      replies,
      taxa,
      avgTime,
      withTel: filteredLeads.filter((l) => leadHasChan(l, 'tel')).length,
      withWa: filteredLeads.filter((l) => leadHasChan(l, 'wa')).length,
      withIg: filteredLeads.filter((l) => leadHasChan(l, 'ig')).length,
      withSite: filteredLeads.filter((l) => leadHasChan(l, 'site')).length,
      withMail: filteredLeads.filter((l) => leadHasChan(l, 'mail')).length,
      categoriesCount: new Set(filteredLeads.map(getLeadCat)).size,
      groupsCount: groups.length
    };
  }, [filteredLeads, hist, groups, periodRange]);

  // Base Analysis Chart Data
  const chartGroups = useMemo(() => {
    if (bDim === 'chan') {
      const channels = [
        { label: 'Telefone', key: 'tel' },
        { label: 'WhatsApp', key: 'wa' },
        { label: 'Instagram', key: 'ig' },
        { label: 'Site', key: 'site' },
        { label: 'E-mail', key: 'mail' },
      ];
      return channels.map(({ label, key }) => {
        const items = filteredLeads.filter((l) => leadHasChan(l, key));
        return { label, items };
      });
    }

    if (bDim === 'grupo') {
      return groups.map((g) => {
        const items = filteredLeads.filter((l, idx) => g.members.includes(getLeadId(l, idx)));
        return { label: g.name, items };
      });
    }

    const map = new Map();
    filteredLeads.forEach((l) => {
      let val = '—';
      if (bDim === 'cat') val = getLeadCat(l);
      else if (bDim === 'city') val = getLeadCity(l) || '—';
      else if (bDim === 'hood') val = getLeadHood(l) || '—';
      else if (bDim === 'uf') val = getLeadUf(l) || '—';

      if (!map.has(val)) map.set(val, []);
      map.get(val).push(l);
    });

    return [...map.entries()].map(([label, items]) => ({ label, items }));
  }, [filteredLeads, bDim, groups]);

  const getMetricValue = (items, met) => {
    if (met === 'leads') return items.length;
    let s = 0;
    let r = 0;
    items.forEach((l, idx) => {
      const id = getLeadId(l, idx);
      const h = (hist[id] || []).filter(evInPeriod);
      h.forEach((e) => {
        if (e.k === 'sent') s += 1;
        if (e.k === 'reply') r += 1;
      });
    });
    if (met === 'sent') return s;
    if (met === 'replies') return r;
    return s > 0 ? r / s : 0;
  };

  const formatMetricValue = (met, v) => {
    if (met === 'taxa') return v == null || Number.isNaN(v) ? '—' : `${Math.round(v * 100)}%`;
    return v;
  };

  // Unique options for filter selects
  const uniqueCategories = useMemo(() => [...new Set(leads.map(getLeadCat))].sort(), [leads]);
  const uniqueUfs = useMemo(() => [...new Set(leads.map(getLeadUf).filter(Boolean))].sort(), [leads]);
  const uniqueCities = useMemo(() => [...new Set(leads.map(getLeadCity).filter(Boolean))].sort(), [leads]);
  const uniqueHoods = useMemo(() => [...new Set(leads.map(getLeadHood).filter(Boolean))].sort(), [leads]);

  // Active filters count
  const activeFiltersCount = useMemo(() => {
    let n = 0;
    if (bq) n += 1;
    if (bCat) n += 1;
    if (bUf) n += 1;
    if (bCity) n += 1;
    if (bHood) n += 1;
    if (bGrupo) n += 1;
    if (bRate > 0) n += 1;
    n += bChans.length;
    return n;
  }, [bq, bCat, bUf, bCity, bHood, bGrupo, bRate, bChans]);

  // Sorted rows
  const sortedRows = useMemo(() => {
    const list = [...filteredLeads];
    list.sort((a, b) => {
      let x = '';
      let y = '';
      if (bSort.key === 'nome') {
        x = getLeadName(a);
        y = getLeadName(b);
      } else if (bSort.key === 'cat') {
        x = getLeadCat(a);
        y = getLeadCat(b);
      } else if (bSort.key === 'city') {
        x = getLeadCity(a);
        y = getLeadCity(b);
      } else if (bSort.key === 'av') {
        x = parseFloat(String(getLeadRating(a)).replace(',', '.')) || 0;
        y = parseFloat(String(getLeadRating(b)).replace(',', '.')) || 0;
      } else if (bSort.key === 'status') {
        const sx = leadStatus(getLeadId(a, 0));
        const sy = leadStatus(getLeadId(b, 0));
        x = sx === 'resp' ? 2 : sx === 'env' ? 1 : 0;
        y = sy === 'resp' ? 2 : sy === 'env' ? 1 : 0;
      }
      if (typeof x === 'number' && typeof y === 'number') {
        return (x - y) * bSort.dir;
      }
      return String(x).localeCompare(String(y), 'pt-BR') * bSort.dir;
    });
    return list;
  }, [filteredLeads, bSort]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(sortedRows.length / PAGE_SIZE));
  const paginatedRows = useMemo(() => {
    const start = (bPage - 1) * PAGE_SIZE;
    return sortedRows.slice(start, start + PAGE_SIZE);
  }, [sortedRows, bPage]);

  const handleSort = (key) => {
    if (bSort.key === key) {
      setBSort({ key, dir: bSort.dir * -1 });
    } else {
      setBSort({ key, dir: 1 });
    }
  };

  const toggleSelectAll = (checked) => {
    if (checked) {
      const next = new Set();
      filteredLeads.forEach((l, idx) => next.add(getLeadId(l, idx)));
      setSel(next);
    } else {
      setSel(new Set());
    }
  };

  const toggleSelectLead = (id, checked) => {
    const next = new Set(sel);
    if (checked) next.add(id);
    else next.delete(id);
    setSel(next);
  };

  const handleChannelToggle = (ch) => {
    if (bChans.includes(ch)) {
      setBChans(bChans.filter((c) => c !== ch));
    } else {
      setBChans([...bChans, ch]);
    }
  };

  const handleClearFilters = () => {
    setBq('');
    setBCat('');
    setBUf('');
    setBCity('');
    setBHood('');
    setBGrupo('');
    setBRate(0);
    setBChans([]);
  };

  // Group membership helpers
  const leadGroups = (leadId) => groups.filter((g) => g.members.includes(leadId));

  const removeLeadFromGroup = (leadId, groupId) => {
    setGroups((prev) => prev.map((g) => (g.id === groupId ? { ...g, members: g.members.filter((m) => m !== leadId) } : g)));
  };

  const addLeadToGroup = (leadId, groupId) => {
    setGroups((prev) => prev.map((g) => (g.id === groupId && !g.members.includes(leadId) ? { ...g, members: [...g.members, leadId] } : g)));
  };

  // Create group from selection
  const handleCreateGroup = () => {
    const name = newGroupName.trim() || 'Novo grupo';
    const newGroup = {
      id: `g${Date.now()}`,
      name,
      members: [...sel],
      created: Date.now()
    };
    setGroups((prev) => [...prev, newGroup]);
    setIsCreateGroupOpen(false);
    setNewGroupName('');
  };

  // Add selection to existing group
  const handleAddToGroup = (groupId) => {
    setGroups((prev) => prev.map((g) => {
      if (g.id !== groupId) return g;
      const combined = new Set([...g.members, ...sel]);
      return { ...g, members: [...combined] };
    }));
    setIsAddGroupOpen(false);
  };

  // Export Leads
  const handleExport = () => {
    let rowsToExport = [];
    if (expScope === 'all') rowsToExport = leads;
    else if (expScope === 'selected') rowsToExport = leads.filter((l, idx) => sel.has(getLeadId(l, idx)));
    else rowsToExport = filteredLeads;

    const colsToExport = expColsScope === 'all' ? DEFAULT_COLS : DEFAULT_COLS.filter((c) => visCols.includes(c.id));

    const data = rowsToExport.map((l, idx) => {
      const id = getLeadId(l, idx);
      const row = {};
      colsToExport.forEach((c) => {
        if (c.id === 'nome') row[c.label] = getLeadName(l);
        else if (c.id === 'cat') row[c.label] = getLeadCat(l);
        else if (c.id === 'tel') row[c.label] = getLeadTel(l) || '—';
        else if (c.id === 'wa') row[c.label] = getLeadTel(l) || '—';
        else if (c.id === 'ig') row[c.label] = getLeadIg(l) || '—';
        else if (c.id === 'site') row[c.label] = getLeadSite(l) || '—';
        else if (c.id === 'mail') row[c.label] = getLeadMail(l) || '—';
        else if (c.id === 'av') row[c.label] = `${getLeadRating(l)} (${getLeadReviews(l)})`;
        else if (c.id === 'uf') row[c.label] = getLeadUf(l) || '—';
        else if (c.id === 'city') row[c.label] = getLeadCity(l) || '—';
        else if (c.id === 'hood') row[c.label] = getLeadHood(l) || '—';
        else if (c.id === 'orig') row[c.label] = getLeadOrig(l);
        else if (c.id === 'status') {
          const st = leadStatus(id);
          row[c.label] = st === 'resp' ? 'Respondeu' : st === 'env' ? 'Mensagem enviada' : 'Ainda não contatado';
        } else if (c.id === 'grupos') {
          row[c.label] = leadGroups(id).map((g) => g.name).join('; ') || '—';
        }
      });
      return row;
    });

    const stamp = () => {
      const d = new Date();
      const p = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
    };

    if (expFmt === 'json') {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `sigma-leads-${stamp()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } else if (expFmt === 'csv') {
      const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
      const csv = [colsToExport.map((c) => q(c.label)).join(';')].concat(data.map((o) => colsToExport.map((c) => q(o[c.label])).join(';'))).join('\r\n');
      const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `sigma-leads-${stamp()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } else {
      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Leads');
      XLSX.writeFile(wb, `sigma-leads-${stamp()}.xlsx`);
    }

    setIsExportOpen(false);
  };

  const maxMetricVal = useMemo(() => {
    let max = 1;
    chartGroups.forEach(({ items }) => {
      const v = getMetricValue(items, bMet);
      if (v > max) max = v;
    });
    return max;
  }, [chartGroups, bMet]);

  return (
    <div className="base-leads-view" style={{ display: 'flex', flexDirection: 'column', gap: '20px', width: '100%' }}>
      {/* HERO SECTION — LABORATÓRIO COMERCIAL */}
      <section className="hero-op commerce" data-od-id="base-hero">
        <div className="hero-main">
          <div className="lb">Leads na base</div>
          <div className="big" id="bTotal">{filteredLeads.length}</div>
          <div className="bhero-sub" id="bCtx">
            {filteredLeads.length < leads.length ? `de ${leads.length} na base` : 'leads na base'}
          </div>
        </div>

        <div className="kpis" data-od-id="base-kpis">
          <div className="kpi">
            <div className="lb">Disparadas</div>
            <div className="v" id="bSent">{stats.sent}</div>
          </div>
          <div className="kpi">
            <div className="lb">Taxa resposta</div>
            <div className="v" id="bTaxa">{stats.taxa == null ? '—' : `${Math.round(stats.taxa * 100)}%`}</div>
          </div>
          <div className="kpi">
            <div className="lb">Tempo médio</div>
            <div className="v" id="bTempo">{fmtDur(stats.avgTime)}</div>
          </div>
        </div>

        <div className="hero-contacts" data-od-id="base-channels">
          <span className="hc" title="Com telefone">
            <Phone size={17} /><b>{stats.withTel}</b>
          </span>
          <span className="hc" title="Com WhatsApp">
            <span style={{ color: '#25D366', fontWeight: 'bold' }}>WA</span><b>{stats.withWa}</b>
          </span>
          <span className="hc" title="Com Instagram">
            <Instagram size={17} /><b>{stats.withIg}</b>
          </span>
          <span className="hc" title="Com site">
            <Globe size={17} /><b>{stats.withSite}</b>
          </span>
          <span className="hc" title="Com e-mail">
            <Mail size={17} /><b>{stats.withMail}</b>
          </span>
          <span className="hc" title="Categorias na base">
            <Tag size={17} /><b>{stats.categoriesCount}</b>
          </span>
          <span className="hc" title="Grupos de leads">
            <Layers size={17} /><b>{stats.groupsCount}</b>
          </span>
          <span className="bperiod" style={{ marginLeft: 'auto', display: 'flex', gap: '6px', alignItems: 'center' }}>
            <select
              value={bPeriod}
              onChange={(e) => setBPeriod(e.target.value)}
              aria-label="Período"
              style={{ background: '#161c19', color: '#e8ece9', border: '1px solid #2a332e', borderRadius: '10px', minHeight: '40px', padding: '0 10px', fontSize: '12.5px' }}
            >
              <option value="all">Todo o período</option>
              <option value="7">Últimos 7 dias</option>
              <option value="15">Últimos 15 dias</option>
              <option value="30">Últimos 30 dias</option>
              <option value="custom">Personalizado</option>
            </select>
            {bPeriod === 'custom' && (
              <span style={{ display: 'inline-flex', gap: '6px' }}>
                <input
                  type="date"
                  value={bD0}
                  onChange={(e) => setBD0(e.target.value)}
                  style={{ background: '#161c19', color: '#e8ece9', border: '1px solid #2a332e', borderRadius: '10px', minHeight: '40px', padding: '0 8px', fontSize: '12px', colorScheme: 'dark' }}
                />
                <input
                  type="date"
                  value={bD1}
                  onChange={(e) => setBD1(e.target.value)}
                  style={{ background: '#161c19', color: '#e8ece9', border: '1px solid #2a332e', borderRadius: '10px', minHeight: '40px', padding: '0 8px', fontSize: '12px', colorScheme: 'dark' }}
                />
              </span>
            )}
          </span>
        </div>
      </section>

      {/* ANÁLISE DA BASE PANEL */}
      <div className="panel" data-od-id="base-chart">
        <div className="panel-head">
          <h3>Análise da base</h3>
          <div className="seg" role="group" aria-label="Modo de visualização" style={{ marginLeft: 'auto' }}>
            <button
              type="button"
              aria-pressed={bMode === 'bars'}
              onClick={() => setBMode('bars')}
              title="Barras"
            >
              ☰
            </button>
            <button
              type="button"
              aria-pressed={bMode === 'cols'}
              onClick={() => setBMode('cols')}
              title="Colunas"
            >
              ▮▮
            </button>
            <button
              type="button"
              aria-pressed={bMode === 'list'}
              onClick={() => setBMode('list')}
              title="Lista"
            >
              ⋮
            </button>
          </div>
        </div>

        <div className="mxrow" role="group" aria-label="Dimensão" style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: '6px 0 12px' }}>
          <div className="field" style={{ minWidth: '160px' }}>
            <select
              value={bDim}
              onChange={(e) => setBDim(e.target.value)}
              aria-label="Dimensão da análise"
              style={{ minHeight: '38px', borderRadius: '8px' }}
            >
              <option value="cat">Por categoria</option>
              <option value="city">Por cidade</option>
              <option value="hood">Por bairro</option>
              <option value="uf">Por estado</option>
              <option value="chan">Canais de contato</option>
              <option value="grupo">Por grupo</option>
            </select>
          </div>

          <div className="field" style={{ minWidth: '160px' }}>
            <select
              value={bMet}
              onChange={(e) => setBMet(e.target.value)}
              aria-label="Métrica do gráfico"
              style={{ minHeight: '38px', borderRadius: '8px' }}
            >
              <option value="leads">Leads</option>
              <option value="sent">Enviadas</option>
              <option value="replies">Respostas</option>
              <option value="taxa">Taxa resposta</option>
            </select>
          </div>

          <span className="cat-legend on" style={{ marginLeft: 'auto', fontSize: '12px', color: 'var(--muted)' }}>
            <span>{filteredLeads.length} leads no recorte</span>
          </span>
        </div>

        <div className="scrollbox" style={{ maxHeight: '264px', overflowY: 'auto' }}>
          {chartGroups.length === 0 ? (
            <div className="empty">
              <b>Nada por aqui</b>
              <span>Ajuste os filtros para explorar a base.</span>
            </div>
          ) : bMode === 'cols' ? (
            <div className="cols" style={{ display: 'flex', alignItems: 'flex-end', gap: '12px', height: '196px', padding: '12px 4px 0' }}>
              {chartGroups.map(({ label, items }) => {
                const val = getMetricValue(items, bMet);
                const height = Math.max(6, Math.round((val / maxMetricVal) * 120));
                return (
                  <div key={label} className="col" style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
                    <span className="cv" style={{ fontSize: '11px', fontFamily: 'var(--font-mono)' }}>{formatMetricValue(bMet, val)}</span>
                    <span className="cb" style={{ height: `${height}px`, width: '100%', maxWidth: '56px', borderRadius: '8px 8px 4px 4px', background: 'var(--accent)' }} />
                    <span className="cn" style={{ fontSize: '11px', color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }} title={label}>
                      {label}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : bMode === 'list' ? (
            <div className="lrows">
              {chartGroups.map(({ label, items }) => {
                const val = getMetricValue(items, bMet);
                return (
                  <div key={label} className="lr" style={{ display: 'flex', alignItems: 'center', padding: '9px 2px', borderBottom: '1px solid var(--border)', fontSize: '13px' }}>
                    <span>{label}</span>
                    <b style={{ marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' }}>{formatMetricValue(bMet, val)}</b>
                  </div>
                );
              })}
            </div>
          ) : (
            <div>
              {chartGroups.map(({ label, items }) => {
                const val = getMetricValue(items, bMet);
                const pct = Math.round((val / maxMetricVal) * 100);
                return (
                  <div key={label} className="bar-row">
                    <span title={label}>{label}</span>
                    <div className="bar-track">
                      <div className="bar-fill" style={{ width: `${pct}%`, background: 'var(--accent)' }} />
                    </div>
                    <b>{formatMetricValue(bMet, val)}</b>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* TOOLBAR */}
      <div className="bbar" data-od-id="base-toolbar">
        <div className="bsearch">
          <Search size={15} style={{ color: 'var(--meta)' }} />
          <input
            id="baseSearch"
            placeholder="Buscar empresa, telefone, Instagram, cidade…"
            value={bq}
            onChange={(e) => setBq(e.target.value)}
            autoComplete="off"
          />
        </div>

        <button
          type="button"
          className="btn"
          onClick={() => setShowFilters(!showFilters)}
          aria-expanded={showFilters}
        >
          <Filter size={14} /> Filtros {activeFiltersCount > 0 && <span>· {activeFiltersCount}</span>}
        </button>

        <div style={{ position: 'relative' }}>
          <button
            type="button"
            className="btn"
            onClick={() => setShowColPop(!showColPop)}
            aria-expanded={showColPop}
          >
            <Columns size={14} /> Colunas
          </button>
          {showColPop && (
            <div className="col-pop" style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 60, background: '#fff', border: '1px solid var(--border)', borderRadius: '12px', padding: '8px', minWidth: '200px', boxShadow: 'var(--elev-raised)' }}>
              {DEFAULT_COLS.map((c) => (
                <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', padding: '6px 8px', cursor: 'pointer', borderRadius: '6px' }}>
                  <input
                    type="checkbox"
                    className="rowcheck"
                    checked={visCols.includes(c.id)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setVisCols([...visCols, c.id]);
                      } else {
                        if (visCols.length <= 1) return;
                        setVisCols(visCols.filter((x) => x !== c.id));
                      }
                    }}
                  />
                  <span>{c.label}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        <button
          type="button"
          className="btn btn-primary"
          onClick={() => setIsExportOpen(true)}
        >
          <Download size={14} /> Exportar
        </button>
      </div>

      {/* COLLAPSIBLE FILTERS PANEL */}
      {showFilters && (
        <div className="bfilters">
          <div className="field">
            <label>Categoria</label>
            <select value={bCat} onChange={(e) => setBCat(e.target.value)}>
              <option value="">Todas</option>
              {uniqueCategories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>Estado</label>
            <select value={bUf} onChange={(e) => setBUf(e.target.value)}>
              <option value="">Todos</option>
              {uniqueUfs.map((uf) => (
                <option key={uf} value={uf}>{uf}</option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>Cidade</label>
            <select value={bCity} onChange={(e) => setBCity(e.target.value)}>
              <option value="">Todas</option>
              {uniqueCities.map((city) => (
                <option key={city} value={city}>{city}</option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>Bairro</label>
            <select value={bHood} onChange={(e) => setBHood(e.target.value)}>
              <option value="">Todos</option>
              {uniqueHoods.map((hood) => (
                <option key={hood} value={hood}>{hood}</option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>Grupo</label>
            <select value={bGrupo} onChange={(e) => setBGrupo(e.target.value)}>
              <option value="">Todos</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>{g.name} ({g.members.length})</option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>Avaliação mínima</label>
            <select value={bRate} onChange={(e) => setBRate(Number(e.target.value))}>
              <option value={0}>Qualquer</option>
              <option value={4}>4,0+</option>
              <option value={4.5}>4,5+</option>
              <option value={4.8}>4,8+</option>
            </select>
          </div>

          <div className="field" style={{ gridColumn: 'span 2' }}>
            <label>Canais de contato</label>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {[
                { ch: 'tel', label: 'Tel' },
                { ch: 'wa', label: 'WA' },
                { ch: 'ig', label: 'IG' },
                { ch: 'site', label: 'Site' },
                { ch: 'mail', label: 'E-mail' },
              ].map(({ ch, label }) => (
                <button
                  key={ch}
                  type="button"
                  className={`tgl ${bChans.includes(ch) ? 'on' : ''}`}
                  onClick={() => handleChannelToggle(ch)}
                  aria-pressed={bChans.includes(ch)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="field" style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'flex-end', gridColumn: '1 / -1' }}>
            <button type="button" className="btn btn-sm btn-ghost" onClick={handleClearFilters}>
              Limpar tudo
            </button>
          </div>
        </div>
      )}

      {/* SELECTION BAR */}
      {sel.size > 0 && (
        <div className="selbar" id="selBar">
          <b id="selCount">{sel.size}</b>
          <span>selecionados</span>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setSel(new Set())} style={{ color: '#fff', borderColor: '#3a4441' }}>
            Limpar
          </button>
          <span style={{ flex: 1 }} />
          <button type="button" className="btn btn-sm" onClick={() => { setNewGroupName(''); setIsCreateGroupOpen(true); }}>
            Criar grupo
          </button>
          <button type="button" className="btn btn-sm" onClick={() => setIsAddGroupOpen(true)}>
            Adicionar a grupo
          </button>
          <button type="button" className="btn btn-sm btn-primary" onClick={() => setIsExportOpen(true)}>
            Exportar
          </button>
        </div>
      )}

      {/* TABLE */}
      <div className="table-wrap" data-od-id="base-table">
        <table>
          <thead>
            <tr>
              <th style={{ width: '36px' }}>
                <input
                  type="checkbox"
                  className="rowcheck"
                  id="chkAll"
                  checked={filteredLeads.length > 0 && filteredLeads.every((l, idx) => sel.has(getLeadId(l, idx)))}
                  onChange={(e) => toggleSelectAll(e.target.checked)}
                  aria-label="Selecionar todos"
                />
              </th>
              {visCols.map((colId) => {
                const col = DEFAULT_COLS.find((c) => c.id === colId);
                const isSorted = bSort.key === colId;
                return (
                  <th
                    key={colId}
                    onClick={() => handleSort(colId)}
                    style={{ cursor: 'pointer' }}
                    className={colId === 'av' ? 'num' : ''}
                  >
                    {col?.label}
                    {isSorted && (bSort.dir === 1 ? ' ▲' : ' ▼')}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {paginatedRows.length === 0 ? (
              <tr>
                <td colSpan={visCols.length + 1}>
                  <div className="empty">
                    <b>Nenhum lead encontrado</b>
                    <span>Tente alterar os termos de busca ou filtros.</span>
                  </div>
                </td>
              </tr>
            ) : (
              paginatedRows.map((l, idx) => {
                const id = getLeadId(l, idx);
                const isSelected = sel.has(id);
                const st = leadStatus(id);

                return (
                  <tr key={id} className={isSelected ? 'selrow' : ''}>
                    <td>
                      <input
                        type="checkbox"
                        className="rowcheck"
                        checked={isSelected}
                        onChange={(e) => toggleSelectLead(id, e.target.checked)}
                        aria-label={`Selecionar ${getLeadName(l)}`}
                      />
                    </td>
                    {visCols.map((colId) => {
                      if (colId === 'nome') {
                        return (
                          <td key={colId}>
                            <b
                              style={{ cursor: 'pointer', color: 'var(--teal-deep)' }}
                              onClick={() => {
                                setActiveLead(l);
                                setLeadModalTab('dados');
                              }}
                            >
                              {getLeadName(l)}
                            </b>
                          </td>
                        );
                      }
                      if (colId === 'status') {
                        return (
                          <td key={colId}>
                            <span
                              className={`st-ic ${st === 'resp' ? 'st-resp' : st === 'env' ? 'st-env' : 'st-novo'}`}
                              title={st === 'resp' ? 'Respondeu' : st === 'env' ? 'Mensagem enviada' : 'Ainda não contatado'}
                            >
                              {st === 'resp' ? '↩' : st === 'env' ? '→' : '○'}
                            </span>
                          </td>
                        );
                      }
                      if (colId === 'grupos') {
                        const myGrps = leadGroups(id);
                        return (
                          <td key={colId}>
                            {myGrps.length === 0 ? (
                              <span style={{ fontSize: '12.5px', color: 'var(--muted)' }}>—</span>
                            ) : (
                              myGrps.map((g) => (
                                <span key={g.id} className="gchip">
                                  <span>{g.name}</span>
                                  <button
                                    type="button"
                                    onClick={() => removeLeadFromGroup(id, g.id)}
                                    title="Remover deste grupo"
                                  >
                                    ×
                                  </button>
                                </span>
                              ))
                            )}
                          </td>
                        );
                      }
                      if (colId === 'cat') return <td key={colId}>{getLeadCat(l)}</td>;
                      if (colId === 'tel') return <td key={colId}>{getLeadTel(l) || '—'}</td>;
                      if (colId === 'wa') return <td key={colId}>{getLeadTel(l) || '—'}</td>;
                      if (colId === 'ig') return <td key={colId}>{getLeadIg(l) || '—'}</td>;
                      if (colId === 'site') return <td key={colId}>{getLeadSite(l) || '—'}</td>;
                      if (colId === 'mail') return <td key={colId}>{getLeadMail(l) || '—'}</td>;
                      if (colId === 'av') return <td key={colId} className="num">{getLeadRating(l)} ({getLeadReviews(l)})</td>;
                      if (colId === 'uf') return <td key={colId}>{getLeadUf(l) || '—'}</td>;
                      if (colId === 'city') return <td key={colId}>{getLeadCity(l) || '—'}</td>;
                      if (colId === 'hood') return <td key={colId}>{getLeadHood(l) || '—'}</td>;
                      if (colId === 'orig') return <td key={colId}>{getLeadOrig(l)}</td>;
                      return <td key={colId}>—</td>;
                    })}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>

        <div className="pager" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', padding: '12px' }}>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => setBPage(Math.max(1, bPage - 1))}
            disabled={bPage <= 1}
            aria-label="Página anterior"
          >
            ←
          </button>
          <span style={{ fontSize: '12.5px', color: 'var(--muted)' }}>
            Página {bPage} de {totalPages} · {filteredLeads.length} leads
          </span>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => setBPage(Math.min(totalPages, bPage + 1))}
            disabled={bPage >= totalPages}
            aria-label="Próxima página"
          >
            →
          </button>
        </div>
      </div>

      {/* MODAL EXPORTAR */}
      {isExportOpen && (
        <div className="overlay on" onClick={() => setIsExportOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 'min(560px, 94vw)' }}>
            <div className="modal-head">
              <h2>Exportar leads</h2>
            </div>
            <div className="modal-body" style={{ gridTemplateColumns: '1fr', gap: '12px' }}>
              <div className="exp-sec">Formato</div>
              <div>
                {[
                  { f: 'xlsx', name: 'Excel', desc: '.xlsx · planilha' },
                  { f: 'csv', name: 'CSV', desc: '.csv · texto' },
                  { f: 'json', name: 'JSON', desc: '.json · dados' }
                ].map((item) => (
                  <div
                    key={item.f}
                    className={`exp-row ${expFmt === item.f ? 'sel' : ''}`}
                    onClick={() => setExpFmt(item.f)}
                  >
                    <b>{item.name}</b>
                    <span>{item.desc}</span>
                  </div>
                ))}
              </div>

              <div className="exp-sec">Dados</div>
              <div>
                {[
                  { s: 'filtered', name: 'Resultado filtrado', count: `${filteredLeads.length} leads` },
                  { s: 'selected', name: 'Selecionados', count: `${sel.size} leads` },
                  { s: 'all', name: 'Base inteira', count: `${leads.length} leads` }
                ].map((item) => (
                  <div
                    key={item.s}
                    className={`exp-row ${expScope === item.s ? 'sel' : ''}`}
                    onClick={() => setExpScope(item.s)}
                  >
                    <b>{item.name}</b>
                    <span>{item.count}</span>
                  </div>
                ))}
              </div>

              <div className="exp-sec">Colunas</div>
              <div>
                {[
                  { c: 'vis', name: 'Apenas visíveis', count: `${visCols.length} colunas` },
                  { c: 'all', name: 'Todas as colunas', count: `${DEFAULT_COLS.length} colunas` }
                ].map((item) => (
                  <div
                    key={item.c}
                    className={`exp-row ${expColsScope === item.c ? 'sel' : ''}`}
                    onClick={() => setExpColsScope(item.c)}
                  >
                    <b>{item.name}</b>
                    <span>{item.count}</span>
                  </div>
                ))}
              </div>

              <div className="estimate full">
                <b>
                  {expScope === 'all' ? leads.length : expScope === 'selected' ? sel.size : filteredLeads.length} leads serão exportados
                </b>
                <span> em {expFmt.toUpperCase()} · {expColsScope === 'vis' ? 'colunas visíveis' : 'todas as colunas'}</span>
              </div>
            </div>
            <div className="modal-foot">
              <button type="button" className="btn btn-ghost" onClick={() => setIsExportOpen(false)}>
                Cancelar
              </button>
              <button type="button" className="btn btn-primary" onClick={handleExport}>
                Exportar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL CRIAR GRUPO */}
      {isCreateGroupOpen && (
        <div className="overlay on" onClick={() => setIsCreateGroupOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 'min(440px, 94vw)' }}>
            <div className="modal-head">
              <h2>Criar grupo</h2>
            </div>
            <div className="modal-body" style={{ gridTemplateColumns: '1fr', gap: '12px' }}>
              <div className="field">
                <label htmlFor="grpName">Nome do grupo</label>
                <input
                  id="grpName"
                  placeholder="Ex.: Advogados — Rio de Janeiro"
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="estimate full">
                <b>{sel.size} leads serão adicionados a este grupo.</b>
              </div>
            </div>
            <div className="modal-foot">
              <button type="button" className="btn btn-ghost" onClick={() => setIsCreateGroupOpen(false)}>
                Cancelar
              </button>
              <button type="button" className="btn btn-primary" onClick={handleCreateGroup}>
                Criar grupo
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL ADICIONAR A GRUPO */}
      {isAddGroupOpen && (
        <div className="overlay on" onClick={() => setIsAddGroupOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 'min(440px, 94vw)' }}>
            <div className="modal-head">
              <h2>Adicionar a grupo</h2>
            </div>
            <div className="modal-body" style={{ gridTemplateColumns: '1fr', gap: '12px' }}>
              <div className="field">
                <label>Buscar grupo</label>
                <input
                  placeholder="Digite para buscar…"
                  value={groupSearch}
                  onChange={(e) => setGroupSearch(e.target.value)}
                  autoFocus
                />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '240px', overflowY: 'auto' }}>
                {groups
                  .filter((g) => !groupSearch || norm(g.name).includes(norm(groupSearch)))
                  .map((g) => (
                    <button
                      key={g.id}
                      type="button"
                      className="grp-row"
                      onClick={() => handleAddToGroup(g.id)}
                    >
                      <b>{g.name}</b>
                      <span>{g.members.length} leads</span>
                    </button>
                  ))}
              </div>
            </div>
            <div className="modal-foot">
              <button type="button" className="btn btn-ghost" onClick={() => setIsAddGroupOpen(false)}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DETALHES DO LEAD */}
      {activeLead && (
        <div className="overlay on" onClick={() => setActiveLead(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 'min(560px, 94vw)' }}>
            <div className="modal-head">
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <h2 style={{ flex: 1 }}>{getLeadName(activeLead)}</h2>
                <span className={`st-ic ${leadStatus(getLeadId(activeLead, 0)) === 'resp' ? 'st-resp' : leadStatus(getLeadId(activeLead, 0)) === 'env' ? 'st-env' : 'st-novo'}`}>
                  {leadStatus(getLeadId(activeLead, 0)) === 'resp' ? '↩' : leadStatus(getLeadId(activeLead, 0)) === 'env' ? '→' : '○'}
                </span>
              </div>
            </div>

            <div className="modal-body" style={{ gridTemplateColumns: '1fr', gap: '12px' }}>
              <div className="ltabs">
                <button
                  type="button"
                  className={leadModalTab === 'dados' ? 'on' : ''}
                  onClick={() => setLeadModalTab('dados')}
                >
                  Dados
                </button>
                <button
                  type="button"
                  className={leadModalTab === 'scoring' ? 'on' : ''}
                  onClick={() => setLeadModalTab('scoring')}
                >
                  Scoring
                </button>
              </div>

              {leadModalTab === 'dados' ? (
                <div>
                  <div className="det-grid">
                    <div>
                      <div className="lb">Categoria</div>
                      <div className="v">{getLeadCat(activeLead)}</div>
                    </div>
                    <div>
                      <div className="lb">Localização</div>
                      <div className="v">{getLeadHood(activeLead)} — {getLeadCity(activeLead)}/{getLeadUf(activeLead)}</div>
                    </div>
                    <div>
                      <div className="lb">Telefone</div>
                      <div className="v">{getLeadTel(activeLead) || '—'}</div>
                    </div>
                    <div>
                      <div className="lb">Instagram</div>
                      <div className="v">{getLeadIg(activeLead) || '—'}</div>
                    </div>
                    <div>
                      <div className="lb">Site</div>
                      <div className="v">{getLeadSite(activeLead) || '—'}</div>
                    </div>
                    <div>
                      <div className="lb">E-mail</div>
                      <div className="v">{getLeadMail(activeLead) || '—'}</div>
                    </div>
                    <div>
                      <div className="lb">Avaliação</div>
                      <div className="v">{getLeadRating(activeLead)} · ${getLeadReviews(activeLead)} avaliações</div>
                    </div>
                  </div>

                  <div className="exp-sec" style={{ marginTop: '16px' }}>Grupos</div>
                  <div>
                    {leadGroups(getLeadId(activeLead, 0)).length === 0 ? (
                      <span style={{ fontSize: '13px', color: 'var(--muted)' }}>Nenhum grupo atribuído.</span>
                    ) : (
                      leadGroups(getLeadId(activeLead, 0)).map((g) => (
                        <span key={g.id} className="gchip">
                          <span>{g.name}</span>
                          <button
                            type="button"
                            onClick={() => removeLeadFromGroup(getLeadId(activeLead, 0), g.id)}
                          >
                            ×
                          </button>
                        </span>
                      ))
                    )}
                  </div>

                  <div className="field" style={{ marginTop: '8px' }}>
                    <select
                      value=""
                      onChange={(e) => {
                        if (e.target.value) {
                          addLeadToGroup(getLeadId(activeLead, 0), e.target.value);
                        }
                      }}
                    >
                      <option value="">Adicionar a grupo…</option>
                      {groups
                        .filter((g) => !g.members.includes(getLeadId(activeLead, 0)))
                        .map((g) => (
                          <option key={g.id} value={g.id}>{g.name}</option>
                        ))}
                    </select>
                  </div>

                  <div className="exp-sec" style={{ marginTop: '16px' }}>Histórico</div>
                  <div className="tl">
                    {(hist[getLeadId(activeLead, 0)] || []).length === 0 && leadGroups(getLeadId(activeLead, 0)).length === 0 ? (
                      <div className="empty">
                        <b>Sem histórico ainda</b>
                        <span>Nenhum contato registrado com este lead.</span>
                      </div>
                    ) : (
                      <>
                        {(hist[getLeadId(activeLead, 0)] || []).map((e, ix) => (
                          <div key={ix} className="tl-ev">
                            <span className={`tl-dot ${e.k === 'reply' ? 'reply' : 'sent'}`}>
                              {e.k === 'reply' ? '↩' : '→'}
                            </span>
                            <div className="tl-body">
                              <b>{e.k === 'reply' ? 'Resposta recebida' : 'Mensagem enviada'}</b>
                              <div className="tl-meta">{fmtDate(e.ts)} {e.wa ? `· ${e.wa}` : ''} {e.camp ? `· ${e.camp}` : ''}</div>
                              <div className="tl-text">“{e.text}”</div>
                            </div>
                          </div>
                        ))}
                        {leadGroups(getLeadId(activeLead, 0)).map((g) => (
                          <div key={g.id} className="tl-ev">
                            <span className="tl-dot sys">◈</span>
                            <div className="tl-body">
                              <b>Entrou no grupo</b>
                              <div className="tl-meta">{g.name} · {fmtDate(g.created)}</div>
                            </div>
                          </div>
                        ))}
                      </>
                    )}
                  </div>
                </div>
              ) : (
                <div>
                  <div className="exp-sec">Por que esse score?</div>
                  {analysis[getLeadId(activeLead, 0)] ? (
                    (() => {
                      const a = analysis[getLeadId(activeLead, 0)];
                      const bandCls = a.score >= 80 ? 'high' : a.score >= 50 ? 'mid' : 'low';
                      const bandTxt = a.score >= 80 ? 'Alta' : a.score >= 50 ? 'Média' : 'Baixa';
                      return (
                        <div>
                          <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', marginBottom: '6px' }}>
                            <span style={{ fontFamily: 'var(--font-display)', fontSize: '40px', lineHeight: 1 }}>{a.score}</span>
                            <span className={`ftag ${bandCls}`}>{bandTxt}</span>
                          </div>
                          <div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '10px' }}>
                            {a.preset || 'Auditoria'} · {fmtDate(a.ts)} {a.provider ? `· ${a.provider}` : ''}
                          </div>

                          {a.pos?.length > 0 && (
                            <div className="acc open" style={{ marginBottom: '8px' }}>
                              <div className="acc-head" style={{ padding: '8px 12px', background: 'var(--surface-warm)', fontWeight: 600, fontSize: '13px' }}>
                                Pontos positivos ({a.pos.length})
                              </div>
                              <div className="acc-body" style={{ display: 'block' }}>
                                <ul>
                                  {a.pos.map((p, i) => <li key={i}>{p}</li>)}
                                </ul>
                              </div>
                            </div>
                          )}

                          {a.neg?.length > 0 && (
                            <div className="acc open" style={{ marginBottom: '8px' }}>
                              <div className="acc-head" style={{ padding: '8px 12px', background: 'var(--surface-warm)', fontWeight: 600, fontSize: '13px' }}>
                                Problemas encontrados ({a.neg.length})
                              </div>
                              <div className="acc-body" style={{ display: 'block' }}>
                                <ul>
                                  {a.neg.map((n, i) => <li key={i}>{n}</li>)}
                                </ul>
                              </div>
                            </div>
                          )}

                          {a.opp?.length > 0 && (
                            <div className="acc open" style={{ marginBottom: '8px' }}>
                              <div className="acc-head" style={{ padding: '8px 12px', background: 'var(--surface-warm)', fontWeight: 600, fontSize: '13px' }}>
                                Oportunidades ({a.opp.length})
                              </div>
                              <div className="acc-body" style={{ display: 'block' }}>
                                <ul>
                                  {a.opp.map((o, i) => <li key={i}>{o}</li>)}
                                </ul>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })()
                  ) : (
                    <div className="empty">
                      <b>Não analisado</b>
                      <span>Execute a análise do grupo deste lead em Lead Scoring.</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="modal-foot">
              <button type="button" className="btn btn-ghost" onClick={() => setActiveLead(null)}>
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
