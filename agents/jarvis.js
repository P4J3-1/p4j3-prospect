/**
 * J.A.R.V.I.S. do P4J3: entende ordens em português e as transforma em ações
 * dos agentes, olhando a tela em que o vendedor está. Com IA (DeepSeek)
 * entende qualquer frase; sem IA, regras cobrem os comandos principais.
 *
 * Segurança: nenhuma ação envia mensagem. Ela prepara, abre e mostra; quem
 * envia é sempre o vendedor.
 */

const ACTIONS = [
  "cacar", "radar", "aprovar", "responder", "piloto", "abrir", "pergunta",
  "abrir_conversa", "proposta", "nao_contatar", "filtrar", "ajustar", "agente",
];
const SCREENS = { overview: "visão geral", scraper: "hunter maps", base: "base de leads", kanban: "kanban", whatsapp: "whatsapp", ai: "inteligência artificial", agents: "agentes" };
const AGENT_IDS = ["cacador", "radar", "verificador", "enriquecedor", "triagem", "pesquisador", "copywriter", "respostas", "analista"];
const ADJUST_TARGETS = ["meta_diaria", "teto_por_numero", "intervalo", "rascunhos", "reserva", "caçada"];

const JARVIS_PROMPT = [
  "Voce e a J.A.R.V.I.S., a inteligencia do sistema de prospeccao B2B do vendedor, no estilo da IA do Tony Stark: elegante, cuidadosa, precisa, leal e proativa. Trate o vendedor por 'senhor'. Frases curtas.",
  "O que voce CONSEGUE fazer: falar por voz, avisar por notificacao quando um lead responde, ver a tela atual do vendedor ('contexto': tela, lead selecionado, conversa aberta), ler o 'dossie' do lead em foco, e acionar os agentes (Cacador, Radar, Verificador, Enriquecedor, Triagem, Pesquisador, Copywriter, Respostas, Analista).",
  "O que voce NUNCA faz: enviar mensagem sozinha. Voce prepara, abre a conversa com o texto e o vendedor confirma.",
  "Converta a ordem em UMA acao:",
  "- cacar {nicho, cidade}: buscar leads no Google Maps. radar {nicho, cidade}: procurar negocios com site fraco na internet.",
  "- aprovar {quantidade}: aprovar as melhores mensagens da fila. responder: preparar respostas para quem respondeu.",
  "- piloto {ligar: true|false}. abrir {tela: overview|scraper|base|kanban|whatsapp|ai|agents}.",
  "- abrir_conversa {lead, texto?}: abrir a conversa do lead (nome, ou 'este' para o que esta na tela) com um texto opcional no campo.",
  "- proposta {lead}: escrever a proposta do lead. nao_contatar {lead}: marcar para nunca contatar.",
  "- filtrar {aba: disponiveis|fila|contatados|responderam|todos, filtro: pronto|alto_potencial|sem_site|site_fraco|atendimento_manual|whatsapp|web|decisor|'', incluir: [bairros/cidades para mostrar SO eles], excluir: [bairros/cidades para tirar], nicho: 'texto do nicho', limpar: true|false}: filtrar leads no Hunter Maps por aba, criterio, regiao (bairro ou cidade) e nicho. Ex.: 'tira Ceilandia' = {excluir:['Ceilândia']}; 'so Taguatinga' = {incluir:['Taguatinga']}.",
  "- ajustar {alvo: meta_diaria|teto_por_numero|intervalo|rascunhos|reserva, valor: numero}. agente {nome: cacador|radar|verificador|enriquecedor|triagem|pesquisador|copywriter|respostas|analista, ligar: true|false}.",
  "- pergunta: o vendedor quer saber ou analisar algo (inclusive 'o que acha deste lead?', 'como respondo esta conversa?'). Responda usando SO 'dados', 'contexto' e 'dossie'. Nunca invente numeros. Seja analitica: diga o que ve e recomende a proxima acao.",
  "Use 'historico' para entender referencias ('e ele?', 'faz isso').",
  "Em 'resposta', ate 3 frases, tom elegante e cuidadoso.",
  "Responda apenas JSON: {\"acao\":\"...\",\"parametros\":{},\"resposta\":\"\"}",
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
  m = raw.match(/\b(?:abr\w*|abre)\s+(?:a\s+)?conversa\s+(?:da|do|de|com)\s+(.+)$/i);
  if (m) return { acao: "abrir_conversa", parametros: { lead: m[1].trim() } };
  m = raw.match(/\b(?:ger\w*|escrev\w*|faz\w*|prepar\w*)\s+(?:a\s+|uma\s+)?proposta\s*(?:da|do|de|para)?\s*(.*)$/i);
  if (m) return { acao: "proposta", parametros: { lead: m[1].trim() || "este" } };
  m = raw.match(/\bn[aã]o\s+contat\w*\s*(?:a|o)?\s*(.*)$/i);
  if (m) return { acao: "nao_contatar", parametros: { lead: m[1].trim() || "este" } };
  m = t.match(/\b(?:muda|mude|ajusta|ajuste|coloca|define)\w*\s+(?:a\s+|o\s+)?(meta|teto|intervalo|rascunhos?|reserva)\b\D*(\d+)/);
  if (m) {
    const alvo = { meta: "meta_diaria", teto: "teto_por_numero", intervalo: "intervalo", rascunho: "rascunhos", rascunhos: "rascunhos", reserva: "reserva" }[m[1]];
    return { acao: "ajustar", parametros: { alvo, valor: Number(m[2]) } };
  }
  m = t.match(/\b(pausa\w*|desliga\w*|para\w*|liga\w*|retoma\w*|ativa\w*)\s+(?:o\s+|a\s+)?(?:agente\s+)?(cacador|radar|verificador|enriquecedor|triagem|pesquisador|copywriter|respostas|analista)\b/);
  if (m) return { acao: "agente", parametros: { nome: m[2], ligar: /^(liga|retoma|ativa)/.test(m[1]) } };
  m = t.match(/\baprov\w*\b(?:\D+(\d+))?/);
  if (m) return { acao: "aprovar", parametros: { quantidade: Number(m[1]) || 20 } };
  if (/\b(prepar\w*\s+(as\s+)?respostas|responde\w*|quem respondeu)\b/.test(t) && !/\?$/.test(t)) return { acao: "responder", parametros: {} };
  m = t.match(/\b(liga\w*|ativa\w*|desliga\w*|pausa\w*|para\w*)\b.*\bpiloto\b/);
  if (m) return { acao: "piloto", parametros: { ligar: /^(liga|ativa)/.test(m[1]) } };
  if (/\b(mostra|filtra|quero ver)\b.*\b(quentes?|prontos?)\b/.test(t)) return { acao: "filtrar", parametros: { aba: "disponiveis", filtro: /quente/.test(t) ? "alto_potencial" : "pronto" } };
  if (/\b(limpa\w*|tira\w*)\s+(os\s+)?filtros?\b/.test(t)) return { acao: "filtrar", parametros: { limpar: true, filtro: "" } };
  // Região: "tira Ceilândia", "retire os da região Ceilândia", "só Taguatinga".
  m = raw.match(/\b(?:retir\w*|tir\w*|remov\w*|exclu\w*|sem)\s+(?:(?:os|as|leads?|da|de|do|dos|das|regi[aã]o|bairro|cidade)\s+)*([\wÀ-ú][\wÀ-ú' -]{2,40})$/i);
  if (m) return { acao: "filtrar", parametros: { excluir: [m[1].trim()] } };
  m = raw.match(/\b(?:s[oó]|somente|apenas)\s+(?:(?:os|as|leads?|da|de|do|dos|das|regi[aã]o|bairro|cidade|em|no|na)\s+)*([\wÀ-ú][\wÀ-ú' -]{2,40})$/i);
  if (m) return { acao: "filtrar", parametros: { incluir: [m[1].trim()] } };
  for (const [id, label] of Object.entries(SCREENS)) {
    if (new RegExp(`\\b(abr\\w*|mostr\\w*|vai para|ir para)\\b.*${norm(label)}`).test(t)) return { acao: "abrir", parametros: { tela: id } };
  }
  return { acao: "pergunta", parametros: {} };
}

/**
 * Entende a ordem, com a tela atual e o histórico da conversa.
 * @returns {Promise<{acao:string, parametros:object, resposta:string, ai:boolean}>}
 */
async function understand(text, { runAi = null, dados = {}, contexto = null, dossie = null, historico = [] } = {}) {
  const ruled = parseByRules(text);
  if (typeof runAi !== "function") return { ...ruled, resposta: "", ai: false };
  try {
    const { result } = await runAi({
      system: JARVIS_PROMPT,
      payload: { ordem: String(text).slice(0, 500), dados, contexto, dossie, historico: (historico || []).slice(-6) },
    });
    const acao = ACTIONS.includes(result?.acao) ? result.acao : ruled.acao;
    const parametros = result?.parametros && typeof result.parametros === "object" ? result.parametros : ruled.parametros;
    return { acao, parametros, resposta: String(result?.resposta || "").slice(0, 600), ai: true };
  } catch {
    return { ...ruled, resposta: "", ai: false };
  }
}

module.exports = { ACTIONS, SCREENS, AGENT_IDS, ADJUST_TARGETS, JARVIS_PROMPT, parseByRules, understand, norm };
