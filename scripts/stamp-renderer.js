/**
 * Pós-build: carimba o index.html com versão única e cache-bust nos assets.
 * Assim o Electron nunca reutiliza index-BC5opcok.js antigo.
 */
const fs = require("fs");
const path = require("path");

const distDir = path.join(__dirname, "..", "renderer", "dist");
const indexPath = path.join(distDir, "index.html");
const stamp = `ui-${Date.now().toString(36)}`;

if (!fs.existsSync(indexPath)) {
  console.error("[stamp-renderer] index.html não encontrado:", indexPath);
  process.exit(1);
}

let html = fs.readFileSync(indexPath, "utf8");

// Remove carimbos anteriores (re-run seguro)
html = html.replace(/\?v=ui-[a-z0-9]+/gi, "");
html = html.replace(/ · ui-[a-z0-9]+/gi, "");
html = html.replace(/\s*<meta name="sigma-ui-build"[^>]*>/gi, "");
html = html.replace(/\s*<style>\s*#sigma-build-banner[\s\S]*?<\/style>/gi, "");
html = html.replace(/\s*<div id="sigma-build-banner">[\s\S]*?<\/div>/gi, "");
html = html.replace(/\s*<script>\s*setTimeout\(function \(\) \{[\s\S]*?\[SIGMA\] scripts[\s\S]*?<\/script>/gi, "");

// cache-bust em scripts e css
html = html.replace(
  /(src|href)="(\.\/assets\/[^"?]+)(?:\?[^"]*)?"/g,
  (_, attr, asset) => `${attr}="${asset}?v=${stamp}"`,
);

// título visível
html = html.replace(
  /<title>([^<]*)<\/title>/i,
  `<title>P4J3 Prospect · ${stamp}</title>`,
);

const injectHead = `
  <meta name="sigma-ui-build" content="${stamp}">
`;
html = html.replace("</head>", `${injectHead}</head>`);

html = html.replace(
  /<div id="root"><\/div>/,
  `<div id="root"></div>
  <script>
    console.info('[SIGMA] HTML build ${stamp}');
    console.info('[SIGMA] scripts', [...document.scripts].map(function (s) { return s.src; }));
    // Se algum script antigo aparecer na página, avisa forte
    try {
      var bad = [...document.scripts].some(function (s) {
        return /7F4QwPd2|ui-mrfg9u99|BC5opcok|rad4ZrnG|CaedZwU-|Dj5wJ2qb/i.test(s.src || '');
      });
      if (bad) {
        console.error('[SIGMA] SCRIPT ANTIGO DETECTADO — feche o app e rode npm start');
        document.title = 'UI ANTIGA — reinicie o app';
      }
    } catch (e) {}
  </script>`,
);

fs.writeFileSync(indexPath, html, "utf8");
console.log("[stamp-renderer] carimbado:", stamp);
console.log("[stamp-renderer]", indexPath);
