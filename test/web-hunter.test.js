const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { pickCompanySites, diagnose, companyName, bestPhone, phonesIn, runRadar } = require('../agents/web-hunter');

describe('Radar Web', () => {
  it('fica só com sites próprios de empresas, 1 por domínio', () => {
    const sites = pickCompanySites([
      { url: 'https://condeclinica.com/', title: 'Conde Estética' },
      { url: 'https://condeclinica.com/contato', title: 'Contato' },
      { url: 'https://www.guiatelefone.com/empresas/x', title: 'Guia' },
      { url: 'https://instagram.com/clinica', title: 'IG' },
      { url: 'https://linktr.ee/clinica', title: 'Links' },
      { url: 'https://blog.com/10-melhores', title: '10 MELHORES Clínicas de Estética' },
      { url: 'https://jaconhecido.com.br', title: 'Já na base' },
      { url: 'https://nova.com.br', title: 'Nova Estética' },
    ], new Set(['jaconhecido.com.br']));
    assert.deepEqual(sites.map((s) => s.host), ['condeclinica.com', 'nova.com.br']);
  });

  it('diagnóstico: site bom passa, site fraco vira lead', () => {
    const good = diagnose({ ok: true, https: true, loadMs: 1200, viewport: true, whatsapp: true, title: 'Clínica Conde Estética', description: 'x', year: new Date().getFullYear(), textLength: 3000 });
    assert.equal(good.weak, false);
    const weak = diagnose({ ok: true, https: false, loadMs: 6000, viewport: false, whatsapp: false, title: 'Home', description: '', year: 2019, textLength: 200 });
    assert.equal(weak.weak, true);
    assert.ok(weak.issues.some((i) => /celular/.test(i)));
    assert.ok(weak.issues.some((i) => /2019/.test(i)));
    assert.equal(diagnose({ ok: false, status: 0 }).weak, true);
  });

  it('nome e telefone saem do site', () => {
    assert.equal(companyName('Inicial - Dermajestic', 'dermajestic.com.br'), 'Dermajestic');
    assert.equal(companyName('', 'studio-bela.com.br'), 'Studio Bela');
    assert.equal(bestPhone({ wa: ['https://wa.me/5561982499152'], tel: [] }), '5561982499152');
    assert.equal(bestPhone({ wa: [], tel: ['+55 (61) 3333-4444'] }), '556133334444');
    assert.deepEqual(phonesIn('Ligue (61) 99876-5432 ou 61 3222-1111'), ['61998765432', '6132221111']);
  });

  it('rodada completa só devolve os fracos com telefone e fora da base', async () => {
    const pages = {
      'https://fraco.com.br': { ok: true, status: 200, https: false, viewport: false, whatsapp: false, title: 'Fraco Estética', description: '', year: 2018, textLength: 100, tel: ['61 99999-0001'], wa: [] },
      'https://bom.com.br': { ok: true, status: 200, https: true, viewport: true, whatsapp: true, title: 'Bom Estética', description: 'ok', year: new Date().getFullYear(), textLength: 5000, tel: ['61 99999-0002'], wa: [] },
      'https://semtel.com.br': { ok: true, status: 200, https: false, viewport: false, whatsapp: false, title: 'Sem Tel', description: '', textLength: 50, tel: [], wa: [] },
    };
    // Navegador falso: cada página devolve os sinais definidos acima.
    const browser = {
      newContext: async () => ({
        newPage: async () => {
          let current = null;
          return {
            goto: async (url) => { current = pages[url.replace(/\/$/, '')]; return { status: () => current.status }; },
            url: () => 'http://x',
            waitForTimeout: async () => {},
            evaluate: async () => ({ ...current, sample: '' }),
          };
        },
        close: async () => {},
      }),
      close: async () => {},
    };
    const res = await runRadar({ niche: 'estética', city: 'Brasília' }, {
      search: async () => Object.keys(pages).map((url) => ({ url, title: pages[url].title })),
      launchBrowser: async () => browser,
      phoneKey: (p) => String(p).replace(/\D/g, '').replace(/^55/, ''),
    });
    assert.equal(res.checked.length, 3);
    assert.deepEqual(res.leads.map((l) => l.name), ['Fraco Estética']);
    assert.equal(res.leads[0].source, 'radar-web');
  });
});
