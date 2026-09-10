const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

const { normalizeText, repairMojibake } = require('../utils/text-normalizer');
const { migrateExistingData } = require('../utils/existing-data-migrator');

test('repara mojibake de UTF-8 sem danificar acentuação válida', () => {
  assert.equal(repairMojibake('ClÃ­nica Dra ClÃ¡udia'), 'Clínica Dra Cláudia');
  assert.equal(repairMojibake('â¹ Atendimento'), '⏹ Atendimento');
  assert.equal(normalizeText('  São   Paulo  '), 'São Paulo');
  assert.equal(repairMojibake('Ângela'), 'Ângela');
});

test('migração corrige campos visíveis e mantém o bruto para auditoria', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sigma-text-normalizer-'));
  try {
    const report = migrateExistingData(root, {
      localStorage: {
        sigma_leads: JSON.stringify([{
          id: 'lead-1',
          name: 'ClÃ­nica SaÃºde',
          category: 'ClÃ­nica de dermatologia',
          city: 'BrasÃ­lia',
          raw: { name: 'ClÃ­nica SaÃºde' },
        }]),
      },
    });
    const lead = JSON.parse(report.localStorageUpdates.sigma_leads)[0];
    assert.equal(lead.name, 'Clínica Saúde');
    assert.equal(lead.category, 'Clínica de dermatologia');
    assert.equal(lead.city, 'Brasília');
    assert.equal(lead.raw.name, 'ClÃ­nica SaÃºde');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
