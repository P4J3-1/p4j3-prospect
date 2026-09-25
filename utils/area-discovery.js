/**
 * Cobertura da extração: bairros do município (OpenStreetMap), grade de
 * pontos no mapa (quando os bairros acabam) e variações do termo do nicho.
 * Tudo em cache por cidade, porque os servidores públicos do OSM são lentos.
 */
const fs = require("fs");
const path = require("path");

const UF_NAMES = {
  AC: "Acre", AL: "Alagoas", AP: "Amapá", AM: "Amazonas", BA: "Bahia", CE: "Ceará", DF: "Distrito Federal",
  ES: "Espírito Santo", GO: "Goiás", MA: "Maranhão", MT: "Mato Grosso", MS: "Mato Grosso do Sul", MG: "Minas Gerais",
  PA: "Pará", PB: "Paraíba", PR: "Paraná", PE: "Pernambuco", PI: "Piauí", RJ: "Rio de Janeiro", RN: "Rio Grande do Norte",
  RS: "Rio Grande do Sul", RO: "Rondônia", RR: "Roraima", SC: "Santa Catarina", SP: "São Paulo", SE: "Sergipe", TO: "Tocantins",
};

const OVERPASS_ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
const HEADERS = { "user-agent": "P4J3Prospect/1.0 (p4j3-prospect)" };
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// Sinônimos de busca no Google Maps para nichos comuns: cada termo traz
// resultados diferentes, e é assim que se passa do teto de ~120 por busca.
const NICHE_VARIATIONS = {
  dentista: ["clínica odontológica", "consultório odontológico", "ortodontia", "implante dentário", "odontopediatria"],
  "clinica de estetica": ["estética facial", "harmonização facial", "depilação a laser", "spa", "esteticista"],
  academia: ["crossfit", "studio de pilates", "personal trainer", "box de treino funcional"],
  restaurante: ["pizzaria", "hamburgueria", "lanchonete", "comida japonesa", "churrascaria", "marmitaria"],
  "pet shop": ["banho e tosa", "clínica veterinária", "veterinário", "hotel para cachorro"],
  "salao de beleza": ["cabeleireiro", "barbearia", "manicure", "design de sobrancelha", "studio de beleza"],
  barbearia: ["barbeiro", "salão masculino"],
  advogado: ["escritório de advocacia", "advogado trabalhista", "advogado previdenciário", "advogado de família"],
  contador: ["escritório de contabilidade", "contabilidade", "assessoria contábil"],
  imobiliaria: ["corretor de imóveis", "administradora de imóveis"],
  "oficina mecanica": ["auto center", "funilaria", "auto elétrica", "troca de óleo"],
  padaria: ["confeitaria", "doceria", "café"],
  farmacia: ["drogaria", "farmácia de manipulação"],
  psicologo: ["clínica de psicologia", "psicoterapia", "terapeuta"],
  fisioterapia: ["clínica de fisioterapia", "pilates", "quiropraxia"],
  nutricionista: ["clínica de nutrição", "nutrólogo"],
  "escola de idiomas": ["curso de inglês", "escola de inglês", "curso de espanhol"],
  "loja de roupas": ["boutique", "moda feminina", "moda masculina", "loja de moda"],
  "auto escola": ["centro de formação de condutores", "cfc"],
  hotel: ["pousada", "hostel", "motel"],
};

function norm(text) {
  return String(text || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

class AreaCache {
  constructor(userDataPath) {
    this.filePath = path.join(userDataPath, "area-cache.json");
    try {
      this.data = JSON.parse(fs.readFileSync(this.filePath, "utf-8")) || {};
    } catch {
      this.data = {};
    }
  }

  get(key) {
    const hit = this.data[key];
    return hit && Date.now() - hit.at < CACHE_TTL_MS ? hit.value : null;
  }

  set(key, value) {
    this.data[key] = { at: Date.now(), value };
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.data));
    } catch { /* cache é opcional */ }
  }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 30000, fetchImpl = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function overpassQuery(city, uf) {
  const state = UF_NAMES[String(uf || "").toUpperCase()] || uf;
  const esc = (s) => String(s).replace(/"/g, '\\"');
  const place = '["place"~"^(suburb|neighbourhood|quarter)$"]';
  return [
    "[out:json][timeout:40];",
    `area["boundary"="administrative"]["admin_level"="4"]["name"="${esc(state)}"]->.uf;`,
    `rel(area.uf)["boundary"="administrative"]["admin_level"="8"]["name"="${esc(city)}"];`,
    "map_to_area->.city;",
    `(node${place}(area.city);way${place}(area.city);rel${place}(area.city););`,
    "out tags center;",
  ].join("");
}

/** Bairros do município pelo OpenStreetMap (ordem alfabética, sem repetição). */
async function fetchNeighborhoods(city, uf, { cache, fetchImpl = fetch } = {}) {
  const key = `bairros:${norm(city)}|${norm(uf)}`;
  const cached = cache?.get(key);
  if (cached) return cached;
  let lastError = "";
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetchWithTimeout(endpoint, {
        method: "POST",
        headers: { ...HEADERS, "content-type": "application/x-www-form-urlencoded" },
        body: `data=${encodeURIComponent(overpassQuery(city, uf))}`,
      }, 45000, fetchImpl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const names = [...new Set((json.elements || []).map((e) => String(e?.tags?.name || "").trim()).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, "pt-BR"));
      cache?.set(key, names);
      return names;
    } catch (error) {
      lastError = error.name === "AbortError" ? "servidor do OpenStreetMap demorou demais" : error.message;
    }
  }
  throw new Error(`Não foi possível carregar os bairros (${lastError}).`);
}

/**
 * Grade de pontos dentro do retângulo da cidade. Buscar o nicho em cada
 * ponto (zoom de bairro) cobre regiões que os bairros do OSM não listam.
 */
async function cityGrid(city, uf, { size = 4, cache, fetchImpl = fetch } = {}) {
  const key = `bbox:${norm(city)}|${norm(uf)}`;
  let bbox = cache?.get(key);
  if (!bbox) {
    const state = UF_NAMES[String(uf || "").toUpperCase()] || uf || "";
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&country=Brasil&city=${encodeURIComponent(city)}&state=${encodeURIComponent(state)}`;
    const res = await fetchWithTimeout(url, { headers: HEADERS }, 20000, fetchImpl);
    if (!res.ok) throw new Error(`Não foi possível localizar ${city} no mapa (HTTP ${res.status}).`);
    const hit = (await res.json())?.[0];
    if (!hit?.boundingbox) throw new Error(`Não foi possível localizar ${city} no mapa.`);
    bbox = hit.boundingbox.map(Number); // [sul, norte, oeste, leste]
    cache?.set(key, bbox);
  }
  const [south, north, west, east] = bbox;
  const n = Math.max(2, Math.min(8, Math.round(size)));
  const points = [];
  for (let row = 0; row < n; row += 1) {
    for (let col = 0; col < n; col += 1) {
      points.push({
        lat: Number((south + ((row + 0.5) * (north - south)) / n).toFixed(5)),
        lng: Number((west + ((col + 0.5) * (east - west)) / n).toFixed(5)),
      });
    }
  }
  return points;
}

const VARIATION_SYSTEM_PROMPT = [
  "Voce ajuda a prospectar empresas locais no Google Maps no Brasil.",
  "Dado um nicho, liste termos de busca diferentes que encontrem OUTRAS empresas do mesmo mercado (sinonimos, especialidades, tipos de estabelecimento), como um brasileiro pesquisaria no Google Maps.",
  "Responda apenas JSON: {\"termos\":[\"ate 6 termos curtos\"]}",
].join("\n");

/** Termos alternativos para o nicho: dicionário local + IA quando configurada. */
async function nicheVariations(niche, { runAi, cache } = {}) {
  const base = norm(niche);
  const key = `variacoes:${base}`;
  const cached = cache?.get(key);
  if (cached) return cached;
  const found = new Set();
  for (const [name, list] of Object.entries(NICHE_VARIATIONS)) {
    if (base.includes(name) || name.includes(base)) list.forEach((t) => found.add(t));
  }
  if (typeof runAi === "function") {
    try {
      const { result } = await runAi({ system: VARIATION_SYSTEM_PROMPT, payload: { nicho: niche } });
      (Array.isArray(result?.termos) ? result.termos : []).forEach((t) => {
        const term = String(t || "").trim().slice(0, 60);
        if (term) found.add(term);
      });
    } catch { /* segue com o dicionário */ }
  }
  const out = [...found].filter((t) => norm(t) !== base).slice(0, 8);
  if (out.length) cache?.set(key, out);
  return out;
}

module.exports = { AreaCache, UF_NAMES, cityGrid, fetchNeighborhoods, nicheVariations, overpassQuery };
