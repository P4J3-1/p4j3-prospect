#!/usr/bin/env node
/**
 * Auditoria de usabilidade do P4J3 (base do agente p4j3-auditor).
 *
 * Abre o app numa CÓPIA dos dados (sem sessões do WhatsApp, sem chave de IA,
 * piloto desligado), percorre todas as telas em dois tamanhos de janela e mede:
 * tempo de carga, rolagem travada/conteúdo cortado, botões inalcançáveis,
 * erros no console, letra pequena e texto com pouco contraste.
 *
 * Uso:  node scripts/audit-ux.js            (relatório em audit/ux-report.md)
 *       SCREENS=scraper,whatsapp node scripts/audit-ux.js
 */
const { _electron } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repo = path.resolve(__dirname, '..');
const real = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'sigma-gmaps-scraper');
const outDir = path.join(repo, 'audit');
const ROUTES = (process.env.SCREENS || 'overview,scraper,base,whatsapp,kanban,agents,ai,settings').split(',');
const VIEWPORTS = [[1366, 768], [1920, 1080]];
// Só dados de negócio: nunca sessões do WhatsApp nem chaves.
const COPY = ['sigma-leads.json', 'contact-status.json', 'kanban.json', 'lead-memory.json', 'lead-triage.json', 'send-queue.json', 'agents.json', 'do-not-contact.json', 'contact-labels.json'];

function prepareUserData() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p4j3-audit-'));
  for (const f of COPY) if (fs.existsSync(path.join(real, f))) fs.copyFileSync(path.join(real, f), path.join(dir, f));
  const ap = path.join(real, 'autopilot.json');
  if (fs.existsSync(ap)) {
    const data = JSON.parse(fs.readFileSync(ap, 'utf8'));
    if (data.settings) data.settings.enabled = false;
    fs.writeFileSync(path.join(dir, 'autopilot.json'), JSON.stringify(data));
  }
  return dir;
}

/** Roda dentro da página: mede problemas de uso da tela atual. */
function inspect() {
  const vh = window.innerHeight;
  const vw = window.innerWidth;
  const label = (el) => {
    const id = el.id ? `#${el.id}` : '';
    const cls = typeof el.className === 'string' && el.className.trim() ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}` : '';
    const text = (el.innerText || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    return `${el.tagName.toLowerCase()}${id}${cls}${text ? ` "${text}"` : ''}`;
  };
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05;
  };
  const all = [...document.querySelectorAll('body *')].filter((el) => !el.closest('.leaflet-container, .jv-console, .jv-fab, svg'));
  // Desce todos os roláveis até o fim (como o usuário faria).
  for (const el of all) {
    const cs = getComputedStyle(el);
    if (/(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 4) el.scrollTop = el.scrollHeight;
  }
  window.scrollTo(0, document.body.scrollHeight);

  const clipped = [];
  for (const el of all) {
    if (!visible(el)) continue;
    const cs = getComputedStyle(el);
    const hidden = /(hidden|clip)/.test(cs.overflowY);
    // Só conteúdo real: ignora decoração posicionada (fundos, brilhos) e aria-hidden.
    const inFlow = [...el.children].filter((c) => !/(absolute|fixed)/.test(getComputedStyle(c).position) && c.getAttribute('aria-hidden') !== 'true');
    const contentBottom = Math.max(0, ...inFlow.map((c) => c.getBoundingClientRect().bottom));
    const cut = Math.min(el.scrollHeight - el.clientHeight, Math.round(contentBottom - el.getBoundingClientRect().bottom));
    if (hidden && cut > 24 && el.clientHeight >= 100 && !/-webkit-box/.test(cs.display)) {
      const r = el.getBoundingClientRect();
      if (r.bottom <= vh + 2) clipped.push({ el: label(el), cortadoPx: cut, altura: el.clientHeight });
    }
  }

  const unreachable = [];
  for (const el of document.querySelectorAll('button, a[href], input, select, textarea, [role="button"], [role="tab"]')) {
    if (!visible(el) || el.closest('.leaflet-container')) continue;
    const r = el.getBoundingClientRect();
    if (r.top >= vh - 4 || r.left >= vw - 4) unreachable.push(label(el));
  }

  const lum = (rgb) => {
    const [r, g, b] = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const parse = (c) => (c.match(/[\d.]+/g) || []).map(Number);
  const bgOf = (el) => {
    for (let n = el; n; n = n.parentElement) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c.length >= 3 && (c[3] === undefined || c[3] > 0.6)) return c.slice(0, 3);
    }
    return [10, 15, 29];
  };
  let tiny = 0;
  const lowContrast = [];
  for (const el of all) {
    if (!visible(el) || !el.childNodes.length || ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    const cs = getComputedStyle(el);
    if (parseFloat(cs.fontSize) < 11) tiny += 1;
    const fg = parse(cs.color).slice(0, 3);
    const L1 = lum(fg); const L2 = lum(bgOf(el));
    const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    if (ratio < 3 && lowContrast.length < 12) lowContrast.push(`${label(el)} (${ratio.toFixed(1)}:1)`);
  }
  const docScroll = document.scrollingElement.scrollHeight > vh + 4;
  return { clipped: clipped.slice(0, 15), unreachable: unreachable.slice(0, 15), unreachableCount: unreachable.length, tiny, lowContrast, docScroll, nodes: all.length };
}

(async () => {
  fs.mkdirSync(path.join(outDir, 'shots'), { recursive: true });
  const userData = prepareUserData();
  const app = await _electron.launch({ args: [repo], cwd: repo, env: { ...process.env, SIGMA_QA: '1', SIGMA_QA_USER_DATA: userData } });
  const win = await app.firstWindow();
  const errors = [];
  win.on('pageerror', (e) => errors.push({ route: win.url().split('#')[1] || '', text: e.message.slice(0, 200) }));
  win.on('console', (m) => { if (m.type() === 'error' && !/googleapis|favicon/.test(m.text())) errors.push({ route: win.url().split('#')[1] || '', text: m.text().slice(0, 200) }); });
  await win.waitForTimeout(3500);
  await win.evaluate(() => { [...document.querySelectorAll('button')].find((b) => /Pular tour/.test(b.textContent))?.click(); });

  const results = [];
  for (const [w, h] of VIEWPORTS) {
    await app.evaluate(({ BrowserWindow }, size) => { const bw = BrowserWindow.getAllWindows()[0]; bw.unmaximize(); bw.setContentSize(size[0], size[1]); }, [w, h]);
    await win.waitForTimeout(600);
    for (const route of ROUTES) {
      const t0 = Date.now();
      await win.evaluate((r) => { window.location.hash = r; }, route);
      await win.waitForFunction(() => !document.querySelector('.tab-loading'), null, { timeout: 15000 }).catch(() => {});
      await win.waitForTimeout(900);
      const ms = Date.now() - t0 - 900;
      await win.screenshot({ path: path.join(outDir, 'shots', `${route}-${w}.png`) });
      const found = await win.evaluate(inspect);
      results.push({ route, size: `${w}x${h}`, ms, ...found });
      await win.evaluate(() => window.scrollTo(0, 0));
    }
  }
  await app.close();
  fs.rmSync(userData, { recursive: true, force: true });

  const lines = ['# Auditoria de usabilidade — P4J3', '', `Gerado em ${new Date().toLocaleString('pt-BR')}.`, ''];
  lines.push('| Tela | Janela | Carga | Cortados | Inalcançáveis | Letra < 11px | Pouco contraste |', '|---|---|---|---|---|---|---|');
  for (const r of results) lines.push(`| ${r.route} | ${r.size} | ${r.ms} ms | ${r.clipped.length} | ${r.unreachableCount} | ${r.tiny} | ${r.lowContrast.length} |`);
  for (const r of results) {
    if (!r.clipped.length && !r.unreachableCount && !r.lowContrast.length) continue;
    lines.push('', `## ${r.route} · ${r.size}`);
    if (r.clipped.length) lines.push('**Conteúdo cortado (sem rolagem):**', ...r.clipped.map((c) => `- ${c.el} — ${c.cortadoPx}px escondidos`));
    if (r.unreachable.length) lines.push('**Fora da tela e sem rolagem:**', ...r.unreachable.map((u) => `- ${u}`));
    if (r.lowContrast.length) lines.push('**Pouco contraste:**', ...r.lowContrast.map((c) => `- ${c}`));
  }
  lines.push('', '## Erros', ...(errors.length ? errors.map((e) => `- [${e.route}] ${e.text}`) : ['- nenhum']));
  fs.writeFileSync(path.join(outDir, 'ux-report.md'), lines.join('\n'));
  fs.writeFileSync(path.join(outDir, 'ux-report.json'), JSON.stringify({ results, errors }, null, 2));
  console.log(lines.slice(0, 4 + results.length).join('\n'));
  console.log(`\nRelatório: ${path.join(outDir, 'ux-report.md')}`);
})().catch((e) => { console.error(e); process.exit(1); });
