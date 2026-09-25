const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { cityGrid, nicheVariations, overpassQuery } = require('../utils/area-discovery');

function loadScraperWithFakes(chromium, extractBusinessData) {
  const paths = {
    scraper: require.resolve('../scraper'),
    playwright: require.resolve('playwright'),
    business: require.resolve('../utils/businessData'),
  };
  const previous = Object.fromEntries(Object.entries(paths).map(([k, p]) => [k, require.cache[p]]));
  delete require.cache[paths.scraper];
  const fake = (p, exports) => { require.cache[p] = { id: p, filename: p, loaded: true, exports }; };
  fake(paths.playwright, { chromium });
  fake(paths.business, { extractBusinessData });
  return {
    scraper: require('../scraper'),
    restore() {
      for (const [k, p] of Object.entries(paths)) {
        delete require.cache[p];
        if (previous[k]) require.cache[p] = previous[k];
      }
    },
  };
}

describe('extração por meta de novos', () => {
  it('pula quem já está na base sem abrir e para na meta', async () => {
    const opened = [];
    let current = null;
    let gotoUrl = '';
    const mk = (i) => ({
      name: `Empresa ${i}`,
      href: `https://www.google.com/maps/place/E${i}/data=!4m7!3m6!1s0x${i}a:0x${i}b!8m2`,
    });
    const items = [1, 2, 3, 4, 5].map(mk);
    const listings = items.map((item) => ({
      getAttribute: async (name) => (name === 'href' ? item.href : item.name),
      click: async () => { current = item; opened.push(item.name); },
    }));
    const page = {
      route: async () => {},
      goto: async (url) => { gotoUrl = url; },
      waitForTimeout: async () => {},
      waitForSelector: async () => {},
      evaluate: async () => true,
      locator: (selector) => {
        if (selector.includes('button')) return { first: () => ({ isVisible: async () => false }) };
        if (selector.includes('instagram')) return { first: () => ({ count: async () => 0 }) };
        return { count: async () => listings.length, all: async () => listings };
      },
      close: async () => {},
    };
    const chromium = {
      launch: async () => ({
        newContext: async () => ({ newPage: async () => page, close: async () => {} }),
        newPage: async () => page,
        close: async () => {},
      }),
    };
    const loaded = loadScraperWithFakes(chromium, async () => ({
      name: current.name,
      googleMapsUrl: current.href,
      latitude: '-23.5',
      longitude: '-46.6',
      coordSource: 'poi',
    }));
    try {
      const skipKeys = new Set(['pid:0x1a:0x1b', 'name:empresa 3']);
      const result = await loaded.scraper.scrapeGoogleMaps('dentista Moema', 50, () => {}, null, {
        skipKeys,
        maxNew: 2,
        coords: { lat: -23.6, lng: -46.66 },
      });
      assert.deepEqual(opened, ['Empresa 2', 'Empresa 4'], 'não abre os conhecidos e para ao atingir 2 novos');
      assert.equal(result.count, 2);
      assert.equal(result.data[0].placeId, '0x2a:0x2b');
      assert.ok(gotoUrl.endsWith('/@-23.6,-46.66,14z'), 'busca centrada no ponto da grade');
    } finally {
      loaded.restore();
    }
  });
});

describe('cobertura da cidade', () => {
  it('consulta de bairros limita à cidade dentro do estado', () => {
    const q = overpassQuery('Guarulhos', 'SP');
    assert.ok(q.includes('"name"="São Paulo"'));
    assert.ok(q.includes('"name"="Guarulhos"'));
    assert.ok(q.includes('suburb|neighbourhood|quarter'));
  });

  it('grade cobre o retângulo da cidade', async () => {
    const fetchImpl = async () => ({ ok: true, json: async () => [{ boundingbox: ['-24', '-23', '-47', '-46'] }] });
    const points = await cityGrid('X', 'SP', { size: 2, fetchImpl });
    assert.equal(points.length, 4);
    assert.deepEqual(points[0], { lat: -23.75, lng: -46.75 });
  });

  it('variações: dicionário + IA, sem repetir o termo original', async () => {
    const terms = await nicheVariations('Dentista', {
      runAi: async () => ({ result: { termos: ['clínica odontológica', 'dentista', 'prótese dentária'] } }),
    });
    assert.ok(terms.includes('ortodontia'));
    assert.ok(terms.includes('prótese dentária'));
    assert.ok(!terms.map((t) => t.toLowerCase()).includes('dentista'));
    assert.equal(new Set(terms).size, terms.length);
  });
});
