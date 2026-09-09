/**
 * Renderiza as rotas principais em um BrowserWindow isolado e salva evidência visual.
 * Não usa dados/sessões reais: todos os IPCs de leitura são mocks determinísticos.
 */
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const outputDir = path.join(__dirname, '..', 'docs', 'qa', 'open-design-lote1');
app.setPath('userData', path.join(os.tmpdir(), `sigma-gmaps-qa-${process.pid}`));
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
const fixtureFailureState = { connect: false, startChat: false, createCampaign: false };

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

  const finalCapture = await win.capturePage();
  const viewport = finalCapture.getSize();
  const report = {
    generatedAt: new Date().toISOString(),
    version: require('../package.json').version,
    desktopOnly: true,
    viewport: `${viewport.width}x${viewport.height}`,
    routes: 7,
    modals: 16,
    controlledErrorScenarios: 3,
    errors,
    passed: errors.length === 0,
  };
  fs.writeFileSync(path.join(outputDir, 'qa-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ outputDir, ...report }, null, 2));
  win.destroy();
  app.exit(errors.length ? 1 : 0);
});

app.on('window-all-closed', () => app.quit());
