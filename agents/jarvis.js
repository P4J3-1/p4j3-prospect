/**
 * J.A.R.V.I.S. do P4J3: entende ordens em português e as transforma em ações
 * dos agentes. Com IA (DeepSeek) entende qualquer frase; sem IA, um
 * interpretador por regras cobre os comandos principais.
 */

const ACTIONS = ["cacar", "radar", "aprovar", "responder", "piloto", "abrir", "pergunta"];
const SCREENS = { overview: "visão geral", scraper: "hunter maps", base: "base de leads", kanban: "kanban", whatsapp: "whatsapp", ai: "inteligência artificial", agents: "agentes" };

const JARVIS_PROMPT = [
  "Voce e o J.A.R.V.I.S., assistente de prospeccao B2B do vendedor (trate por 'senhor'), no estilo do Jarvis do Homem de Ferro: preciso, elegante, proativo e curto.",
  "Recebe a ordem do vendedor e um retrato dos dados reais do sistema ('dados'). Converta a ordem em UMA acao:",
  "- cacar: buscar leads novos no Google Maps. parametros: {nicho, cidade} (cidade no formato 'Bairro/Cidade, UF').",
  "- radar: procurar na internet negocios com site fraco. parametros: {nicho, cidade}.",
  "- aprovar: aprovar mensagens da fila. parametros: {quantidade} (numero; padrao 20).",
  "- responder: preparar respostas para quem respondeu.",
  "- piloto: ligar ou desligar o piloto automatico. parametros: {ligar: true|false}.",
  "- abrir: abrir uma tela. parametros: {tela: overview|scraper|base|kanban|whatsapp|ai|agents}.",
  "- pergunta: o vendedor quer saber algo; responda usando SO os 'dados' (nunca invente numeros).",
  "Em 'resposta', escreva o que voce vai fazer ou a resposta, em ate 2 frases, tom de Jarvis.",
  "Responda apenas JSON: {\"acao\":\"cacar|radar|aprovar|responder|piloto|abrir|pergunta\",\"parametros\":{},\"resposta\":\"\"}",
].join("\n");

function norm(text) {
  return String(text || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

/** Interpretador por regras (sem IA). */
function parseByRules(text) {
  const raw = String(text || "").trim();
  const t = norm(raw);
  let m = raw.match(/\b(?:ca[çc]a(?:r)?|busca(?:r)?|extrai(?:r)?|procura(?:r)?\s+no\s+maps)\s+(.+?)\s+(?:em|no|na)\s+(.+)$/i);
  if (m && !/\b(web|internet|site)/i.test(raw)) return { acao: "cacar", parametros: { nicho: m[1].trim(), cidade: m[2].trim() } };
  m = raw.match(/\b(?:radar|web|internet)\b.*?\b(?:de|para|por)?\s*([^,]+?)\s+(?:em|no|na)\s+(.+)$/i);
  if (m) return { acao: "radar", parametros: { nicho: m[1].replace(/^(de|para|por)\s+/i, "").trim(), cidade: m[2].trim() } };
  m = t.match(/\baprov\w*\b(?:\D+(\d+))?/);
  if (m) return { acao: "aprovar", parametros: { quantidade: Number(m[1]) || 20 } };
  if (/\b(prepar\w*\s+(as\s+)?respostas|responde\w*|quem respondeu)\b/.test(t) && !/\?$/.test(t)) return { acao: "responder", parametros: {} };
  m = t.match(/\b(liga\w*|ativa\w*|desliga\w*|pausa\w*|para\w*)\b.*\bpiloto\b/);
  if (m) return { acao: "piloto", parametros: { ligar: /^(liga|ativa)/.test(m[1]) } };
  for (const [id, label] of Object.entries(SCREENS)) {
    if (new RegExp(`\\b(abr\\w*|mostr\\w*|vai para|ir para)\\b.*${norm(label)}`).test(t)) return { acao: "abrir", parametros: { tela: id } };
  }
  return { acao: "pergunta", parametros: {} };
}

/**
 * Entende a ordem.
 * @returns {Promise<{acao:string, parametros:object, resposta:string, ai:boolean}>}
 */
async function understand(text, { runAi = null, dados = {} } = {}) {
  const ruled = parseByRules(text);
  if (typeof runAi !== "function") return { ...ruled, resposta: "", ai: false };
  try {
    const { result } = await runAi({ system: JARVIS_PROMPT, payload: { ordem: String(text).slice(0, 500), dados } });
    const acao = ACTIONS.includes(result?.acao) ? result.acao : ruled.acao;
    const parametros = result?.parametros && typeof result.parametros === "object" ? result.parametros : ruled.parametros;
    return { acao, parametros, resposta: String(result?.resposta || "").slice(0, 400), ai: true };
  } catch {
    return { ...ruled, resposta: "", ai: false };
  }
}

module.exports = { ACTIONS, SCREENS, JARVIS_PROMPT, parseByRules, understand };
