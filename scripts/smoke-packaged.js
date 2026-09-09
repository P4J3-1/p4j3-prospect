/** Smoke test do executável Windows já empacotado. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { _electron: electron } = require('playwright');

const executablePath = path.resolve(process.argv[2] || path.join(__dirname, '..', 'dist', 'win-unpacked', 'Sigma GMaps Scraper.exe'));
const outputFile = path.resolve(process.argv[3] || path.join(__dirname, '..', 'docs', 'qa', 'open-design-lote1', 'packaged-v1.1.5-base.png'));
const profilePath = fs.mkdtempSync(path.join(os.tmpdir(), 'sigma-gmaps-packaged-qa-'));
const errors = [];

(async () => {
  if (!fs.existsSync(executablePath)) throw new Error(`Executável não encontrado: ${executablePath}`);
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });

  const app = await electron.launch({
    executablePath,
    args: [`--user-data-dir=${profilePath}`],
    env: { ...process.env, SIGMA_QA: '1' },
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

    await page.addStyleTag({ content: '*{animation:none!important;transition:none!important}' });
    await page.screenshot({ path: outputFile });

    const result = {
      executablePath,
      version: await app.evaluate(({ app: electronApp }) => electronApp.getVersion()),
      title: await page.title(),
      activeRoute: activeRoute.trim(),
      commandPaletteOpenedAndClosed: true,
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
