import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  MapPin,
  Mail,
  Phone,
  Globe,
  Instagram,
  Filter,
  Download,
  UploadCloud,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Search,
  Users,
  Sparkles,
  Play,
  Square,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Table,
  Map as MapIcon,
  Copy,
  Check,
  ChevronDown,
  FileSpreadsheet
} from 'lucide-react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  dedupeLeads,
  getExtractionSearches,
  normalizeLeadCollection,
  readLocalArray,
} from '../leadData';
import { useNotifications } from './NotificationCenter';

const STREET_MAP_LAYER = {
  url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution: '© OpenStreetMap contributors',
  subdomains: 'abc',
  maxZoom: 19,
};

const DEFAULT_MAP_CENTER = [-14.235, -51.9253];
const DEFAULT_MAP_ZOOM = 4;

function toCoordinateNumber(value) {
  if (value == null || String(value).trim() === '') return Number.NaN;
  return Number(value);
}

function isValidCoordinatePair(lat, lng) {
  return Number.isFinite(lat)
    && Number.isFinite(lng)
    && lat >= -90
    && lat <= 90
    && lng >= -180
    && lng <= 180
    && !(lat === 0 && lng === 0);
}

function parseCanonicalGoogleCoordinates(url = '') {
  let decoded = String(url);
  try { decoded = decodeURIComponent(decoded); } catch {}
  const match = decoded.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  if (!match) return null;
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  return isValidCoordinatePair(lat, lng) ? { lat, lng } : null;
}

// Um pin só é desenhado quando a origem permite tratá-lo como um ponto real.
// Coordenadas de viewport, cidade/bairro ou sem proveniência ficam fora do mapa.
function getExactLeadLocation(lead = {}) {
  const canonicalCoords = parseCanonicalGoogleCoordinates(
    lead.googleMapsUrl || lead.mapsUrl || lead.google_maps_url || ''
  );
  if (canonicalCoords) {
    return { ...canonicalCoords, source: 'Google Maps' };
  }

  const lat = toCoordinateNumber(lead.latitude ?? lead.lat);
  const lng = toCoordinateNumber(lead.longitude ?? lead.lng);
  if (!isValidCoordinatePair(lat, lng)) return null;

  const source = String(lead.coordSource || '').toLowerCase();
  if (source === 'poi' || source === 'meta') {
    return { lat, lng, source: 'Google Maps' };
  }
  if (source === 'nominatim' && String(lead.geocodeConfidence || '').toLowerCase() === 'exact') {
    return { lat, lng, source: 'endereço exato' };
  }
  return null;
}

function readStoredUserLocation() {
  try {
    const saved = JSON.parse(localStorage.getItem('sigma_ref') || 'null');
    const lat = toCoordinateNumber(saved?.lat);
    const lng = toCoordinateNumber(saved?.lng);
    if (isValidCoordinatePair(lat, lng)) {
      return {
        lat,
        lng,
        accuracy: Number.isFinite(Number(saved.accuracy)) ? Number(saved.accuracy) : null,
        timestamp: Number.isFinite(Number(saved.timestamp)) ? Number(saved.timestamp) : null,
      };
    }
  } catch {}
  return null;
}

// O desenho fica dentro do host do Leaflet. Assim o hover/seleção não sobrescreve
// o transform usado pelo próprio Leaflet para posicionar o marcador.
function createPinIcon(hasEmail = false, isSelected = false) {
  const fill = isSelected ? '#E8B33D' : hasEmail ? '#10A37F' : '#475569';
  const scale = isSelected ? 1.12 : 1;
  return L.divIcon({
    className: '',
    html: `
      <div style="
        width: 36px;
        height: 44px;
        filter: drop-shadow(0 3px 5px rgba(15, 23, 42, 0.35));
        transform: scale(${scale});
        transform-origin: 50% 100%;
        transition: transform 160ms ease;
        pointer-events: none;
      ">
        <svg viewBox="0 0 36 44" width="36" height="44" aria-hidden="true">
          <path d="M18 1C8.61 1 1 8.61 1 18c0 11.8 15.26 24.1 15.91 24.62a1.75 1.75 0 0 0 2.18 0C19.74 42.1 35 29.8 35 18 35 8.61 27.39 1 18 1Z" fill="${fill}" stroke="#FFFFFF" stroke-width="2" />
          <circle cx="18" cy="18" r="5" fill="#FFFFFF" />
        </svg>
      </div>
    `,
    iconSize: [36, 44],
    iconAnchor: [18, 43],
    popupAnchor: [0, -42],
  });
}

function createUserLocationIcon() {
  return L.divIcon({
    className: '',
    html: `
      <div style="
        width: 22px;
        height: 22px;
        box-sizing: border-box;
        border-radius: 50%;
        background: #0F172A;
        border: 3px solid #FFFFFF;
        box-shadow: 0 0 0 4px rgba(16, 163, 127, 0.48), 0 3px 9px rgba(15, 23, 42, 0.35);
        pointer-events: none;
      "></div>
    `,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    popupAnchor: [0, -15],
  });
}

export default function MapScraperView({
  onUpdateLeadsCount,
  addLog,
  onOpenNewExtraction
}) {
  const { addNotification } = useNotifications();

  const [leads, setLeads] = useState(() => normalizeLeadCollection(readLocalArray('sigma_leads')));
  const [searches, setSearches] = useState(() => getExtractionSearches(readLocalArray('sigma_searches')));
  const [activeSearchId, setActiveSearchId] = useState('__all__');

  // Estado de processamento
  const [isProcessing, setIsProcessing] = useState(false);
  const [activeScrapeId, setActiveScrapeId] = useState(null);
  const [progressPct, setProgressPct] = useState(0);

  // Interface e visualização
  const [viewMode, setViewMode] = useState('map'); // 'map' | 'table'
  const [userLocation, setUserLocation] = useState(() => readStoredUserLocation());
  const [isLocating, setIsLocating] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [copiedId, setCopiedId] = useState(null);
  const [selectedLeadId, setSelectedLeadId] = useState(null);

  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersLayerRef = useRef(null);
  const userLocationMarkerRef = useRef(null);
  const leadCardRefs = useRef({});

  // Sincronizar contagem global
  useEffect(() => {
    localStorage.setItem('sigma_leads', JSON.stringify(leads));
    onUpdateLeadsCount(dedupeLeads(leads).length);
  }, [leads, onUpdateLeadsCount]);

  useEffect(() => {
    const refreshStoredData = () => {
      setLeads(normalizeLeadCollection(readLocalArray('sigma_leads')));
      setSearches(getExtractionSearches(readLocalArray('sigma_searches')));
    };
    window.addEventListener('sigma:leads-updated', refreshStoredData);
    window.addEventListener('storage', refreshStoredData);
    return () => {
      window.removeEventListener('sigma:leads-updated', refreshStoredData);
      window.removeEventListener('storage', refreshStoredData);
    };
  }, []);

  // IPC de progresso do Playwright
  useEffect(() => {
    if (window.electronAPI && typeof window.electronAPI.onProgress === 'function') {
      const cleanup = window.electronAPI.onProgress((msg) => {
        const m = msg.match(/\[(\d+)\/(\d+)\]/);
        if (m) {
          const pct = Math.round((parseInt(m[1]) / parseInt(m[2])) * 100);
          setProgressPct(pct);
        }
      });
      return cleanup;
    }
  }, []);

  // Determinar pesquisa ativa
  const currentSearchObj = useMemo(() => {
    if (activeSearchId === '__all__') return null;
    return searches.find((s) => s.id === activeSearchId);
  }, [activeSearchId, searches]);

  const activeQueryLabel = useMemo(() => {
    if (currentSearchObj) {
      return currentSearchObj.label || currentSearchObj.query || 'Pesquisa Selecionada';
    }
    if (searches.length > 0) {
      return searches[0].label || searches[0].query || 'Todas as Extrações';
    }
    return 'Todas as Extrações';
  }, [currentSearchObj, searches]);

  // Filtragem de leads
  const visibleLeads = useMemo(() => {
    let list = activeSearchId === '__all__'
      ? dedupeLeads(leads)
      : leads.filter((l) => l.searchId === activeSearchId);

    const st = searchTerm.toLowerCase().trim();
    if (st) {
      list = list.filter((l) =>
        `${l.name} ${l.phone} ${l.email} ${l.address} ${l.category}`
          .toLowerCase()
          .includes(st)
      );
    }
    return list;
  }, [leads, activeSearchId, searchTerm]);

  const totalFound = visibleLeads.length;
  const emailsFound = visibleLeads.filter((l) => l.email).length;
  const yieldPct = totalFound > 0 ? Math.round((emailsFound / totalFound) * 100) : 0;

  // Inicializar Mapa Leaflet
  useEffect(() => {
    if (viewMode !== 'map' || !mapContainerRef.current) return;

    if (!mapInstanceRef.current) {
      const map = L.map(mapContainerRef.current, {
        center: userLocation ? [userLocation.lat, userLocation.lng] : DEFAULT_MAP_CENTER,
        zoom: userLocation ? 13 : DEFAULT_MAP_ZOOM,
        zoomControl: false,
        attributionControl: true
      });

      L.control.zoom({ position: 'bottomright' }).addTo(map);

      L.tileLayer(STREET_MAP_LAYER.url, {
        maxZoom: STREET_MAP_LAYER.maxZoom,
        attribution: STREET_MAP_LAYER.attribution,
        subdomains: STREET_MAP_LAYER.subdomains,
      }).addTo(map);
      mapInstanceRef.current = map;
      markersLayerRef.current = L.layerGroup().addTo(map);

      setTimeout(() => {
        map.invalidateSize();
      }, 200);
    } else {
      setTimeout(() => {
        mapInstanceRef.current?.invalidateSize();
      }, 100);
    }

    const handleResize = () => mapInstanceRef.current?.invalidateSize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [viewMode]);

  const markersMapRef = useRef(new Map());

  // Renderizar Marcadores no Mapa (Apenas quando a lista de leads ou a pesquisa mudar)
  useEffect(() => {
    const map = mapInstanceRef.current;
    const markers = markersLayerRef.current;
    if (!map || !markers) return;

    markers.clearLayers();
    markersMapRef.current.clear();

    const bounds = [];
    const leadsToRender = visibleLeads.slice(0, 80);

    const skippedCount = { current: 0 };
    leadsToRender.forEach((lead, i) => {
      const leadKey = lead.id || i;
      const location = getExactLeadLocation(lead);
      if (!location) {
        skippedCount.current += 1;
        return;
      }
      const { lat, lng } = location;

      const hasEmail = Boolean(lead.email);
      const marker = L.marker([lat, lng], {
        icon: createPinIcon(hasEmail, false),
        title: lead.name || 'Lead',
      });

      marker.bindPopup(`
        <div style="font-family: system-ui, -apple-system, sans-serif; min-width: 200px; padding: 4px;">
          <h4 style="margin: 0 0 4px; font-size: 13px; font-weight: 700; color: #0F172A;">${lead.name || 'Empresa'}</h4>
          <div style="font-size: 11px; color: #64748B; margin-bottom: 6px;">${lead.category || 'Estabelecimento'}</div>
          ${lead.phone ? `<div style="font-size: 11px; margin-bottom: 2px;"><strong>Telefone:</strong> ${lead.phone}</div>` : ''}
          ${lead.email ? `<div style="font-size: 11px; margin-bottom: 2px;"><strong>E-mail:</strong> ${lead.email}</div>` : ''}
          ${lead.address ? `<div style="font-size: 10px; color: #94A3B8; margin-top: 4px;">📍 ${lead.address}</div>` : ''}
          <div style="font-size: 10px; color: #059669; margin-top: 4px;">✓ Coordenada confirmada · ${location.source}</div>
        </div>
      `);

      marker.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        setSelectedLeadId(leadKey);

        // Focar no mapa suavemente SEM resetar o zoom do usuário
        map.panTo([lat, lng], { animate: true, duration: 0.4 });
        marker.openPopup();

        // Rolar card no feed lateral
        const cardEl = leadCardRefs.current[leadKey];
        if (cardEl) {
          cardEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      });

      markers.addLayer(marker);
      markersMapRef.current.set(leadKey, { marker, lead, hasEmail, lat, lng });
      bounds.push([lat, lng]);
    });

    if (skippedCount.current > 0) {
      console.warn(`[MAP] ${skippedCount.current} leads sem coordenada exata confirmada — pins ocultos`);
    }
    if (bounds.length > 0) {
      try {
        map.fitBounds(bounds, { padding: [60, 60], maxZoom: 14 });
      } catch {}
    } else if (userLocation) {
      map.setView([userLocation.lat, userLocation.lng], 13);
    } else {
      map.setView(DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM);
    }
  }, [visibleLeads]);

  // Marcador separado para a localização real do usuário, inclusive se foi salva antes.
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (viewMode !== 'map' || !map) return undefined;

    if (userLocationMarkerRef.current) {
      userLocationMarkerRef.current.removeFrom(map);
      userLocationMarkerRef.current = null;
    }
    if (!userLocation) return undefined;

    const accuracyText = Number.isFinite(userLocation.accuracy)
      ? `<div style="font-size: 11px; color: #64748B; margin-top: 4px;">Precisão informada pelo dispositivo: ${Math.round(userLocation.accuracy)} m</div>`
      : '';
    const marker = L.marker([userLocation.lat, userLocation.lng], {
      icon: createUserLocationIcon(),
      title: 'Sua localização',
      zIndexOffset: 2000,
    }).bindPopup(`
      <div style="font-family: system-ui, -apple-system, sans-serif; min-width: 190px; padding: 4px;">
        <strong style="font-size: 13px; color: #0F172A;">Sua localização</strong>
        ${accuracyText}
      </div>
    `).addTo(map);

    userLocationMarkerRef.current = marker;
    return () => {
      marker.removeFrom(map);
      if (userLocationMarkerRef.current === marker) userLocationMarkerRef.current = null;
    };
  }, [userLocation, viewMode]);

  // Efeito dedicado para atualizar o destaque visual do marcador selecionado
  useEffect(() => {
    markersMapRef.current.forEach(({ marker, hasEmail }, key) => {
      const isSelected = key === selectedLeadId;
      marker.setIcon(createPinIcon(hasEmail, isSelected));
      if (isSelected) {
        marker.setZIndexOffset(1000);
      } else {
        marker.setZIndexOffset(0);
      }
    });
  }, [selectedLeadId]);

  // Ao selecionar um card no feed, centralizar suavemente no marcador correspondente
  const handleSelectLeadFromFeed = (lead, idx) => {
    const leadKey = lead.id || idx;
    setSelectedLeadId(leadKey);

    const item = markersMapRef.current.get(leadKey);
    const map = mapInstanceRef.current;
    if (item && map) {
      map.panTo([item.lat, item.lng], { animate: true, duration: 0.4 });
      item.marker.openPopup();
    } else {
      addNotification({
        type: 'warning',
        category: 'scraper',
        title: 'Localização não confirmada',
        message: 'Este lead não tem coordenada exata. O mapa não cria um pin aproximado.',
        duration: 3200,
      });
    }
  };

  const handleUseMyLocation = () => {
    if (!navigator.geolocation) {
      addNotification({
        type: 'warning',
        category: 'system',
        title: 'Localização indisponível',
        message: 'Este dispositivo não oferece geolocalização.',
      });
      return;
    }

    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = Number(position.coords.latitude);
        const lng = Number(position.coords.longitude);
        if (!isValidCoordinatePair(lat, lng)) {
          setIsLocating(false);
          addNotification({
            type: 'warning',
            category: 'system',
            title: 'Localização inválida',
            message: 'O dispositivo não retornou coordenadas utilizáveis.',
          });
          return;
        }

        const nextLocation = {
          lat,
          lng,
          accuracy: Number.isFinite(Number(position.coords.accuracy)) ? Number(position.coords.accuracy) : null,
          timestamp: Number(position.timestamp) || Date.now(),
        };
        try { localStorage.setItem('sigma_ref', JSON.stringify(nextLocation)); } catch {}
        setUserLocation(nextLocation);
        setIsLocating(false);
        mapInstanceRef.current?.flyTo([lat, lng], 15, { animate: true, duration: 0.7 });
        addNotification({
          type: 'success',
          category: 'system',
          title: 'Localização definida',
          message: Number.isFinite(nextLocation.accuracy)
            ? `Pin posicionado com precisão informada de ${Math.round(nextLocation.accuracy)} m.`
            : 'Seu pin foi posicionado no mapa.',
        });
      },
      (error) => {
        const messages = {
          1: 'Permita o acesso à localização e tente novamente.',
          2: 'O dispositivo não conseguiu determinar sua posição.',
          3: 'A localização demorou demais para responder. Tente novamente.',
        };
        setIsLocating(false);
        addNotification({
          type: 'warning',
          category: 'system',
          title: 'Não foi possível localizar',
          message: messages[error.code] || 'Falha ao obter sua localização.',
        });
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
    );
  };

  // Exportar dados
  const handleExport = async (format = 'csv') => {
    if (visibleLeads.length === 0) {
      addNotification({
        type: 'warning',
        category: 'scraper',
        title: 'Lista Vazia',
        message: 'Nenhum lead disponível para exportação.'
      });
      return;
    }
    const res = await window.electronAPI?.exportLeads?.(visibleLeads, format);
    if (res && res.success) {
      addNotification({
        type: 'success',
        category: 'scraper',
        title: 'Exportado com Sucesso',
        message: `Arquivo ${format.toUpperCase()} gerado no seu computador.`
      });
    }
  };

  const copyText = (text, id) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
    addNotification({
      type: 'info',
      category: 'system',
      title: 'Copiado para Área de Transferência',
      message: text,
      duration: 1800
    });
  };

  return (
    <div className="map-scraper-layout">
      {/* Painel Central (Mapa ou Tabela) */}
      <div className="map-center-panel">
        {viewMode === 'map' ? (
          <div className="map-wrapper">
            <div
              id="leafletMap"
              ref={mapContainerRef}
              className="map-canvas"
              role="application"
              aria-label="Mapa de ruas com leads de coordenada confirmada"
            />

            {/* Card Flutuante Superior Esquerdo com Seletor de Busca */}
            <div className="map-floating-scan-card">
              <div className="scan-card-icon">
                <MapPin size={16} style={{ color: 'var(--app-primary)' }} />
              </div>
              <div className="scan-card-info">
                <span className="scan-label">PESQUISA ATIVA</span>
                <div className="scan-dropdown-wrap">
                  <select
                    className="scan-select-dropdown"
                    value={activeSearchId}
                    onChange={(e) => setActiveSearchId(e.target.value)}
                  >
                    <option value="__all__">Todas as Extrações ({dedupeLeads(leads).length} leads)</option>
                    {searches.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label || s.query}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className={`scan-status-pill ${isProcessing ? 'active' : 'idle'}`}>
                <span className="pulsing-dot" />
                <span>{isProcessing ? `Extraindo... (${progressPct}%)` : 'Pronto'}</span>
              </div>
            </div>

            {/* Controles Flutuantes Superiores Direitos */}
            <div className="map-floating-controls">
              <div className="map-layer-switcher" aria-label="Mapa em modo Ruas" title="Mapa de ruas">
                <span className="map-layer-btn active" style={{ cursor: 'default' }}>Ruas</span>
              </div>
              <button
                type="button"
                className={`map-ctrl-btn ${isLocating ? 'active' : ''}`}
                onClick={handleUseMyLocation}
                disabled={isLocating}
                aria-label="Usar minha localização"
                title="Usar minha localização"
                style={{ width: 'auto', minWidth: 34, padding: '0 10px', gap: 6, whiteSpace: 'nowrap' }}
              >
                {isLocating ? <Loader2 size={16} className="spin-icon" /> : <MapPin size={16} />}
                <span>{isLocating ? 'Localizando…' : 'Usar minha localização'}</span>
              </button>
              <button
                type="button"
                className="map-ctrl-btn"
                onClick={() => setViewMode('table')}
                title="Alternar para Modo Planilha"
              >
                <Table size={16} />
              </button>
            </div>

            {/* Barra de Telemetria Flutuante Inferior */}
            <div className="map-floating-telemetry">
              <div className="telemetry-item">
                <span className="tel-label">Raio:</span>
                <span className="tel-val">5 km</span>
              </div>
              <div className="telemetry-divider" />
              <div className="telemetry-item">
                <span className="tel-label">Termos:</span>
                <span className="tel-val">'{activeQueryLabel.slice(0, 26)}'</span>
              </div>
              <div className="telemetry-divider" />
              <div className="telemetry-item">
                <span className="tel-label">Profundidade:</span>
                <span className="tel-val">Nível 2</span>
              </div>
              <div className="telemetry-divider" />
              <div className="telemetry-item time-remaining">
                <span className="tel-label">Total Filtrado:</span>
                <span className="tel-val">{totalFound.toLocaleString()} Leads</span>
              </div>
            </div>
          </div>
        ) : (
          /* Visualização Alternativa em Tabela */
          <div className="table-full-view">
            <div className="table-top-bar">
              <div className="table-view-switch">
                <button className="btn btn-secondary" onClick={() => setViewMode('map')}>
                  <MapIcon size={15} /> Voltar ao Mapa
                </button>
              </div>
              <div className="table-search-box">
                <Search size={15} />
                <input
                  type="text"
                  placeholder="Filtrar por nome, telefone, e-mail..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
            </div>

            <div className="table-wrapper">
              <table className="leads-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Empresa</th>
                    <th>Categoria</th>
                    <th>Telefone</th>
                    <th>E-mail</th>
                    <th>Website</th>
                    <th>Instagram</th>
                    <th>Endereço</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleLeads.map((item, idx) => (
                    <tr key={item.id || idx}>
                      <td>{idx + 1}</td>
                      <td><strong>{item.name || '-'}</strong></td>
                      <td><span className="feed-badge feed-badge-gray">{item.category || 'Geral'}</span></td>
                      <td>{item.phone || '-'}</td>
                      <td>{item.email || '-'}</td>
                      <td>
                        {item.website ? (
                          <a href={item.website} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--app-primary)' }}>
                            <Globe size={14} />
                          </a>
                        ) : '-'}
                      </td>
                      <td>
                        {item.instagram ? (
                          <a href={item.instagram} target="_blank" rel="noopener noreferrer" style={{ color: '#E056A0' }}>
                            <Instagram size={14} />
                          </a>
                        ) : '-'}
                      </td>
                      <td className="truncate-address">{item.address || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Painel Direito (Métricas e Feed em Tempo Real) */}
      <aside className="feed-right-panel">
        <div className="feed-search-row">
          <label className="feed-search-field">
            <Search size={15} aria-hidden="true" />
            <input
              type="search"
              placeholder="Buscar lead…"
              aria-label="Buscar leads"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
            />
          </label>
          <button type="button" className="feed-filter-button" title="Filtrar leads" aria-label="Filtrar leads">
            <Filter size={16} />
          </button>
        </div>
        {/* Cards de Métricas Superiores */}
        <div className="kpi-cards-grid">
          <div className="kpi-card">
            <div className="kpi-header">
              <span className="kpi-label">LEADS ENCONTRADOS</span>
              <div className="kpi-icon-wrap blue">
                <Users size={16} />
              </div>
            </div>
            <div className="kpi-value-row">
              <span className="kpi-value">{totalFound.toLocaleString()}</span>
              <span className="kpi-trend">↑12%</span>
            </div>
          </div>

          <div className="kpi-card">
            <div className="kpi-header">
              <span className="kpi-label">E-MAILS EXTRAÍDOS</span>
              <div className="kpi-icon-wrap outline-blue">
                <Mail size={16} />
              </div>
            </div>
            <div className="kpi-value-row">
              <span className="kpi-value">{emailsFound.toLocaleString()}</span>
              <span className="kpi-subtext">{yieldPct}% Taxa</span>
            </div>
          </div>
        </div>

        {/* Cabeçalho do Feed */}
        <div className="feed-header-row">
          <h3>Feed de Extração ao Vivo</h3>
          <div className="feed-streaming-badge">
            <span className="feed-streaming-dot" />
            <span>{isProcessing ? 'TRANSMITINDO' : 'SINCRONIZADO'}</span>
          </div>
        </div>

        {/* Lista Rolável de Leads */}
        <div className="feed-list-scroll">
          {visibleLeads.length === 0 ? (
            <div className="feed-empty-state" style={{ textAlign:'center', padding:'28px 16px', display:'flex', flexDirection:'column', alignItems:'center', gap:10 }}>
              <div className="empty-circle-icon" style={{ width:48, height:48, borderRadius:999, background:'var(--surface-2)', border:'1px solid var(--border)', display:'grid', placeItems:'center', color:'var(--muted)' }}>
                <Search size={22} />
              </div>
              <h4 style={{ fontSize:13, fontWeight:700 }}>Nenhum lead nesta seleção</h4>
              <p style={{ fontSize:11.5, color:'var(--muted)', maxWidth:240, lineHeight:1.5 }}>Comece em 1 clique. A extração enriquece e-mails e telefones automaticamente.</p>
              <button className="btn btn-primary" style={{ marginTop:4, height:32, padding:'0 12px', borderRadius:8, fontSize:12, fontWeight:600 }} onClick={() => onOpenNewExtraction?.()}>
                ＋ Nova extração
              </button>
            </div>
          ) : (
            visibleLeads.map((lead, idx) => {
              const hasEmail = Boolean(lead.email);
              const isProcessingItem = isProcessing && idx === 0;
              const isSelected = selectedLeadId === (lead.id || idx);

              return (
                <div
                  key={lead.id || idx}
                  ref={(el) => (leadCardRefs.current[lead.id || idx] = el)}
                  className={`feed-item-card ${isSelected ? 'selected' : ''}`}
                  onClick={() => handleSelectLeadFromFeed(lead, idx)}
                >
                  <div className="feed-item-top">
                    <div className="feed-item-title-group">
                      {isSelected && <span className="blue-active-dot" />}
                      <span className="feed-company-name">{lead.name || 'Empresa Local'}</span>
                    </div>

                    {isProcessingItem ? (
                      <span className="feed-badge feed-badge-gray">
                        PROCESSANDO
                      </span>
                    ) : hasEmail ? (
                      <span className="feed-badge feed-badge-green">
                        VERIFICADO
                      </span>
                    ) : (
                      <span className="feed-badge feed-badge-red">
                        SEM E-MAIL
                      </span>
                    )}
                  </div>

                  <div className="feed-item-location">
                    <MapPin size={12} className="loc-pin-icon" />
                    <span>{lead.address || lead.category || 'Localização identificada'}</span>
                  </div>

                  <div className="feed-item-pills-row">
                    {isProcessingItem ? (
                      <div className="feed-pill loading-pill">
                        <Loader2 size={12} className="spin-icon" />
                        <span>Buscando contatos...</span>
                      </div>
                    ) : (
                      <>
                        {lead.email && (
                          <div
                            className="feed-pill email-pill"
                            onClick={(e) => {
                              e.stopPropagation();
                              copyText(lead.email, `email_${lead.id || idx}`);
                            }}
                            title="Clique para copiar e-mail"
                          >
                            <Mail size={12} />
                            <span>{lead.email}</span>
                            {copiedId === `email_${lead.id || idx}` ? <Check size={11} /> : null}
                          </div>
                        )}

                        {lead.phone && (
                          <div
                            className="feed-pill phone-pill"
                            onClick={(e) => {
                              e.stopPropagation();
                              copyText(lead.phone, `phone_${lead.id || idx}`);
                            }}
                            title="Clique para copiar telefone"
                          >
                            <Phone size={12} />
                            <span>{lead.phone}</span>
                            {copiedId === `phone_${lead.id || idx}` ? <Check size={11} /> : null}
                          </div>
                        )}

                        {lead.website && (
                          <a
                            href={lead.website}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="feed-pill website-pill"
                            title={lead.website}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Globe size={12} />
                          </a>
                        )}

                        {lead.instagram && (
                          <a
                            href={lead.instagram}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="feed-pill ig-pill"
                            title={lead.instagram}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Instagram size={12} />
                          </a>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Ações Inferiores de Exportação */}
        <div className="feed-bottom-action-group">
          <button
            className="btn btn-export-csv"
            onClick={() => handleExport('csv')}
            disabled={visibleLeads.length === 0}
          >
            Exportar CSV
          </button>
          <button
            className="btn btn-export-xlsx"
            onClick={() => handleExport('xlsx')}
            disabled={visibleLeads.length === 0}
            title="Exportar em formato Excel (.xlsx)"
          >
            <FileSpreadsheet size={15} />
          </button>
        </div>
      </aside>
    </div>
  );
}
