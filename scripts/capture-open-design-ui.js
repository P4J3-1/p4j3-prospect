/**
 * Renderiza as rotas principais em um BrowserWindow isolado e salva evidência visual.
 * Não usa dados/sessões reais: todos os IPCs de leitura são mocks determinísticos.
 */
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const outputDir = path.join(__dirname, '..', 'docs', 'qa', 'open-design-lote1');
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
  'lead-scoring-get-all': { success: true, leads: [], total: 0, stats: { total: 0, highPriority: 0, goodOpportunity: 0, responded: 0, closed: 0, closedValue: 0 } },
  'lead-scoring-list-groups': { success: true, groups: [{ id: 'group-demo', name: 'Odontologia · Zona Sul', count: 2, color: '#10a37f' }] },
  'lead-scoring-get-settings': { success: true, settings: { ai: { provider: 'opencode', model: 'deepseek-v4-flash-free', hasApiKey: true } } },
};

Object.entries(mocks).forEach(([channel, value]) => {
  ipcMain.handle(channel, () => value);
});

ipcMain.handle('whatsapp-status', () => ({
  status: fixtureConnectionState.connected ? 'connected' : 'disconnected',
  connectionId: 'sigma-main',
}));
ipcMain.handle('whatsapp-list-connections', () => ({
  connections: [{
    id: 'sigma-main',
    phoneNumber: '+55 21 90000-0001',
    status: fixtureConnectionState.connected ? 'connected' : 'disconnected',
    provider: 'baileys',
    active: true,
  }],
}));

ipcMain.handle('campaign-update', (_event, { id, updates }) => {
  const campaign = fixtureCampaigns.find((item) => item.id === id);
  if (!campaign) return { success: false, error: 'Campanha não encontrada no fixture' };
  if (Array.isArray(updates?.leads)) campaign.leads = updates.leads;
  return { success: true, campaign };
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

  for (const route of ['overview', 'scraper', 'base', 'scoring', 'whatsapp', 'dashboard', 'settings']) {
    await win.webContents.executeJavaScript(`location.hash = '#${route}'; window.dispatchEvent(new HashChangeEvent('hashchange'));`);
    const targetLabel = ({ overview: 'visão geral', scraper: 'scraper maps', base: 'base de leads', scoring: 'lead scoring', whatsapp: 'whatsapp', dashboard: 'dashboard', settings: 'configurações' })[route];
    const navResult = await win.webContents.executeJavaScript(`(() => {
      const item = [...document.querySelectorAll('.app-sidebar .nav-item')]
        .find((node) => (node.textContent || '').toLowerCase().includes(${JSON.stringify(targetLabel)}));
      if (item) item.click();
      return { found: !!item, title: item?.textContent?.trim() || '' };
    })()`);
    await pause(route === 'scraper' || route === 'whatsapp' ? 1200 : 600);
    if (route === 'overview') {
      await win.webContents.executeJavaScript(`document.querySelector('.overview-metrics button[title^="Mensagens enviadas"]')?.click()`);
      await pause(200);
    }
    if (route === 'scoring') {
      await win.webContents.executeJavaScript(`(() => { const select = document.querySelector('.ls-open-design-step select'); if (select) { select.value = 'group:group-demo'; select.dispatchEvent(new Event('change', { bubbles: true })); } })()`);
      await pause(200);
    }
    if (route === 'whatsapp') {
      await win.webContents.executeJavaScript(`document.querySelector('.chat-thread')?.click()`);
      await pause(300);
    }
    const diagnostic = await win.webContents.executeJavaScript(`(() => {
      const view = document.querySelector('.view-transition');
      const child = view?.firstElementChild;
      const rect = (node) => node ? Object.fromEntries(['x','y','width','height'].map((key) => [key, Math.round(node.getBoundingClientRect()[key])])) : null;
      const flow = document.querySelector('.ls-open-design-steps');
      return { active: document.querySelector('.app-sidebar .nav-item.active')?.textContent?.trim(), view: rect(view), child: rect(child), flow: rect(flow), flowDisplay: flow ? getComputedStyle(flow).display : null, childClass: child?.className || '', text: (child?.innerText || '').slice(0, 80) };
    })()`);
    const image = await win.capturePage();
    const file = path.join(outputDir, `${route}-1440x900.png`);
    fs.writeFileSync(file, image.toPNG());
    console.log(`[capture] ${route}: ${navResult.found ? 'ok' : 'fallback'} ${JSON.stringify(diagnostic)} -> ${file}`);
  }

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

  await win.webContents.executeJavaScript(`document.querySelector('.btn-new-extraction')?.click()`);
  await pause(400);
  fs.writeFileSync(path.join(outputDir, 'nova-extracao-modal-1440x900.png'), (await win.capturePage()).toPNG());
  await win.webContents.executeJavaScript(`document.querySelector('.modal-close-btn')?.click()`);

  win.setContentSize(390, 844);
  await pause(400);
  for (const [route, label] of [['overview', 'visão geral'], ['scraper', 'scraper maps']]) {
    await win.webContents.executeJavaScript(`([...document.querySelectorAll('.app-sidebar .nav-item')].find((node) => (node.textContent || '').toLowerCase().includes(${JSON.stringify(label)})))?.click()`);
    await pause(route === 'scraper' ? 900 : 500);
    fs.writeFileSync(path.join(outputDir, `${route}-390x844.png`), (await win.capturePage()).toPNG());
    console.log(`[capture] ${route} mobile -> ${path.join(outputDir, `${route}-390x844.png`)}`);
  }

  console.log(JSON.stringify({ outputDir, errors }, null, 2));
  app.exit(errors.length ? 1 : 0);
});

app.on('window-all-closed', () => app.quit());
