const assert = require('node:assert/strict');
const test = require('node:test');

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

test('busca de e-mails roda em paralelo e todo lead sai com o e-mail', async () => {
  const total = 5;
  let clicked = 0;
  let activeSites = 0;
  let maxActiveSites = 0;
  const releaseSites = [];
  const listings = Array.from({ length: total }, () => ({ click: async () => { clicked++; } }));
  const mapsPage = {
    route: async () => {},
    goto: async () => {},
    waitForTimeout: async () => {},
    waitForSelector: async () => {},
    evaluate: async () => true,
    locator: (selector) => {
      if (selector.includes('button')) return { first: () => ({ isVisible: async () => false }) };
      if (selector.includes('instagram')) return { first: () => ({ count: async () => 0 }) };
      return { count: async () => total, all: async () => listings };
    },
    close: async () => {},
  };
  const sitePage = () => ({
    goto: async () => {
      activeSites++;
      maxActiveSites = Math.max(maxActiveSites, activeSites);
      await new Promise((resolve) => releaseSites.push(resolve));
      activeSites--;
    },
    waitForTimeout: async () => {},
    evaluate: async () => ['contato@empresa.com.br'],
    close: async () => {},
  });
  const chromium = {
    launch: async () => ({
      newContext: async () => ({ newPage: async () => mapsPage, close: async () => {} }),
      newPage: async () => sitePage(),
      close: async () => {},
    }),
  };
  const extract = async () => ({
    name: `Empresa ${clicked}`,
    website: `https://empresa${clicked}.com.br`,
    latitude: '-23.5',
    longitude: '-46.6',
    coordSource: 'poi',
  });
  const loaded = loadScraperWithFakes(chromium, extract);

  // Libera um site por vez, simulando sites lentos.
  const pump = setInterval(() => releaseSites.shift()?.(), 5);
  try {
    const leads = [];
    const result = await loaded.scraper.scrapeGoogleMaps('clínica', total, (event) => {
      if (event?.type === 'lead') leads.push(event.lead);
    });
    assert.equal(result.count, total);
    assert.equal(leads.length, total);
    assert.ok(result.data.every((place) => place.email === 'contato@empresa.com.br'));
    assert.equal(result.statistics.withEmail, total);
    assert.ok(maxActiveSites > 1, 'sites devem ser visitados em paralelo');
    assert.ok(maxActiveSites <= 3, 'pool respeita EMAIL_CONCURRENCY');
  } finally {
    clearInterval(pump);
    loaded.restore();
  }
});
