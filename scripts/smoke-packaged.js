/** Smoke test do executável Windows já empacotado. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { _electron: electron } = require('playwright');

const packageVersion = require('../package.json').version;
const executablePath = path.resolve(process.argv[2] || path.join(__dirname, '..', 'dist', 'win-unpacked', 'Sigma GMaps Scraper.exe'));
const outputFile = path.resolve(process.argv[3] || path.join(__dirname, '..', 'docs', 'qa', 'open-design-lote1', `packaged-v${packageVersion}-smoke.png`));
const profilePath = fs.mkdtempSync(path.join(os.tmpdir(), 'sigma-gmaps-packaged-qa-'));
const errors = [];

(async () => {
  if (!fs.existsSync(executablePath)) throw new Error(`Executável não encontrado: ${executablePath}`);
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });

  const app = await electron.launch({
    executablePath,
    args: [`--user-data-dir=${profilePath}`],
    env: { ...process.env, SIGMA_QA: '1', SIGMA_QA_USER_DATA: profilePath },
    timeout: 45000,
  });

  try {
    const page = await app.firstWindow({ timeout: 45000 });
    page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error' && !/Electron Security Warning/i.test(message.text())) errors.push(`console: ${message.text()}`);
    });

    await page.waitForSelector('.app-layout-root', { timeout: 30000 });
    await page.evaluate(() => {
      localStorage.setItem('sigma_onboarding_done', '1');
      localStorage.setItem('sigma_ls_ai_onboard_skipped', '1');
      localStorage.setItem('sigma_leads', JSON.stringify([{
        id: 'packaged-dirty-address',
        name: 'Lead com endereço antigo',
        category: 'Teste',
        address: '\uE0C8Rua São João, 10, Rio de Janeiro, RJ',
        city: 'Rio de Janeiro',
        state: 'RJ',
        latitude: -22.985,
        longitude: -43.205,
        coordSource: 'poi',
      }]));
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.app-layout-root', { timeout: 30000 });

    const baseNav = page.locator('.app-sidebar .nav-item').filter({ hasText: 'Base de Leads' });
    await baseNav.click();
    await page.waitForSelector('.base-leads-view', { timeout: 15000 });
    const activeRoute = await page.locator('.app-sidebar .nav-item.active').innerText();
    if (!/Base de Leads/i.test(activeRoute)) errors.push(`Navegação não ativou Base de Leads: ${activeRoute}`);

    await page.locator('.header-search-wrap').click();
    await page.waitForSelector('#cmdkOv [role="dialog"]', { state: 'visible', timeout: 10000 });
    await page.keyboard.press('Escape');
    await page.waitForSelector('#cmdkOv', { state: 'detached', timeout: 10000 });

    const mapNav = page.locator('.app-sidebar .nav-item').filter({ hasText: 'Scraper Maps' });
    await mapNav.click();
    await page.waitForSelector('#realMap', { timeout: 15000 });
    await page.waitForFunction(() => document.querySelectorAll('#realMap .lp').length >= 1, null, { timeout: 15000 });
    const mapResult = await page.evaluate(() => {
      const lead = JSON.parse(localStorage.getItem('sigma_leads') || '[]').find((item) => item.id === 'packaged-dirty-address');
      return { address: lead?.address || '', markers: document.querySelectorAll('#realMap .lp').length };
    });
    if (!mapResult.address || /^[\s\p{Cc}\p{Cf}\p{Co}\u{1F4CD}\u{FE0E}\u{FE0F}]/u.test(mapResult.address) || mapResult.markers < 1) {
      errors.push(`Mapa não normalizou/renderizou lead empacotado: ${JSON.stringify(mapResult)}`);
    }

    const kanbanNav = page.locator('.app-sidebar .nav-item').filter({ hasText: 'Kanban' });
    await kanbanNav.click();
    await page.waitForSelector('[data-od-id="global-kanban"]', { timeout: 15000 });
    const kanbanResult = await page.evaluate(() => ({
      columns: document.querySelectorAll('.kanban-column').length,
      cards: document.querySelectorAll('.kanban-card').length,
      hasConfig: Boolean([...document.querySelectorAll('button')].find((node) => (node.textContent || '').includes('Configurar Kanban'))),
    }));
    if (kanbanResult.columns < 3 || kanbanResult.cards < 1 || !kanbanResult.hasConfig) {
      errors.push(`Kanban empacotado não carregou: ${JSON.stringify(kanbanResult)}`);
    }

    const whatsappNav = page.locator('.app-sidebar .nav-item').filter({ hasText: 'WhatsApp' });
    await whatsappNav.click();
    await page.waitForSelector('.wa-open-design', { timeout: 15000 });
    const whatsappResult = await page.evaluate(() => [...document.querySelectorAll('.window-control-buttons .win-btn')]
      .filter((node) => {
        const style = getComputedStyle(node);
        const box = node.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0;
      }).length);
    if (whatsappResult !== 3) errors.push(`WhatsApp empacotado não preservou os 3 controles de janela: ${whatsappResult}`);

    await page.addStyleTag({ content: '*{animation:none!important;transition:none!important}' });
    await page.screenshot({ path: outputFile });

    const result = {
      executablePath,
      version: await app.evaluate(({ app: electronApp }) => electronApp.getVersion()),
      title: await page.title(),
      activeRoute: activeRoute.trim(),
      commandPaletteOpenedAndClosed: true,
      mapResult,
      kanbanResult,
      whatsappWindowControls: whatsappResult,
      screenshot: outputFile,
      errors,
      passed: errors.length === 0,
    };
    console.log(JSON.stringify(result, null, 2));
    if (errors.length) process.exitCode = 1;
  } finally {
    await app.close();
    const tempRoot = path.resolve(os.tmpdir());
    const resolvedProfile = path.resolve(profilePath);
    if (resolvedProfile.startsWith(`${tempRoot}${path.sep}`)) fs.rmSync(resolvedProfile, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
