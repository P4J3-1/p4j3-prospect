/**
 * Escreve as mensagens da fila de envio: primeiro contato (pela oferta de
 * entrada), follow-up e nova oferta. Com IA, personaliza por lead em lotes;
 * sem IA (ou se ela falhar), usa modelos com variações. Nunca envia link.
 */
const { interpolate } = require("./template-engine");
const { OFFERS } = require("./offer-ladder");
const { OPENERS } = require("../agents/sales-playbook");

const TEMPLATES = {
  primeiro: {
    site: "{Oi|Olá}, {{saudacao}}! Vi {vocês|o perfil de vocês} no Google Maps e {percebi|notei} que ainda não têm um site próprio. {Hoje|Atualmente} muita gente pesquisa antes de chamar. Posso te mostrar em 2 linhas como um site simples traria mais clientes pelo WhatsApp?",
    reforma_site: "{Oi|Olá}, {{saudacao}}! Dei uma olhada no site de vocês pelo celular e {vi|notei} alguns pontos que podem estar fazendo clientes desistirem. Posso te mandar {rapidinho|em 2 linhas} o que eu mudaria?",
    automacao: "{Oi|Olá}, {{saudacao}}! Vi que vocês atendem pelo WhatsApp. {Quantas|Muitas} mensagens chegam fora do horário e ficam sem resposta? Tenho uma ideia {simples|prática} para isso, posso te explicar?",
    imagem: "{Oi|Olá}, {{saudacao}}! Vi o perfil de vocês no Google e {tive|pensei em} uma ideia {simples|rápida} para passar mais confiança para quem pesquisa e acabar escolhendo vocês. Posso te mostrar?",
  },
  follow_up: "{Oi|Olá} de novo, {{saudacao}}! Só confirmando se viu minha mensagem acima 🙂 Se não fizer sentido agora, é só responder SAIR que não te chamo mais.",
  nova_oferta: "{Oi|Olá}, {{saudacao}}! Entendo que [ANTERIOR] talvez não seja prioridade agora. Uma outra coisa que tem ajudado {negócios|empresas} como o de vocês é [GANCHO]. Faz sentido eu te contar como?",
};

function templateFor(item) {
  if (item.kind === "follow_up") return TEMPLATES.follow_up;
  if (item.kind === "nova_oferta") {
    const previous = OFFERS[item.previousOffer]?.label?.toLowerCase() || "o que te mandei";
    const hook = OFFERS[item.offer]?.gancho || "melhorar a presença digital";
    return TEMPLATES.nova_oferta.replace("[ANTERIOR]", previous).replace("[GANCHO]", hook);
  }
  // 1º contato: só a abertura curta ("oi, é da X?"), sorteada entre várias
  // estruturas. A oferta vem depois, na conversa conduzida por perguntas.
  return OPENERS[Math.floor(Math.random() * OPENERS.length)];
}

/** "Pizzaria Bueno - Ceilândia Sul" → "Pizzaria Bueno": ninguém fala o bairro junto do nome. */
function shortBusinessName(name) {
  const first = String(name || "").split(/\s+[-–—|·:]\s+|\s*\|\s*/)[0].trim();
  return first.length >= 3 ? first : String(name || "").trim();
}

function cleanMessage(text) {
  return String(text || "")
    .replace(/https?:\/\/\S+|www\.\S+/gi, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\s{3,}/g, "  ")
    .trim()
    .slice(0, 700);
}

const COMPOSER_SYSTEM_PROMPT = [
  "Voce e um SDR brasileiro que escreve mensagens de WhatsApp para prospectar empresas locais (B2B).",
  "Para cada item, escreva UMA mensagem pronta para enviar, conforme o tipo:",
  "- primeiro: primeiro contato de ate 350 caracteres, citando no maximo um problema real da lista 'problemas' ligado a oferta, sem vender direto, terminando com uma pergunta facil de responder.",
  "- follow_up: lembrete curto e gentil, terminando com a opcao de responder SAIR.",
  "- nova_oferta: reconheca que a oferta anterior pode nao ser prioridade e apresente a nova oferta em uma frase, terminando com uma pergunta.",
  "Regras e motivos: nunca inclua link (mensagem com link de desconhecido gera denuncia e bloqueio); chame a pessoa pela 'saudacao' informada, porque ninguem se chama pelo nome da empresa; nao cite concorrentes, precos ou prazos; tom natural, sem parecer robo.",
  "Responda apenas JSON: {\"mensagens\":[{\"key\":\"\",\"mensagem\":\"\"}]}",
].join("\n");

/**
 * @param {Array<{key:string, kind:'primeiro'|'follow_up'|'nova_oferta', offer:string, previousOffer?:string, lead:object, findings?:string[]}>} items
 * @returns {Promise<Map<string, {mensagem:string, ai:boolean}>>}
 */
async function composeMessages(items = [], { runAi = null, commercial = {}, aiBudget = Infinity } = {}) {
  const out = new Map();
  for (const item of items) {
    const lead = item.kind === "primeiro" ? { ...(item.lead || {}), name: shortBusinessName(item.lead?.name) } : item.lead || {};
    // Abertura sorteada e registrada: o Raio-X mede qual estrutura mais responde.
    const opener = item.kind === "primeiro" ? Math.floor(Math.random() * OPENERS.length) : undefined;
    const template = opener !== undefined ? OPENERS[opener] : templateFor(item);
    out.set(item.key, { mensagem: cleanMessage(interpolate(template, lead)), ai: false, opener });
  }
  if (typeof runAi !== "function") return out;

  // A abertura não passa pela IA: curta e variada já é o melhor que existe.
  const eligible = items.filter((item) => item.kind !== "primeiro").slice(0, Math.max(0, aiBudget));
  for (let start = 0; start < eligible.length; start += 8) {
    const chunk = eligible.slice(start, start + 8);
    try {
      const { result } = await runAi({
        system: COMPOSER_SYSTEM_PROMPT,
        payload: {
          vendedor: commercial,
          itens: chunk.map((item) => ({
            key: item.key,
            tipo: item.kind,
            oferta: OFFERS[item.offer]?.label || item.offer,
            oferta_anterior: item.previousOffer ? OFFERS[item.previousOffer]?.label : undefined,
            empresa: item.lead?.name,
            nicho: item.lead?.category,
            cidade: item.lead?.city,
            saudacao: interpolate("{{saudacao}}", item.lead || {}),
            problemas: (item.findings || []).slice(0, 4),
          })),
        },
      });
      const rows = Array.isArray(result?.mensagens) ? result.mensagens : [];
      chunk.forEach((item, pos) => {
        const row = rows.find((r) => r?.key === item.key) || rows[pos];
        const text = cleanMessage(interpolate(String(row?.mensagem || ""), item.lead || {}));
        if (text.length >= 20) out.set(item.key, { mensagem: text, ai: true });
      });
    } catch {
      break; // segue com os modelos
    }
  }
  return out;
}

module.exports = { TEMPLATES, cleanMessage, composeMessages, templateFor };
