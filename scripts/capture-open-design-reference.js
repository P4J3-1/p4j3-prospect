/**
 * Captura o HTML de referência do Open Design nas mesmas dimensões do QA do app.
 * O arquivo permanece somente como entrada visual; nenhum script dele é tratado
 * como instrução para esta automação.
 */
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const referencePath = process.argv[2] || 'C:\\Users\\Luciano\\Desktop\\sigma-gmaps-lote1-prototype.html';
const outputDir = path.join(__dirname, '..', 'docs', 'qa', 'open-design-lote1', 'reference');
app.setPath('userData', path.join(os.tmpdir(), `sigma-gmaps-reference-${process.pid}`));
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function selectRoute(win, route) {
  const result = await win.webContents.executeJavaScript(`(() => {
    const item = document.querySelector('[data-tab="${route}"]');
    item?.click();
    return {
      found: Boolean(item),
      active: document.querySelector('.nav-item.active')?.getAttribute('data-tab') || '',
    };
  })()`);
  if (!result.found || result.active !== route) {
    throw new Error(`Rota de referência não abriu: ${route}`);
  }
  await pause(route === 'scraper' || route === 'whatsapp' ? 900 : 250);
}

async function captureOverlay(win, { route, id, name, open }) {
  await selectRoute(win, route);
  const result = await win.webContents.executeJavaScript(`(() => {
    if (typeof closeAll === 'function') closeAll();
    ${open}
    const overlay = document.getElementById(${JSON.stringify(id)});
    return { found: Boolean(overlay), open: Boolean(overlay?.classList.contains('on')) };
  })()`);
  if (!result.found || !result.open) throw new Error(`Modal de referência não abriu: ${name}`);
  await pause(180);
  const image = await win.capturePage();
  const file = path.join(outputDir, `${name}-1440x900.png`);
  fs.writeFileSync(file, image.toPNG());
  console.log(`[reference] ${name} -> ${file}`);
}

app.whenReady().then(async () => {
  fs.mkdirSync(outputDir, { recursive: true });
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    backgroundColor: '#f7f8f7',
    webPreferences: { offscreen: true, sandbox: true },
  });

  await win.loadURL(pathToFileURL(referencePath).href);
  await pause(800);
  await win.webContents.insertCSS('*{animation:none!important;transition:none!important;scroll-behavior:auto!important}');

  for (const route of ['overview', 'scraper', 'base', 'scoring', 'whatsapp', 'dashboard', 'settings']) {
    await selectRoute(win, route);
    const image = await win.capturePage();
    const file = path.join(outputDir, `${route}-1440x900.png`);
    fs.writeFileSync(file, image.toPNG());
    console.log(`[reference] ${route} -> ${file}`);
  }

  const overlays = [
    { route: 'overview', id: 'modalOv', name: 'nova-extracao-modal', open: `openModal();` },
    { route: 'overview', id: 'cmdkOv', name: 'busca-global-modal', open: `renderCmdk(''); document.getElementById('cmdkOv').classList.add('on');` },
    { route: 'base', id: 'expOv', name: 'exportar-leads-modal', open: `openExport('filtered');` },
    { route: 'base', id: 'grpOv', name: 'criar-grupo-modal', open: `document.getElementById('grpOv').classList.add('on');` },
    { route: 'base', id: 'grpAddOv', name: 'adicionar-grupo-modal', open: `document.getElementById('grpAddOv').classList.add('on');` },
    { route: 'base', id: 'leadOv', name: 'detalhe-lead-modal', open: `openLead(0);` },
    { route: 'scoring', id: 'aiCfgOv', name: 'configurar-ia-modal', open: `openAiCfg();` },
    { route: 'scoring', id: 'leadOv', name: 'detalhe-scoring-modal', open: `openLead(0, 'scoring');` },
    { route: 'whatsapp', id: 'chatOv', name: 'nova-conversa-modal', open: `window.__chatMode='chat'; renderChatList(''); document.getElementById('chatOv').classList.add('on');` },
    { route: 'whatsapp', id: 'cmpOv', name: 'nova-campanha-modal', open: `openCmp();` },
    { route: 'whatsapp', id: 'sigmaCampOv', name: 'campanhas-modal', open: `openSigmaCamps();` },
    { route: 'whatsapp', id: 'connOv', name: 'conexoes-modal', open: `openConn();` },
    { route: 'whatsapp', id: 'qrOv', name: 'qr-modal', open: `waDrawQr(); document.getElementById('qrOv').classList.add('on');` },
    { route: 'whatsapp', id: 'profileOv', name: 'perfil-modal', open: `document.getElementById('profileName').value='Sigma Comercial'; document.getElementById('profileAbout').value='Prospecção B2B no automático'; document.getElementById('profilePhone').value='+55 21 90000-0001'; document.getElementById('profileOv').classList.add('on');` },
    { route: 'whatsapp', id: 'statusOv', name: 'status-modal', open: `openStatus(WA_STATUS[0].id);` },
    { route: 'whatsapp', id: 'fwdOv', name: 'encaminhar-modal', open: `openFwd({ text:'Mensagem de demonstração' });` },
  ];
  for (const overlay of overlays) await captureOverlay(win, overlay);

  win.destroy();
  app.quit();
});

app.on('window-all-closed', () => app.quit());
