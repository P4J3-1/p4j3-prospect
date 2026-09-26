/**
 * Planejador de missões da máquina de prospecção: cruza nichos (por faixa de
 * ticket) com regiões — primeiro todo o DF, depois as capitais do Brasil —
 * e devolve a próxima missão em rodízio. Missões manuais vêm antes; nichos
 * que o Analista marcou como os que mais respondem ganham prioridade.
 */

// Regiões administrativas do DF (as mais populosas primeiro).
const DF_REGIONS = [
  "Ceilândia", "Samambaia", "Taguatinga", "Plano Piloto", "Planaltina", "Águas Claras", "Recanto das Emas", "Gama",
  "Guará", "Santa Maria", "Sobradinho", "São Sebastião", "Vicente Pires", "Sol Nascente", "Riacho Fundo", "Itapoã",
  "Sudoeste", "Arniqueira", "Paranoá", "Brazlândia", "Asa Norte", "Asa Sul", "Lago Sul", "Lago Norte", "Noroeste",
  "Cruzeiro", "Jardim Botânico", "Núcleo Bandeirante", "Park Way", "Candangolândia", "Estrutural", "Varjão", "Fercal",
  "Arapoanga", "Água Quente", "SIA",
];

// Depois do DF: entorno e capitais (Goiânia e Entorno primeiro, pela proximidade).
const BRAZIL_CITIES = [
  "Valparaíso de Goiás, GO", "Águas Lindas de Goiás, GO", "Luziânia, GO", "Formosa, GO", "Goiânia, GO", "Anápolis, GO",
  "São Paulo, SP", "Rio de Janeiro, RJ", "Belo Horizonte, MG", "Salvador, BA", "Fortaleza, CE", "Curitiba, PR",
  "Recife, PE", "Porto Alegre, RS", "Manaus, AM", "Belém, PA", "Campinas, SP", "São Luís, MA", "Maceió, AL",
  "Natal, RN", "Teresina, PI", "João Pessoa, PB", "Campo Grande, MS", "Cuiabá, MT", "Florianópolis, SC",
  "Aracaju, SE", "Vitória, ES", "Porto Velho, RO", "Macapá, AP", "Rio Branco, AC", "Boa Vista, RR", "Palmas, TO",
];

/**
 * Nichos e a faixa de ticket em que costumam comprar.
 *  baixo: fecha R$ 300–500 (Google ajustado, botão/mensagem automática, página simples)
 *  medio: R$ 800–2.000 (site, automação de agenda)
 *  alto:  R$ 2.000+ (site completo, automação, tráfego)
 */
const NICHES = [
  // Ticket baixo — muitos, presença fraca, decisão rápida (dono atende o WhatsApp).
  ["barbearia", "baixo"], ["salão de beleza", "baixo"], ["manicure e nail designer", "baixo"], ["lava jato", "baixo"],
  ["pet shop", "baixo"], ["banho e tosa", "baixo"], ["oficina mecânica", "baixo"], ["assistência técnica de celular", "baixo"],
  ["hamburgueria", "baixo"], ["pizzaria", "baixo"], ["açaiteria", "baixo"], ["marmitaria", "baixo"], ["confeitaria", "baixo"],
  ["padaria", "baixo"], ["lanchonete", "baixo"], ["floricultura", "baixo"], ["lavanderia", "baixo"], ["chaveiro", "baixo"],
  ["ótica", "baixo"], ["loja de roupas", "baixo"], ["estúdio de sobrancelha", "baixo"], ["borracharia", "baixo"],
  ["vidraçaria", "baixo"], ["dedetizadora", "baixo"], ["gráfica rápida", "baixo"], ["costureira", "baixo"],
  ["estúdio de pilates", "baixo"], ["personal trainer", "baixo"], ["depilação", "baixo"], ["sorveteria", "baixo"],
  // Ticket médio.
  ["clínica de estética", "medio"], ["psicólogo", "medio"], ["fisioterapeuta", "medio"], ["nutricionista", "medio"],
  ["clínica veterinária", "medio"], ["escola de idiomas", "medio"], ["autoescola", "medio"], ["estúdio de tatuagem", "medio"],
  ["fotógrafo", "medio"], ["buffet de festas", "medio"], ["escritório de contabilidade", "medio"], ["academia", "medio"],
  ["arquiteto", "medio"], ["marcenaria", "medio"],
  // Ticket alto.
  ["clínica odontológica", "alto"], ["escritório de advocacia", "alto"], ["imobiliária", "alto"], ["clínica médica", "alto"],
  ["harmonização facial", "alto"], ["energia solar", "alto"], ["construtora", "alto"], ["escola particular", "alto"],
];

// Ordem de trabalho: 2 nichos de ticket baixo para cada médio/alto.
function orderedNiches() {
  const low = NICHES.filter(([, t]) => t === "baixo");
  const rest = NICHES.filter(([, t]) => t !== "baixo");
  const out = [];
  let li = 0;
  let ri = 0;
  while (li < low.length || ri < rest.length) {
    if (li < low.length) out.push(low[li++]);
    if (li < low.length) out.push(low[li++]);
    if (ri < rest.length) out.push(rest[ri++]);
  }
  return out;
}

const ORDERED = orderedNiches();
const AREAS = [...DF_REGIONS.map((r) => `${r}, Brasília - DF`), ...BRAZIL_CITIES];

/**
 * Missão número `index` do plano automático (determinística).
 * Percorre todos os nichos numa região antes de ir para a próxima.
 */
function plannedMission(index) {
  const total = ORDERED.length * AREAS.length;
  const i = ((Number(index) || 0) % total + total) % total;
  const [niche, ticket] = ORDERED[i % ORDERED.length];
  const city = AREAS[Math.floor(i / ORDERED.length)];
  return { niche, city, neighborhoods: [], ticket, auto: true };
}

/**
 * Próxima missão: manuais ativas primeiro (rodízio), depois o plano Brasil.
 * A cada 3 missões automáticas, uma usa um nicho que o Analista marcou como
 * campeão (se houver), na mesma região.
 * @param {{ manual: object[], cursor: number, autoCursor: number, favoriteNiches?: string[], autoEnabled?: boolean }} state
 * @returns {{ mission: object|null, cursor: number, autoCursor: number }}
 */
function nextMission({ manual = [], cursor = 0, autoCursor = 0, favoriteNiches = [], autoEnabled = true }) {
  const active = manual.filter((m) => m && m.active !== false && m.niche && m.city);
  // Rodízio: manuais e automáticas se alternam quando existem as duas.
  const useManual = active.length && (!autoEnabled || cursor % 2 === 0);
  if (useManual) {
    const mission = active[Math.floor(cursor / (autoEnabled ? 2 : 1)) % active.length];
    return { mission, cursor: cursor + 1, autoCursor };
  }
  if (!autoEnabled) return { mission: null, cursor, autoCursor };
  let mission = plannedMission(autoCursor);
  if (favoriteNiches.length && autoCursor % 3 === 2) {
    mission = { ...mission, niche: favoriteNiches[Math.floor(autoCursor / 3) % favoriteNiches.length], ticket: "campeão" };
  }
  return { mission, cursor: cursor + 1, autoCursor: autoCursor + 1 };
}

function planSize() {
  return { niches: ORDERED.length, areas: AREAS.length, dfAreas: DF_REGIONS.length, total: ORDERED.length * AREAS.length };
}

module.exports = { DF_REGIONS, BRAZIL_CITIES, NICHES, plannedMission, nextMission, planSize };
