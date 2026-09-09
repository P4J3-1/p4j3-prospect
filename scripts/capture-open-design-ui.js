/**
 * Renderiza as rotas principais em um BrowserWindow isolado e salva evidência visual.
 * Não usa dados/sessões reais: todos os IPCs de leitura são mocks determinísticos.
 */
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { KanbanStore } = require('../kanban/kanban-store');

const outputDir = path.join(__dirname, '..', 'docs', 'qa', 'open-design-lote1');
const qaUserDataPath = path.join(os.tmpdir(), `sigma-gmaps-qa-${process.pid}`);
app.setPath('userData', qaUserDataPath);
const errors = [];
const now = Date.now();
const fixtureLeads = [
  { id: 'lead-1', searchId: 'search-odonto', name: 'Odonto Lume', category: 'Dentista', phone: '+55 21 98765-0142', email: 'contato@odontolume.com.br', website: 'https://odontolume.com.br', address: 'Av. Atlântica, 1000, Copacabana', city: 'Rio de Janeiro', state: 'RJ', latitude: -22.9711, longitude: -43.1822, coordSource: 'poi' },
  { id: 'lead-2', searchId: 'search-odonto', name: 'Clínica Sorriso', category: 'Clínica odontológica', phone: '+55 21 97654-8890', website: 'https://clinicasorriso.com.br', address: 'Rua Visconde de Pirajá, 420, Ipanema', city: 'Rio de Janeiro', state: 'RJ', latitude: -22.9833, longitude: -43.2096, coordSource: 'meta' },
  { id: 'lead-3', searchId: 'search-academia', name: 'Academia Pulso', category: 'Academia', phone: '+55 11 95555-1000', instagram: '@academiapulso', address: 'Av. Paulista, 1200, Bela Vista', city: 'São Paulo', state: 'SP', latitude: -23.5616, longitude: -46.6559, coordSource: 'poi' },
  { id: 'lead-4', searchId: 'importados', name: 'Café Importado', category: 'Cafeteria', phone: '+55 11 94444-2000', city: 'São Paulo', state: 'SP' },
];
const fixtureSearches = [
  { id: 'search-odonto', label: 'Dentistas · Rio de Janeiro', query: 'dentistas rio de janeiro', source: 'maps', timestamp: now - 120000 },
  { id: 'search-academia', label: 'Academias · São Paulo', query: 'academias são paulo', source: 'maps', timestamp: now - 3600000 },
  { id: 'importados', label: 'Planilhas importadas', source: 'spreadsheet', timestamp: now },
];
const fixtureCampaigns = [
  {
    id: 'campaign-1', name: 'Odontologia · Zona Sul', status: 'running', createdAt: now - 7200000,
    connectionId: 'sigma-main', stats: { total: 3, sent: 3, read: 1, replied: 1 },
    leads: [
      {
        leadId: 'lead-1', name: 'Odonto Lume', phone: '5521987650142', phoneRaw: '+55 21 98765-0142',
        category: 'Dentista', status: 'replied', sentAt: now - 5000000, repliedAt: now - 4000000,
        kanbanStage: 'conversation', kanbanOrder: 0,
      },
      {
        leadId: 'lead-2', name: 'Clínica Sorriso', phone: '5521976548890', phoneRaw: '+55 21 97654-8890',
        category: 'Clínica odontológica', status: 'sent', sentAt: now - 3000000,
        kanbanStage: 'new', kanbanOrder: 1,
      },
      {
        leadId: 'lead-3', name: 'Academia Pulso', phone: '5511955551000', phoneRaw: '+55 11 95555-1000',
        category: 'Academia', status: 'failed', kanbanStage: 'finished', kanbanOrder: 2,
      },
    ],
  },
];
const fixtureChats = [
  { jid: '5521987650142@s.whatsapp.net', phone: '5521987650142', name: 'Odonto Lume', lastMessage: 'Pode me explicar melhor?', timestamp: Math.floor(now / 1000), unreadCount: 2 },
  { jid: '5521976548890@s.whatsapp.net', phone: '5521976548890', name: 'Clínica Sorriso', lastMessage: 'Obrigada pelo contato.', timestamp: Math.floor(now / 1000) - 3600, unreadCount: 0 },
];
const fixtureMessages = [
  { key: { id: 'msg-1', fromMe: true }, messageTimestamp: Math.floor(now / 1000) - 120, message: { conversation: 'Vi uma oportunidade simples no site de vocês. Posso mostrar?' } },
  { key: { id: 'msg-2', fromMe: false }, messageTimestamp: Math.floor(now / 1000) - 60, message: { conversation: 'Pode me explicar melhor?' } },
];
const fixtureConnectionState = { connected: true };
const fixtureFailureState = { connect: false, startChat: false, createCampaign: false, mapRepair: false };
let fixtureMapRepairRequests = 0;
const fixtureKanbanStore = new KanbanStore(qaUserDataPath);
fixtureKanbanStore.syncLeads(fixtureLeads, 'maps');
fixtureKanbanStore.syncLeads(
  fixtureLeads.slice(0, 2).map((lead) => ({
    id: `score-${lead.id}`,
    company: lead,
    score: { value: lead.id === 'lead-1' ? 82 : 45, priority: lead.id === 'lead-1' ? 'alta' : 'media' },
  })),
  'scoring',
);
fixtureKanbanStore.syncCampaigns(fixtureCampaigns);

const mocks = {
  'update-status': { state: 'idle' },
  'metrics-get': {},
  'metrics-settings-get': { enabled: false },
  'whatsapp-get-chats': { chats: fixtureChats },
  'whatsapp-get-archived-chats': { chats: [] },
  'whatsapp-get-contacts': { contacts: fixtureChats },
  'whatsapp-get-profile-pic': { url: null },
  'whatsapp-load-messages': { messages: fixtureMessages },
  'whatsapp-mark-read': { success: true },
  'whatsapp-get-contact-info': { name: 'Odonto Lume', phone: '+55 21 98765-0142' },
  'whatsapp-get-settings': {},
  'whatsapp-labels-get': { success: true, catalog: [], byJid: {} },
  'campaign-get-all': { campaigns: fixtureCampaigns },
  'lead-scoring-get-all': {
    success: true,
    leads: fixtureLeads.slice(0, 2).map((lead) => ({ id: lead.id, company: lead, score: { value: lead.id === 'lead-1' ? 82 : 45, priority: lead.id === 'lead-1' ? 'alta' : 'media' } })),
    total: 2,
    stats: { total: 2, highPriority: 1, goodOpportunity: 1, responded: 0, closed: 0, closedValue: 0 },
  },
  'lead-scoring-list-groups': { success: true, groups: [{ id: 'group-demo', name: 'Odontologia · Zona Sul', count: 2, color: '#10a37f' }] },
  'lead-scoring-get-settings': { success: true, settings: { ai: { provider: 'opencode', model: 'deepseek-v4-flash-free', hasApiKey: true } } },
};

Object.entries(mocks).forEach(([channel, value]) => {
  ipcMain.handle(channel, () => value);
});

ipcMain.handle('whatsapp-status', () => ({
  status: fixtureConnectionState.connected ? 'connected' : 'disconnected',
  connectionId: 'sigma-main',
  activeConnectionId: 'sigma-main',
}));
ipcMain.handle('whatsapp-list-connections', () => ({
  activeConnectionId: 'sigma-main',
  connections: [{
    id: 'sigma-main',
    phoneNumber: '+55 21 90000-0001',
    status: fixtureConnectionState.connected ? 'connected' : 'disconnected',
    provider: 'baileys',
    active: true,
  }],
}));
ipcMain.handle('whatsapp-connect', () => ({
  success: !fixtureFailureState.connect,
  error: fixtureFailureState.connect ? 'Não foi possível gerar o QR de teste.' : undefined,
  connectionId: 'sigma-main',
  activeConnectionId: 'sigma-main',
  connections: [{ id: 'sigma-main', phoneNumber: '+55 21 90000-0001', status: 'connected', provider: 'baileys', active: true }],
}));
ipcMain.handle('whatsapp-start-chat', (_event, { phone, name }) => {
  const digits = String(phone || '').replace(/@.*$/, '').replace(/\D/g, '');
  if (fixtureFailureState.startChat) return { success: false, error: 'Falha controlada ao abrir conversa.' };
  return { success: Boolean(digits), jid: `${digits}@s.whatsapp.net`, phone: digits, name: name || digits };
});

ipcMain.handle('campaign-create', () => fixtureFailureState.createCampaign
  ? { success: false, error: 'Falha controlada ao criar campanha.' }
  : { success: true, campaign: fixtureCampaigns[0] });

ipcMain.handle('campaign-update', (_event, { id, updates }) => {
  const campaign = fixtureCampaigns.find((item) => item.id === id);
  if (!campaign) return { success: false, error: 'Campanha não encontrada no fixture' };
  if (Array.isArray(updates?.leads)) campaign.leads = updates.leads;
  return { success: true, campaign };
});

ipcMain.handle('kanban-get-board', () => ({ success: true, board: fixtureKanbanStore.getBoard() }));
ipcMain.handle('kanban-sync-maps', (_event, { leads } = {}) => ({
  success: true,
  board: fixtureKanbanStore.syncLeads(leads, 'maps'),
}));
ipcMain.handle('kanban-save-config', (_event, { board, expectedRevision } = {}) => {
  try {
    return { success: true, board: fixtureKanbanStore.saveConfig(board, expectedRevision) };
  } catch (error) {
    return { success: false, error: error.message };
  }
});
ipcMain.handle('kanban-move-card', (_event, payload = {}) => {
  try {
    return { success: true, board: fixtureKanbanStore.moveCard(payload) };
  } catch (error) {
    return { success: false, error: error.message };
  }
});
ipcMain.handle('kanban-apply-rules', (_event, { force } = {}) => {
  try {
    const result = fixtureKanbanStore.applyRules({ force: Boolean(force) });
    return { success: true, ...result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});
ipcMain.handle('kanban-resume-automation', (_event, { entityKey } = {}) => {
  try {
    return { success: true, board: fixtureKanbanStore.resumeAutomation(entityKey) };
  } catch (error) {
    return { success: false, error: error.message };
  }
});
ipcMain.handle('repair-map-addresses', (_event, { leads } = {}) => {
  const candidates = Array.isArray(leads) ? leads : [];
  fixtureMapRepairRequests += candidates.length;
  if (fixtureFailureState.mapRepair) {
    return {
      success: true,
      partial: true,
      repaired: candidates.map((lead) => ({
        key: lead.key,
        address: String(lead.address || '').replace(/^[\s\p{Cc}\p{Cf}\p{Co}\u{1F4CD}\u{FE0E}\u{FE0F}]+/u, ''),
      })),
      failures: candidates.map((lead) => ({ key: lead.key, error: 'Falha controlada de geocoding.' })),
    };
  }
  return {
    success: true,
    repaired: candidates.map((lead) => ({
      key: lead.key,
      address: String(lead.address || '').replace(/^[\s\p{Cc}\p{Cf}\p{Co}\u{1F4CD}\u{FE0E}\u{FE0F}]+/u, ''),
      latitude: -22.985,
      longitude: -43.205,
      coordSource: 'nominatim',
      geocodeConfidence: 'exact',
    })),
  };
});

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

app.whenReady().then(async () => {
  fs.mkdirSync(outputDir, { recursive: true });
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    backgroundColor: '#f7f8f7',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      offscreen: true,
    },
  });

  win.webContents.on('console-message', (_event, level, message) => {
    if (level >= 3 && !/Electron Security Warning/i.test(message)) errors.push(message);
  });
  win.webContents.on('did-fail-load', (_event, code, description, url) => {
    errors.push(`FAIL_LOAD ${code} ${description} ${url}`);
  });

  await win.loadURL(pathToFileURL(path.join(__dirname, '..', 'renderer', 'dist', 'index.html')).href);
  await win.webContents.executeJavaScript(`
    localStorage.setItem('sigma_onboarding_done', '1');
    localStorage.setItem('sigma_ls_ai_onboard_skipped', '1');
    localStorage.setItem('sigma_leads', ${JSON.stringify(JSON.stringify(fixtureLeads))});
    localStorage.setItem('sigma_searches', ${JSON.stringify(JSON.stringify(fixtureSearches))});
    localStorage.setItem('sigma_ref', ${JSON.stringify(JSON.stringify({ lat: -22.975, lng: -43.19, accuracy: 12, timestamp: now }))});
    document.documentElement.setAttribute('data-theme', 'light');
  `);
  await win.reload();
  await pause(900);
  await win.webContents.insertCSS('*{animation:none!important;transition:none!important;scroll-behavior:auto!important}');

  for (const route of ['overview', 'scraper', 'base', 'scoring', 'kanban', 'whatsapp', 'dashboard', 'settings']) {
    await win.webContents.executeJavaScript(`location.hash = '#${route}'; window.dispatchEvent(new HashChangeEvent('hashchange'));`);
    const targetLabel = ({ overview: 'visão geral', scraper: 'scraper maps', base: 'base de leads', scoring: 'lead scoring', kanban: 'kanban', whatsapp: 'whatsapp', dashboard: 'dashboard', settings: 'configurações' })[route];
    const navResult = await win.webContents.executeJavaScript(`(() => {
      const item = [...document.querySelectorAll('.app-sidebar .nav-item')]
        .find((node) => (node.textContent || '').toLowerCase().includes(${JSON.stringify(targetLabel)}));
      if (item) item.click();
      return { found: !!item, title: item?.textContent?.trim() || '' };
    })()`);
    await pause(route === 'scraper' || route === 'kanban' || route === 'whatsapp' ? 1200 : 600);
    if (route === 'whatsapp') {
      await win.webContents.executeJavaScript(`document.querySelector('.chat-thread')?.click()`);
      await pause(300);
    }
    const diagnostic = await win.webContents.executeJavaScript(`(() => {
      const view = document.querySelector('.view-transition');
      const child = view?.firstElementChild;
      const rect = (node) => node ? Object.fromEntries(['x','y','width','height'].map((key) => [key, Math.round(node.getBoundingClientRect()[key])])) : null;
      const flow = document.querySelector('.ls-open-design-steps');
      const visibleOverlays = [...document.querySelectorAll('.overlay, .modal-overlay, [class*="backdrop"]')]
        .filter((node) => { const style = getComputedStyle(node); const box = node.getBoundingClientRect(); return style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0; })
        .map((node) => node.id || node.className || node.tagName);
      return { active: document.querySelector('.app-sidebar .nav-item.active')?.textContent?.trim(), view: rect(view), child: rect(child), visibleOverlays, flow: rect(flow), flowDisplay: flow ? getComputedStyle(flow).display : null, childClass: child?.className || '', text: (child?.innerText || '').slice(0, 80) };
    })()`);
    const image = await win.capturePage();
    const file = path.join(outputDir, `${route}-1440x900.png`);
    fs.writeFileSync(file, image.toPNG());
    console.log(`[capture] ${route}: ${navResult.found ? 'ok' : 'fallback'} ${JSON.stringify(diagnostic)} -> ${file}`);
  }

  if (process.env.SIGMA_QA_ROUTES_ONLY === '1') {
    console.log(JSON.stringify({ outputDir, errors, scope: 'routes-only' }, null, 2));
    win.destroy();
    app.exit(errors.length ? 1 : 0);
    return;
  }

  const navigateTo = async (label, wait = 450) => {
    const found = await win.webContents.executeJavaScript(`(() => {
      const item = [...document.querySelectorAll('.app-sidebar .nav-item')]
        .find((node) => (node.textContent || '').toLowerCase().includes(${JSON.stringify(label)}));
      item?.click();
      return Boolean(item);
    })()`);
    if (!found) errors.push(`Navegação de modal não encontrou: ${label}`);
    await pause(wait);
  };

  const captureModal = async (name, openScript, selector) => {
    await win.webContents.executeJavaScript(`(() => {
      ${openScript}
    })()`);
    await pause(220);
    const opened = await win.webContents.executeJavaScript(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
    if (!opened) {
      errors.push(`Modal não abriu: ${name}`);
      return;
    }
    const modalRect = await win.webContents.executeJavaScript(`(() => { const node = document.querySelector(${JSON.stringify(selector)})?.querySelector('[role="dialog"], .modal, .cmdk, .camp-wizard, .sigma-campaign-dialog'); if (!node) return null; const rect = node.getBoundingClientRect(); return { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height), display: getComputedStyle(node).display }; })()`);
    if (name === 'qr-modal') {
      const qrDiagnostic = await win.webContents.executeJavaScript(`(() => { const node = document.querySelector('.wa-qr'); const cell = node?.querySelector('i.on'); if (!node) return null; const style = getComputedStyle(node); const cellStyle = cell ? getComputedStyle(cell) : null; const box = node.getBoundingClientRect(); const cellBox = cell?.getBoundingClientRect(); return { box: { width: Math.round(box.width), height: Math.round(box.height) }, aspectRatio: style.aspectRatio, gridRows: style.gridTemplateRows, alignItems: style.alignItems, cell: cellBox ? { width: Math.round(cellBox.width), height: Math.round(cellBox.height), background: cellStyle.backgroundColor } : null }; })()`);
      console.log(`[capture] qr ${JSON.stringify(qrDiagnostic)}`);
    }
    fs.writeFileSync(path.join(outputDir, `${name}-1440x900.png`), (await win.capturePage()).toPNG());
    console.log(`[capture] modal ${name} ${JSON.stringify(modalRect)} -> ${path.join(outputDir, `${name}-1440x900.png`)}`);
    await win.webContents.executeJavaScript(`(() => {
      const target = document.querySelector(${JSON.stringify(selector)});
      target?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    })()`);
    await pause(120);
  };

  await navigateTo('visão geral');
  await captureModal('busca-global-modal', `document.querySelector('.header-search-wrap')?.click();`, '#cmdkOv');
  await captureModal('nova-extracao-modal', `document.querySelector('.btn-new-extraction')?.click();`, '.modal-overlay');

  await navigateTo('base de leads');
  await captureModal('exportar-leads-modal', `([...document.querySelectorAll('button')].find((node) => (node.textContent || '').trim() === 'Exportar'))?.click();`, '.overlay.on');
  await win.webContents.executeJavaScript(`document.querySelector('.base-leads-view tbody .rowcheck')?.click()`);
  await pause(100);
  await captureModal('criar-grupo-modal', `([...document.querySelectorAll('.selbar button')].find((node) => (node.textContent || '').includes('Criar grupo')))?.click();`, '.overlay.on');
  await captureModal('adicionar-grupo-modal', `([...document.querySelectorAll('.selbar button')].find((node) => (node.textContent || '').includes('Adicionar a grupo')))?.click();`, '.overlay.on');
  await captureModal('detalhe-lead-modal', `document.querySelector('.base-leads-view tbody td b')?.click();`, '.overlay.on');

  await navigateTo('lead scoring');
  await win.webContents.executeJavaScript(`(() => { const select = document.querySelector('#scGroupPick, .ls-open-design-step select'); const option = [...(select?.options || [])].find((item) => item.value); if (select && option) { select.value = option.value; select.dispatchEvent(new Event('change', { bubbles: true })); } })()`);
  await pause(180);
  await captureModal('configurar-ia-modal', `document.querySelector('#scCfgBtn')?.click();`, '#aiCfgOv');
  await captureModal('detalhe-scoring-modal', `document.querySelector('#scResults tbody td b')?.click();`, '.overlay.on');

  await navigateTo('kanban', 900);
  const globalKanban = await win.webContents.executeJavaScript(`(() => ({
    board: Boolean(document.querySelector('[data-od-id="global-kanban"]')),
    columns: document.querySelectorAll('.kanban-column').length,
    cards: document.querySelectorAll('.kanban-card').length,
    settings: Boolean([...document.querySelectorAll('button')].find((node) => (node.textContent || '').includes('Configurar Kanban'))),
  }))()`);
  if (!globalKanban.board || globalKanban.columns < 3 || globalKanban.cards < 3 || !globalKanban.settings) {
    errors.push(`Kanban geral não renderizou corretamente: ${JSON.stringify(globalKanban)}`);
  }
  fs.writeFileSync(path.join(outputDir, 'kanban-geral-1440x900.png'), (await win.capturePage()).toPNG());
  const globalMove = await win.webContents.executeJavaScript(`(() => {
    const select = document.querySelector('.kanban-card-move select');
    const card = select?.closest('.kanban-card');
    const name = card?.querySelector('.kanban-card-title strong')?.textContent || '';
    const next = [...(select?.options || [])].find((option) => option.value !== select.value)?.value;
    if (!select || !next) return null;
    select.value = next;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return { name, next };
  })()`);
  await pause(320);
  const globalMovePersisted = globalMove && await win.webContents.executeJavaScript(`(() => {
    const cards = [...document.querySelectorAll('.kanban-card')];
    const card = cards.find((node) => node.querySelector('.kanban-card-title strong')?.textContent === ${JSON.stringify(globalMove.name)});
    return card?.querySelector('.kanban-card-move select')?.value === ${JSON.stringify(globalMove.next)};
  })()`);
  if (!globalMove || !globalMovePersisted) errors.push('Kanban geral: movimento manual não persistiu visualmente');
  await win.webContents.executeJavaScript(`([...document.querySelectorAll('button')].find((node) => (node.textContent || '').includes('Configurar Kanban')))?.click()`);
  await pause(180);
  await win.webContents.executeJavaScript(`([...document.querySelectorAll('.kanban-settings-modal button')].find((node) => (node.textContent || '').trim() === 'Regra'))?.click()`);
  await pause(100);
  const ruleEditorVisible = await win.webContents.executeJavaScript(`document.querySelectorAll('.kanban-settings-modal .kanban-rule-editor').length === 1`);
  if (!ruleEditorVisible) errors.push('Kanban geral: regra de negócio não foi adicionada');
  fs.writeFileSync(path.join(outputDir, 'kanban-configuracao-1440x900.png'), (await win.capturePage()).toPNG());
  await win.webContents.executeJavaScript(`([...document.querySelectorAll('.kanban-settings-modal button')].find((node) => (node.textContent || '').includes('Salvar Kanban')))?.click()`);
  await pause(260);
  const ruleSaved = await win.webContents.executeJavaScript(`document.querySelectorAll('.kanban-rule-editor').length === 0 && /Configuração do Kanban salva/i.test(document.body.innerText)`);
  if (!ruleSaved) errors.push('Kanban geral: regra/configuração não foi salva');
  await captureModal('configurar-kanban-modal', `([...document.querySelectorAll('button')].find((node) => (node.textContent || '').includes('Configurar Kanban')))?.click();`, '.kanban-modal-overlay');

  await navigateTo('whatsapp', 800);
  await captureModal('nova-conversa-modal', `document.querySelector('[data-od-id="wa-new-chat"]')?.click();`, '#chatOv');
  await captureModal('nova-campanha-modal', `document.querySelector('[data-od-id="wa-new-campaign"]')?.click();`, '.camp-wizard-backdrop');
  await captureModal('campanhas-modal', `document.querySelector('[data-od-id="wa-sigma-campaigns"]')?.click();`, '.sigma-campaign-overlay');
  await win.webContents.executeJavaScript(`document.querySelector('[data-od-id="wa-account-selector"]')?.click()`);
  await pause(100);
  await captureModal('conexoes-modal', `([...document.querySelectorAll('.wa-menu button')].find((node) => (node.textContent || '').includes('Gerenciar conexões')))?.click();`, '#connOv');
  await win.webContents.executeJavaScript(`document.querySelector('[data-od-id="wa-session-menu"]')?.click()`);
  await pause(100);
  await captureModal('perfil-modal', `([...document.querySelectorAll('.wa-menu button')].find((node) => (node.textContent || '').includes('Meu perfil')))?.click();`, '#profileOv');
  await win.webContents.executeJavaScript(`document.querySelector('[data-od-id="wa-session-menu"]')?.click()`);
  await pause(100);
  await captureModal('qr-modal', `([...document.querySelectorAll('.wa-menu button')].find((node) => (node.textContent || '').includes('Trocar número')))?.click();`, '#qrOv');
  await win.webContents.executeJavaScript(`document.querySelector('.chat-thread')?.click()`);
  await pause(250);
  await win.webContents.executeJavaScript(`document.querySelector('.chat-bubble-action-btn[title="Mais"]')?.click()`);
  await pause(100);
  await captureModal('encaminhar-modal', `([...document.querySelectorAll('.chat-msg-menu button')].find((node) => (node.textContent || '').includes('Encaminhar')))?.click();`, '#fwdOv');
  await win.webContents.executeJavaScript(`document.querySelector('[data-od-id="wa-tab-status"]')?.click()`);
  await pause(150);
  await win.webContents.executeJavaScript(`(() => { const input = document.querySelector('#waStatusPost'); if (!input) return; const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(input, 'Fechamos 2 auditorias esta semana. Obrigado pela confiança!'); input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await pause(100);
  await win.webContents.executeJavaScript(`document.querySelector('.wa-statuspost button')?.click()`);
  await pause(150);
  await captureModal('status-modal', `document.querySelector('[data-od-id="wa-status-mine"]')?.click();`, '#statusOv');
  await win.webContents.executeJavaScript(`document.querySelector('[data-od-id="wa-tab-conversas"]')?.click()`);
  await pause(150);

  // Error handling: failures must stay inside the current flow and explain recovery.
  fixtureFailureState.startChat = true;
  await win.webContents.executeJavaScript(`document.querySelector('[data-od-id="wa-new-chat"]')?.click()`);
  await pause(150);
  await win.webContents.executeJavaScript(`document.querySelector('#chatOv .wa-newchat button')?.click()`);
  await pause(180);
  const newChatError = await win.webContents.executeJavaScript(`document.querySelector('#chatOv .field-err')?.textContent || ''`);
  if (!/Falha controlada/i.test(newChatError)) errors.push('Erro de nova conversa não ficou visível no modal');
  fs.writeFileSync(path.join(outputDir, 'error-nova-conversa-1440x900.png'), (await win.capturePage()).toPNG());
  await win.webContents.executeJavaScript(`document.querySelector('#chatOv')?.click()`);
  fixtureFailureState.startChat = false;

  fixtureFailureState.connect = true;
  await win.webContents.executeJavaScript(`document.querySelector('[data-od-id="wa-session-menu"]')?.click()`);
  await pause(80);
  await win.webContents.executeJavaScript(`([...document.querySelectorAll('.wa-menu button')].find((node) => (node.textContent || '').includes('Trocar número')))?.click()`);
  await pause(180);
  const qrFailure = await win.webContents.executeJavaScript(`document.querySelector('#qrOv .field-err')?.textContent || ''`);
  if (!/Não foi possível gerar o QR/i.test(qrFailure)) errors.push('Erro de QR não ficou visível no modal');
  fs.writeFileSync(path.join(outputDir, 'error-qr-1440x900.png'), (await win.capturePage()).toPNG());
  await win.webContents.executeJavaScript(`document.querySelector('#qrOv')?.click()`);
  fixtureFailureState.connect = false;

  fixtureFailureState.createCampaign = true;
  await win.webContents.executeJavaScript(`document.querySelector('[data-od-id="wa-new-campaign"]')?.click()`);
  await pause(450);
  for (let step = 0; step < 4; step += 1) {
    await win.webContents.executeJavaScript(`document.querySelector('.camp-wizard-footer .btn-primary')?.click()`);
    await pause(180);
  }
  const campaignFailure = await win.webContents.executeJavaScript(`document.querySelector('.camp-alert.error')?.textContent || ''`);
  if (!/Falha controlada/i.test(campaignFailure)) errors.push('Erro de campanha não ficou visível no wizard');
  fs.writeFileSync(path.join(outputDir, 'error-campanha-1440x900.png'), (await win.capturePage()).toPNG());
  await win.webContents.executeJavaScript(`document.querySelector('.camp-wizard-backdrop')?.click()`);
  fixtureFailureState.createCampaign = false;
  await pause(150);

  await win.webContents.executeJavaScript(`([...document.querySelectorAll('.app-sidebar .nav-item')].find((node) => (node.textContent || '').toLowerCase().includes('whatsapp')))?.click()`);
  await pause(600);
  await win.webContents.executeJavaScript(`([...document.querySelectorAll('.wa-open-design-actions button')].find((node) => (node.textContent || '').includes('Campanhas')))?.click()`);
  await pause(250);
  fs.writeFileSync(path.join(outputDir, 'whatsapp-campaigns-1440x900.png'), (await win.capturePage()).toPNG());
  const kanbanOpened = await win.webContents.executeJavaScript(`(() => {
    const button = [...document.querySelectorAll('.camp-card-actions button')]
      .find((node) => (node.textContent || '').includes('Kanban'));
    button?.click();
    return !!button;
  })()`);
  if (!kanbanOpened) errors.push('Kanban: botão não encontrado');
  await pause(250);
  const kanbanDiagnostic = await win.webContents.executeJavaScript(`(() => ({
    board: !!document.querySelector('.campaign-kanban-layer'),
    columns: [...document.querySelectorAll('.campaign-kanban-column')].map((column) => ({
      stage: [...column.classList].find((name) => name.startsWith('stage-')),
      cards: column.querySelectorAll('.campaign-kanban-card').length,
    })),
  }))()`);
  if (!kanbanDiagnostic.board || kanbanDiagnostic.columns.length !== 3) {
    errors.push('Kanban: painel ou três etapas não renderizados');
  }
  fs.writeFileSync(path.join(outputDir, 'whatsapp-campaign-kanban-1440x900.png'), (await win.capturePage()).toPNG());
  const moved = await win.webContents.executeJavaScript(`(() => {
    const select = [...document.querySelectorAll('.campaign-kanban-card select')]
      .find((node) => node.value === 'new');
    if (!select) return false;
    select.value = 'conversation';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  if (!moved) errors.push('Kanban: seletor de movimento não encontrado');
  await pause(250);
  const movedCount = await win.webContents.executeJavaScript(`document.querySelectorAll('.campaign-kanban-column.stage-conversation .campaign-kanban-card').length`);
  if (moved && movedCount !== 2) errors.push(`Kanban: movimento não persistiu (esperado 2, recebido ${movedCount})`);
  await win.webContents.executeJavaScript(`document.querySelector('.campaign-kanban-header .btn-secondary')?.click()`);
  await pause(150);
  await win.webContents.executeJavaScript(`document.querySelector('.sigma-campaign-dialog .btn-primary')?.click()`);
  await pause(350);
  fs.writeFileSync(path.join(outputDir, 'whatsapp-campaign-wizard-1440x900.png'), (await win.capturePage()).toPNG());
  await win.webContents.executeJavaScript(`document.querySelector('.camp-wizard-close')?.click()`);
  await win.webContents.executeJavaScript(`document.querySelector('.sigma-campaign-head-actions .wa-icon-button')?.click()`);
  fixtureConnectionState.connected = false;
  await win.webContents.executeJavaScript(`([...document.querySelectorAll('.app-sidebar .nav-item')].find((node) => (node.textContent || '').toLowerCase().includes('base de leads')))?.click()`);
  await pause(700);
  await win.webContents.executeJavaScript(`([...document.querySelectorAll('.app-sidebar .nav-item')].find((node) => (node.textContent || '').toLowerCase().includes('whatsapp')))?.click()`);
  await pause(1200);
  const offlineWizardOpened = await win.webContents.executeJavaScript(`(() => {
    const button = [...document.querySelectorAll('.wa-open-design-actions button')]
      .find((node) => (node.textContent || '').includes('Nova campanha'));
    button?.click();
    return !!button;
  })()`);
  if (!offlineWizardOpened) errors.push('Rascunho offline: botão Nova campanha não encontrado');
  await pause(250);
  const offlineDraftVisible = await win.webContents.executeJavaScript(`!!document.querySelector('.camp-alert')`);
  if (!offlineDraftVisible) errors.push('Rascunho offline: aviso de conexão não renderizado');
  fs.writeFileSync(path.join(outputDir, 'whatsapp-campaign-offline-draft-1440x900.png'), (await win.capturePage()).toPNG());
  await win.webContents.executeJavaScript(`document.querySelector('.camp-wizard-close')?.click()`);
  await win.webContents.executeJavaScript(`document.querySelector('.sigma-campaign-head-actions .wa-icon-button')?.click()`);

  // Regressão do mapa: todos os leads com coordenada devem ter marcador, sem
  // corte invisível em 100 itens; registros antigos também são normalizados.
  await navigateTo('scraper maps', 900);
  await win.webContents.executeJavaScript(`(() => {
    const base = ${JSON.stringify(fixtureLeads)};
    const stress = Array.from({ length: 125 }, (_, index) => ({
      id: 'map-stress-' + index,
      name: 'Lead de mapa ' + index,
      category: 'Teste',
      address: index === 0 ? '\\uE0C8Rua São João, 10, Rio de Janeiro, RJ' : 'Rua de teste, ' + (index + 1) + ', Rio de Janeiro, RJ',
      city: 'Rio de Janeiro',
      state: 'RJ',
      latitude: -22.98 + (index % 20) * 0.0001,
      longitude: -43.20 + (index % 20) * 0.0001,
      coordSource: 'poi',
    }));
    localStorage.setItem('sigma_leads', JSON.stringify([...base, ...stress, ...Array.from({ length: 29 }, (_, index) => ({
      id: 'map-dirty-no-coords-' + index,
      name: 'Endereco antigo sem coordenada ' + index,
      category: 'Teste',
      address: '\\uE0C8Rua Sao Joao, ' + (12 + index) + ', Rio de Janeiro, RJ',
      city: 'Rio de Janeiro',
      state: 'RJ',
    })), {
      id: 'map-dirty-no-coords',
      name: 'Endereço antigo sem coordenada',
      category: 'Teste',
      address: '\\uE0C8Rua São João, 11, Rio de Janeiro, RJ',
      city: 'Rio de Janeiro',
      state: 'RJ',
    }]));
    window.dispatchEvent(new Event('sigma:leads-updated'));
  })()`);
  await pause(1300);
  const mapStress = await win.webContents.executeJavaScript(`(() => {
    const saved = JSON.parse(localStorage.getItem('sigma_leads') || '[]');
    return {
      markers: document.querySelectorAll('#realMap .lp').length,
      dirtyAddress: saved.find((lead) => lead.id === 'map-dirty-no-coords')?.address || '',
      dirtyAddressRepaired: saved.find((lead) => lead.id === 'map-dirty-no-coords')?.needsMapAddressRepair === false,
      repairedDirtyAddresses: saved.filter((lead) => String(lead.id || '').startsWith('map-dirty-no-coords')).filter((lead) => lead.needsMapAddressRepair === false && Number.isFinite(Number(lead.latitude)) && Number.isFinite(Number(lead.longitude))).length,
      repairRequests: ${fixtureMapRepairRequests},
      map: (() => { const node = document.querySelector('#realMap'); const box = node?.getBoundingClientRect(); return box ? { width: Math.round(box.width), height: Math.round(box.height) } : null; })(),
    };
  })()`);
  if (mapStress.markers < 158) errors.push(`Mapa: corte de marcadores detectado (${mapStress.markers}/158)`);
  if (/^[\s\p{Cc}\p{Cf}\p{Co}\u{1F4CD}\u{FE0E}\u{FE0F}]/u.test(mapStress.dirtyAddress)) errors.push('Mapa: endereço antigo com prefixo especial não foi corrigido');
  if (!mapStress.dirtyAddressRepaired || mapStress.repairedDirtyAddresses < 30 || mapStress.repairRequests < 30) errors.push('Mapa: lote completo de endereços antigos sem coordenadas não foi reparado');
  fs.writeFileSync(path.join(outputDir, 'mapa-158-marcadores-1440x900.png'), (await win.capturePage()).toPNG());
  await win.webContents.executeJavaScript(`localStorage.setItem('sigma_leads', ${JSON.stringify(JSON.stringify(fixtureLeads))}); window.dispatchEvent(new Event('sigma:leads-updated'));`);
  await pause(450);

  fixtureFailureState.mapRepair = true;
  await win.webContents.executeJavaScript(`localStorage.setItem('sigma_leads', JSON.stringify([{ id: 'map-repair-failure', name: 'Teste de falha', address: '\\uE0C8Rua Teste, 1, Rio de Janeiro, RJ', city: 'Rio de Janeiro', state: 'RJ' }])); window.dispatchEvent(new Event('sigma:leads-updated'));`);
  await pause(350);
  const mapRepairFailure = await win.webContents.executeJavaScript(`document.querySelector('.toast-warning .toast-message')?.textContent || ''`);
  if (!/não puderam ser geocodificados/i.test(mapRepairFailure)) errors.push('Mapa: falha de geocoding não ficou visível para recuperação');
  fixtureFailureState.mapRepair = false;
  await win.webContents.executeJavaScript(`localStorage.setItem('sigma_leads', ${JSON.stringify(JSON.stringify(fixtureLeads))}); window.dispatchEvent(new Event('sigma:leads-updated'));`);
  await pause(220);

  // O Leaflet não pode executar callbacks atrasados após o unmount da rota.
  const errorsBeforeRapidMapNavigation = errors.length;
  await navigateTo('scraper maps', 20);
  await navigateTo('kanban', 20);
  await pause(240);
  if (errors.slice(errorsBeforeRapidMapNavigation).some((error) => /leaflet_pos|invalidateSize/i.test(error))) {
    errors.push('Mapa: callback do Leaflet falhou ao trocar de rota rapidamente');
  }

  const desktopViewports = [];
  const inspectDesktop = async ({ width, height, label, route, file }) => {
    win.setSize(width, height);
    await pause(260);
    await navigateTo(label, route === 'whatsapp' ? 850 : 700);
    if (route === 'whatsapp') {
      await win.webContents.executeJavaScript(`document.querySelector('.chat-thread')?.click()`);
      await pause(220);
    }
    const diagnostic = await win.webContents.executeJavaScript(`(() => {
      const rect = (selector) => {
        const node = document.querySelector(selector);
        if (!node) return null;
        const box = node.getBoundingClientRect();
        return { width: Math.round(box.width), height: Math.round(box.height) };
      };
      const visible = (node) => {
        if (!node) return false;
        const style = getComputedStyle(node);
        const box = node.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0;
      };
      return {
        viewport: String(window.innerWidth) + 'x' + String(window.innerHeight),
        scrollWidth: document.documentElement.scrollWidth,
        noGlobalHorizontalOverflow: document.documentElement.scrollWidth <= window.innerWidth + 1,
        windowControls: [...document.querySelectorAll('.window-control-buttons .win-btn')].filter(visible).length,
        windowControlDetails: [...document.querySelectorAll('.window-control-buttons .win-btn')].map((node) => {
          const box = node.getBoundingClientRect();
          const icon = node.querySelector('svg');
          const iconBox = icon?.getBoundingClientRect();
          return {
            x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height),
            color: getComputedStyle(node).color, opacity: getComputedStyle(node).opacity,
            iconWidth: Math.round(iconBox?.width || 0), iconHeight: Math.round(iconBox?.height || 0),
          };
        }),
        kanbanColumns: document.querySelectorAll('.kanban-column').length,
        map: rect('#realMap'),
        mapMarkers: document.querySelectorAll('#realMap .lp').length,
        chatShell: rect('.chat-shell'),
        chatList: rect('.chat-list'),
        chatRoom: rect('.chat-room'),
      };
    })()`);
    desktopViewports.push({ requested: `${width}x${height}`, route, ...diagnostic });
    if (!diagnostic.noGlobalHorizontalOverflow || diagnostic.windowControls !== 3) {
      errors.push(`Desktop ${width}x${height}/${route}: overflow ou controles de janela ausentes (${JSON.stringify(diagnostic)})`);
    }
    if (route === 'kanban' && diagnostic.kanbanColumns < 3) errors.push(`Desktop ${width}x${height}/kanban: colunas insuficientes`);
    if (route === 'scraper' && (!diagnostic.map || diagnostic.map.width < 450 || diagnostic.map.height < 280 || diagnostic.mapMarkers < 3)) {
      errors.push(`Desktop ${width}x${height}/mapa: área ou marcadores inválidos (${JSON.stringify(diagnostic)})`);
    }
    if (route === 'whatsapp' && (!diagnostic.chatShell || !diagnostic.chatList || !diagnostic.chatRoom || diagnostic.chatList.width < 220 || diagnostic.chatRoom.width < 320)) {
      errors.push(`Desktop ${width}x${height}/WhatsApp: painel de conversa inválido (${JSON.stringify(diagnostic)})`);
    }
    fs.writeFileSync(path.join(outputDir, file), (await win.capturePage()).toPNG());
  };
  await inspectDesktop({ width: 1024, height: 768, label: 'kanban', route: 'kanban', file: 'desktop-1024x768-kanban.png' });
  await inspectDesktop({ width: 1440, height: 900, label: 'scraper maps', route: 'scraper', file: 'desktop-1440x900-mapa.png' });
  await inspectDesktop({ width: 1920, height: 1080, label: 'whatsapp', route: 'whatsapp', file: 'desktop-1920x1080-whatsapp.png' });

  const finalCapture = await win.capturePage();
  const viewport = finalCapture.getSize();
  const report = {
    generatedAt: new Date().toISOString(),
    version: require('../package.json').version,
    desktopOnly: true,
    viewport: `${viewport.width}x${viewport.height}`,
    routes: 8,
    modals: 17,
    controlledErrorScenarios: 4,
    functionalScenarios: 4,
    desktopViewports,
    errors,
    passed: errors.length === 0,
  };
  fs.writeFileSync(path.join(outputDir, 'qa-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ outputDir, ...report }, null, 2));
  win.destroy();
  app.exit(errors.length ? 1 : 0);
});

app.on('window-all-closed', () => app.quit());
