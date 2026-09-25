/**
 * Pesquisa de um lead ("localizador"): busca na web, identifica o CNPJ,
 * consulta o quadro de sócios (dado público da Receita Federal) e pede à IA
 * quem é o decisor, como chamá-lo, qual abordagem usar e a chance real de
 * fechar partindo de um lead frio.
 */
const { deriveGreeting } = require("../campaigns/greeting");

const HEADERS = {
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "accept-language": "pt-BR,pt;q=0.9",
};
const FETCH_TIMEOUT_MS = 12000;
const STOPWORDS = new Set(["ltda", "me", "eireli", "epp", "sa", "s", "a", "de", "da", "do", "das", "dos", "e", "em", "the", "and", "com", "br"]);
const DECISOR_ROLES = /administrador|titular|presidente|diretor|s[oó]cio/i;

async function fetchText(url, { fetchImpl = fetch, accept } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, { headers: { ...HEADERS, ...(accept ? { accept } : {}) }, signal: controller.signal });
    return { ok: res.ok, status: res.status, text: await res.text() };
  } finally {
    clearTimeout(timer);
  }
}

function decodeHtml(text) {
  return String(text || "")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function resultUrl(href) {
  const raw = decodeHtml(href);
  const uddg = raw.match(/[?&]uddg=([^&]+)/);
  if (uddg) {
    try { return decodeURIComponent(uddg[1]); } catch { return ""; }
  }
  return raw.startsWith("//") ? `https:${raw}` : raw;
}

/** Resultados orgânicos do DuckDuckGo (HTML), sem anúncios. */
function parseSearchResults(html, limit = 8) {
  const results = [];
  const source = String(html || "");
  const starts = [...source.matchAll(/<div[^>]+class="([^"]*)"[^>]*>/g)]
    .filter((m) => /(^|\s)result(\s|$)/.test(m[1]));
  for (let i = 0; i < starts.length; i += 1) {
    if (/result--ad/.test(starts[i][1])) continue;
    const block = source.slice(starts[i].index, starts[i + 1]?.index ?? source.length);
    const link = block.match(/class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!link) continue;
    const snippet = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|div)>/);
    const url = resultUrl(link[1]);
    if (!/^https?:\/\//.test(url)) continue;
    results.push({ title: decodeHtml(link[2]), url, snippet: decodeHtml(snippet?.[1] || "") });
    if (results.length >= limit) break;
  }
  return results;
}

async function webSearch(query, { fetchImpl, limit = 8 } = {}) {
  const url = `https://html.duckduckgo.com/html/?kl=br-pt&q=${encodeURIComponent(query)}`;
  const res = await fetchText(url, { fetchImpl });
  if (!res.ok) return [];
  return parseSearchResults(res.text, limit);
}

function isValidCnpj(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length !== 14 || /^(\d)\1{13}$/.test(digits)) return false;
  const calc = (base) => {
    const weights = base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = base.split("").reduce((acc, d, i) => acc + Number(d) * weights[i], 0);
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  const first = calc(digits.slice(0, 12));
  const second = calc(digits.slice(0, 12) + first);
  return digits.endsWith(`${first}${second}`);
}

function extractCnpjs(text) {
  const found = [];
  for (const match of String(text || "").matchAll(/\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/g)) {
    const digits = match[0].replace(/\D/g, "");
    if (isValidCnpj(digits) && !found.includes(digits)) found.push(digits);
  }
  return found;
}

function titleCase(name) {
  return String(name || "")
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (["da", "de", "do", "das", "dos", "e"].includes(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ")
    .trim();
}

function normalizeCompany(raw, cnpj) {
  if (!raw || typeof raw !== "object" || !(raw.razao_social || raw.nome_fantasia)) return null;
  return {
    cnpj,
    razaoSocial: titleCase(raw.razao_social),
    nomeFantasia: titleCase(raw.nome_fantasia),
    situacao: String(raw.descricao_situacao_cadastral || raw.situacao_cadastral || "").toUpperCase(),
    abertura: raw.data_inicio_atividade || "",
    porte: raw.porte || raw.descricao_porte || "",
    atividade: raw.cnae_fiscal_descricao || "",
    municipio: titleCase(raw.municipio),
    uf: raw.uf || "",
    telefone: String(raw.ddd_telefone_1 || "").replace(/\D/g, ""),
    // Só nome e qualificação: é o necessário para saber com quem falar.
    socios: (Array.isArray(raw.qsa) ? raw.qsa : [])
      .map((s) => ({ nome: titleCase(s.nome_socio), qualificacao: s.qualificacao_socio || "" }))
      .filter((s) => s.nome)
      .slice(0, 6),
  };
}

async function lookupCnpj(cnpj, { fetchImpl } = {}) {
  const sources = [`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, `https://minhareceita.org/${cnpj}`];
  for (const url of sources) {
    try {
      const res = await fetchText(url, { fetchImpl, accept: "application/json" });
      if (!res.ok) continue;
      const company = normalizeCompany(JSON.parse(res.text), cnpj);
      if (company) return company;
    } catch { /* tenta a próxima fonte */ }
  }
  return null;
}

function words(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w));
}

function similarity(a, b) {
  const A = new Set(words(a));
  const B = new Set(words(b));
  if (!A.size || !B.size) return 0;
  let common = 0;
  for (const w of A) if (B.has(w)) common += 1;
  return common / Math.min(A.size, B.size);
}

function leadCity(lead) {
  if (lead.city) return String(lead.city);
  const parts = String(lead.address || "").split(",").map((p) => p.trim()).filter(Boolean);
  const cityPart = parts.find((p) => /\s-\s[A-Z]{2}$/.test(p)) || parts[parts.length - 2] || "";
  return cityPart.replace(/\s-\s[A-Z]{2}$/, "");
}

/** 0–1: quão provável é o CNPJ ser deste lead (nome, cidade, telefone). */
function companyMatchScore(lead, company) {
  const name = Math.max(similarity(lead.name, company.nomeFantasia), similarity(lead.name, company.razaoSocial));
  const city = leadCity(lead);
  const sameCity = city && similarity(city, company.municipio) >= 1 ? 0.2 : 0;
  const phone = String(lead.phone || "").replace(/\D/g, "");
  const samePhone = phone && company.telefone && phone.endsWith(company.telefone.slice(-8)) ? 0.4 : 0;
  return Math.min(1, name * 0.7 + sameCity + samePhone);
}

async function findCompany(lead, results, { fetchImpl, maxLookups = 3 } = {}) {
  // CNPJs de resultados cujo título lembra o nome do lead vêm primeiro.
  const ranked = results
    .map((r) => ({ r, sim: similarity(lead.name, r.title) }))
    .sort((a, b) => b.sim - a.sim);
  const candidates = [];
  for (const { r } of ranked) {
    for (const cnpj of extractCnpjs(`${r.title} ${r.snippet} ${r.url}`)) {
      if (!candidates.includes(cnpj)) candidates.push(cnpj);
    }
  }
  let best = null;
  for (const cnpj of candidates.slice(0, maxLookups)) {
    const company = await lookupCnpj(cnpj, { fetchImpl });
    if (!company) continue;
    const score = companyMatchScore(lead, company);
    if (!best || score > best.matchScore) best = { ...company, matchScore: Math.round(score * 100) / 100 };
  }
  // Abaixo de 0.6 o risco de pegar outra empresa com nome parecido é alto.
  return best && best.matchScore >= 0.6 ? best : null;
}

function pickDecisor(lead, company) {
  if (company?.socios?.length) {
    // Sócio cujo nome aparece no nome da empresa ("Dra. Ana ...") é o decisor mais provável.
    const leadWords = new Set(words(lead.name));
    const named = company.socios.find((s) => words(s.nome).some((w) => w.length > 2 && leadWords.has(w)));
    const socio = named || company.socios.find((s) => DECISOR_ROLES.test(s.qualificacao)) || company.socios[0];
    return {
      nome: socio.nome,
      cargo: socio.qualificacao || "Sócio",
      fonte: "Quadro de sócios (Receita Federal)",
      confianca: company.matchScore >= 0.85 ? "alta" : "media",
    };
  }
  const titled = String(lead.name || "").match(/\b(Dra?|Doutora?)\.?\s+([A-ZÀ-Ý][a-zà-ÿ]+(?:\s+[A-ZÀ-Ý][a-zà-ÿ]+)?)/);
  if (titled) {
    return { nome: titled[2], cargo: "Profissional responsável", fonte: "Nome da empresa no Google Maps", confianca: "media" };
  }
  return null;
}

/** Estimativa sem IA: sinais públicos de que vale abordar agora. */
function heuristicChance(lead, company) {
  let value = 25;
  const signals = [];
  const risks = [];
  if (lead.phone) { value += 10; signals.push("Tem telefone para contato direto"); }
  const rating = Number(String(lead.rating || "").replace(",", "."));
  const reviews = Number(String(lead.reviewCount ?? lead.reviews ?? lead.totalReviews ?? 0).replace(/\D/g, "")) || 0;
  if (rating >= 4.3) { value += 8; signals.push(`Boa reputação (${rating})`); }
  if (reviews >= 30) { value += 7; signals.push(`${reviews} avaliações: negócio ativo`); }
  if (!lead.website) { value += 10; signals.push("Sem site próprio: espaço para melhorar a presença digital"); }
  if (company?.decisor || company?.socios?.length) { value += 5; signals.push("Decisor identificado"); }
  if (company && company.situacao && company.situacao !== "ATIVA") { value -= 25; risks.push(`CNPJ com situação ${company.situacao}`); }
  if (!lead.phone) risks.push("Sem telefone: difícil iniciar conversa");
  risks.push("Lead frio: ainda não conhece você");
  const percentual = Math.max(5, Math.min(60, value));
  return {
    percentual,
    classificacao: percentual >= 45 ? "alta" : percentual >= 30 ? "media" : "baixa",
    justificativa: "Estimativa por regras (configure a IA para uma análise completa).",
    sinais_positivos: signals,
    riscos: risks,
  };
}

const INTEL_SYSTEM_PROMPT = [
  "Voce e um SDR senior e estrategista comercial B2B no Brasil.",
  "Recebe dados publicos de uma empresa local (Google Maps, busca web, Receita Federal), o perfil de quem vende e aprendizados de campanhas anteriores.",
  "Tarefas:",
  "1) decisor: identifique o provavel dono/decisor SOMENTE com nomes presentes nos dados. Nunca invente nomes. Sem nome confiavel, nome vazio.",
  "2) saudacao: como chamar a pessoa no WhatsApp (ex.: 'Dr. Paulo', 'Marina'). Nunca trate o nome da empresa como pessoa; sem nome confiavel use 'pessoal da <empresa curta>'.",
  "3) abordagem: melhor angulo para este negocio e uma primeira mensagem de ate 300 caracteres, sem link, que use a saudacao e termine com uma pergunta simples.",
  "4) chance_fechamento: chance realista (0-100) de fechar negocio partindo de lead frio, com justificativa honesta, sinais positivos e riscos. Seja conservador.",
  "5) proximos_passos: ate 3 acoes objetivas.",
  "Responda apenas JSON: {\"decisor\":{\"nome\":\"\",\"cargo\":\"\",\"confianca\":\"alta|media|baixa\",\"fonte\":\"\"},\"saudacao\":\"\",\"abordagem\":{\"angulo\":\"\",\"mensagem\":\"\",\"gatilho\":\"\"},\"chance_fechamento\":{\"percentual\":0,\"classificacao\":\"alta|media|baixa\",\"justificativa\":\"\",\"sinais_positivos\":[],\"riscos\":[]},\"proximos_passos\":[],\"resumo\":\"\"}",
].join("\n");

function textCorpus(lead, results, company) {
  return words([
    lead.name,
    ...results.map((r) => `${r.title} ${r.snippet}`),
    ...(company?.socios || []).map((s) => s.nome),
  ].join(" "));
}

/** A IA só pode citar decisor cujo nome aparece nos dados coletados. */
function sanitizeAiDecisor(aiDecisor, corpusWords) {
  const nome = String(aiDecisor?.nome || "").trim();
  if (!nome) return null;
  const corpus = new Set(corpusWords);
  const nameWords = words(nome).filter((w) => !["dr", "dra"].includes(w));
  if (!nameWords.length || !nameWords.every((w) => corpus.has(w))) return null;
  return {
    nome,
    cargo: String(aiDecisor.cargo || "").slice(0, 80),
    fonte: String(aiDecisor.fonte || "IA sobre dados públicos").slice(0, 120),
    confianca: ["alta", "media", "baixa"].includes(aiDecisor.confianca) ? aiDecisor.confianca : "baixa",
  };
}

function clampPercent(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : fallback;
}

async function researchLead(lead = {}, settings = {}, { fetchImpl, runAi, insights } = {}) {
  const name = String(lead.name || "").trim();
  if (!name) throw new Error("Lead sem nome para pesquisar.");
  const city = leadCity(lead);
  const queries = [`"${name}" ${city}`.trim(), `${name} ${city} cnpj`.trim()];
  const seen = new Set();
  const results = [];
  for (const query of queries) {
    try {
      for (const r of await webSearch(query, { fetchImpl })) {
        if (seen.has(r.url)) continue;
        seen.add(r.url);
        results.push(r);
      }
    } catch { /* busca indisponível não bloqueia o restante */ }
  }

  const company = await findCompany(lead, results, { fetchImpl }).catch(() => null);
  let decisor = pickDecisor(lead, company);
  let chance = heuristicChance(lead, company);
  let abordagem = null;
  let proximosPassos = [];
  let resumo = "";
  let saudacao = deriveGreeting({ ...lead, saudacao: "", decisor: decisor?.nome || "" });
  let ai = null;
  let aiError = "";

  if (typeof runAi === "function") {
    try {
      const payload = {
        lead: {
          nome: name,
          categoria: lead.category || "",
          endereco: lead.address || "",
          cidade: city,
          site: lead.website || "",
          instagram: lead.instagram || "",
          nota: lead.rating || "",
          avaliacoes: lead.totalReviews || lead.reviews || "",
        },
        busca_web: results.slice(0, 8),
        receita_federal: company
          ? { razao_social: company.razaoSocial, nome_fantasia: company.nomeFantasia, situacao: company.situacao, abertura: company.abertura, porte: company.porte, atividade: company.atividade, municipio: company.municipio, socios: company.socios, confianca_do_match: company.matchScore }
          : null,
        decisor_candidato: decisor,
        vendedor: settings.commercial || {},
        aprendizados: insights && insights.sent ? {
          taxa_resposta: insights.replyRate,
          mensagens_que_tiveram_resposta: insights.repliedMessages,
          nichos_que_mais_respondem: insights.bestCategories,
        } : null,
      };
      const { result, provider, model } = await runAi({ system: INTEL_SYSTEM_PROMPT, payload });
      ai = { provider, model };
      const aiDecisor = sanitizeAiDecisor(result?.decisor, textCorpus(lead, results, company));
      if (aiDecisor) decisor = aiDecisor;
      const aiGreeting = String(result?.saudacao || "").trim();
      // Saudação da IA só vale se não tratar a empresa como pessoa.
      if (aiGreeting && (aiDecisor || /^pessoal\b/i.test(aiGreeting))) saudacao = aiGreeting.slice(0, 60);
      if (result?.abordagem) {
        abordagem = {
          angulo: String(result.abordagem.angulo || "").slice(0, 300),
          mensagem: String(result.abordagem.mensagem || "").slice(0, 600),
          gatilho: String(result.abordagem.gatilho || "").slice(0, 200),
        };
      }
      if (result?.chance_fechamento) {
        const c = result.chance_fechamento;
        const percentual = clampPercent(c.percentual, chance.percentual);
        chance = {
          percentual,
          classificacao: ["alta", "media", "baixa"].includes(c.classificacao) ? c.classificacao : (percentual >= 45 ? "alta" : percentual >= 30 ? "media" : "baixa"),
          justificativa: String(c.justificativa || "").slice(0, 600),
          sinais_positivos: (Array.isArray(c.sinais_positivos) ? c.sinais_positivos : []).map(String).slice(0, 5),
          riscos: (Array.isArray(c.riscos) ? c.riscos : []).map(String).slice(0, 5),
        };
      }
      proximosPassos = (Array.isArray(result?.proximos_passos) ? result.proximos_passos : []).map(String).slice(0, 3);
      resumo = String(result?.resumo || "").slice(0, 600);
    } catch (error) {
      aiError = error.message;
    }
  }

  return {
    researchedAt: Date.now(),
    queries,
    results: results.slice(0, 10),
    company,
    decisor,
    saudacao,
    abordagem,
    chance,
    proximosPassos,
    resumo,
    ai,
    aiError,
  };
}

module.exports = {
  companyMatchScore,
  extractCnpjs,
  heuristicChance,
  isValidCnpj,
  parseSearchResults,
  pickDecisor,
  researchLead,
  sanitizeAiDecisor,
  similarity,
  words,
};
