/**
 * Compara as evidências desktop do app com o HTML exportado pelo Open Design.
 * Diferença de pixels é apenas diagnóstica porque os fixtures possuem conteúdos
 * distintos; o gate bloqueante cobre inventário e dimensões de todas as telas.
 */
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const root = path.join(__dirname, '..', 'docs', 'qa', 'open-design-lote1');
const referenceRoot = path.join(root, 'reference');
const routes = ['overview', 'scraper', 'base', 'scoring', 'whatsapp', 'dashboard', 'settings'];
const modals = [
  'busca-global-modal',
  'nova-extracao-modal',
  'exportar-leads-modal',
  'criar-grupo-modal',
  'adicionar-grupo-modal',
  'detalhe-lead-modal',
  'configurar-ia-modal',
  'detalhe-scoring-modal',
  'nova-conversa-modal',
  'nova-campanha-modal',
  'campanhas-modal',
  'conexoes-modal',
  'perfil-modal',
  'qr-modal',
  'encaminhar-modal',
  'status-modal',
];

const readPng = (file) => PNG.sync.read(fs.readFileSync(file));
const entries = [...routes.map((name) => ({ type: 'route', name })), ...modals.map((name) => ({ type: 'modal', name }))];
const failures = [];
const comparisons = entries.map(({ type, name }) => {
  const filename = `${name}-1440x900.png`;
  const appFile = path.join(root, filename);
  const referenceFile = path.join(referenceRoot, filename);
  if (!fs.existsSync(appFile) || !fs.existsSync(referenceFile)) {
    const missing = [!fs.existsSync(appFile) ? 'app' : null, !fs.existsSync(referenceFile) ? 'reference' : null].filter(Boolean);
    failures.push(`${name}: captura ausente (${missing.join(', ')})`);
    return { type, name, missing };
  }

  const appImage = readPng(appFile);
  const referenceImage = readPng(referenceFile);
  const sameDimensions = appImage.width === referenceImage.width && appImage.height === referenceImage.height;
  if (!sameDimensions) failures.push(`${name}: dimensões ${appImage.width}x${appImage.height} != ${referenceImage.width}x${referenceImage.height}`);

  let similarity = null;
  if (sameDimensions) {
    let absoluteDifference = 0;
    for (let index = 0; index < appImage.data.length; index += 4) {
      absoluteDifference += Math.abs(appImage.data[index] - referenceImage.data[index]);
      absoluteDifference += Math.abs(appImage.data[index + 1] - referenceImage.data[index + 1]);
      absoluteDifference += Math.abs(appImage.data[index + 2] - referenceImage.data[index + 2]);
    }
    similarity = 1 - absoluteDifference / (appImage.width * appImage.height * 3 * 255);
  }

  return {
    type,
    name,
    dimensions: `${appImage.width}x${appImage.height}`,
    sameDimensions,
    pixelSimilarityDiagnostic: similarity === null ? null : Number((similarity * 100).toFixed(2)),
  };
});

const report = {
  generatedAt: new Date().toISOString(),
  desktopOnly: true,
  reference: 'sigma-gmaps-lote1-prototype.html',
  expectedPairs: entries.length,
  comparedPairs: comparisons.filter((item) => !item.missing).length,
  routePairs: routes.length,
  modalPairs: modals.length,
  layoutContractPassed: failures.length === 0,
  note: 'pixelSimilarityDiagnostic não é gate porque conteúdo e dados dos fixtures diferem; inventário e dimensões são bloqueantes.',
  failures,
  comparisons,
};

const reportFile = path.join(root, 'comparison-report.json');
fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ reportFile, expectedPairs: report.expectedPairs, comparedPairs: report.comparedPairs, layoutContractPassed: report.layoutContractPassed, failures }, null, 2));
process.exitCode = failures.length ? 1 : 0;
