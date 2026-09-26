/**
 * Prompts dos agentes Analista (playbook de auto-aperfeiçoamento) e
 * Respostas (sugestões para a conversa no WhatsApp).
 */
const ANALYST_SYSTEM_PROMPT = [
  "Voce e o analista de vendas de uma operacao de prospeccao B2B por WhatsApp no Brasil.",
  "Recebe os resultados reais das campanhas (taxas, mensagens com e sem resposta, nichos, horarios, follow-up, descadastros), o perfil de quem vende e o playbook anterior.",
  "Escreva um playbook curto e acionavel que os outros agentes vao seguir. Baseie-se so nos dados; com poucos dados, diga isso e use boas praticas.",
  "Responda apenas JSON: {\"resumo\":\"\",\"regras\":[\"ate 6 regras objetivas\"],\"nichos\":[\"ate 4\"],\"horarios\":[\"ex.: 9h-11h\"],\"mensagem_recomendada\":\"primeiro contato com {{saudacao}} e spintax {a|b}, sem link, terminando em pergunta\",\"alertas\":[\"riscos, ex.: descadastro alto\"],\"proximo_experimento\":\"\"}",
].join("\n");


const { SALES_REPLY_PROMPT, STAGES } = require("./sales-playbook");

const MOMENTS = ["interessado", "curioso", "duvida", "objecao", "sem_interesse", "pediu_para_sair"];

function list(value, max, len) {
  return (Array.isArray(value) ? value : []).map((v) => String(v || "").trim().slice(0, len)).filter(Boolean).slice(0, max);
}

async function runAnalyst({ insights, commercial, previous }, runAi) {
  const { result, provider, model } = await runAi({
    system: ANALYST_SYSTEM_PROMPT,
    payload: { resultados: insights, vendedor: commercial || {}, playbook_anterior: previous || null },
  });
  const resumo = String(result?.resumo || "").trim().slice(0, 600);
  if (!resumo) throw new Error("O analista não devolveu um playbook.");
  return {
    resumo,
    regras: list(result.regras, 6, 240),
    nichos: list(result.nichos, 4, 60),
    horarios: list(result.horarios, 4, 40),
    mensagem_recomendada: String(result.mensagem_recomendada || "").replace(/https?:\/\/\S+/g, "").slice(0, 600),
    alertas: list(result.alertas, 3, 200),
    proximo_experimento: String(result.proximo_experimento || "").slice(0, 300),
    basedOnSent: Number(insights?.sent || 0),
    replyRate: Number(insights?.replyRate || 0),
    provider,
    model,
  };
}

async function suggestReplies({ messages, lead, commercial, etapa = "" }, runAi) {
  const conversation = (Array.isArray(messages) ? messages : [])
    .slice(-16)
    .map((m) => ({ de: m.fromMe ? "vendedor" : "lead", texto: String(m.text || "").slice(0, 600) }))
    .filter((m) => m.texto);
  const wanted = STAGES.includes(etapa) ? etapa : "";
  if (!conversation.length && wanted !== "abertura") throw new Error("A conversa ainda não tem mensagens: use a etapa Abrir.");
  const { result } = await runAi({
    system: SALES_REPLY_PROMPT,
    payload: { conversa: conversation, lead: lead || {}, vendedor: commercial || {}, ...(wanted ? { etapa_pedida: wanted } : {}) },
  });
  const sugestoes = list(result?.sugestoes, 3, 400);
  if (!sugestoes.length) throw new Error("A IA não sugeriu respostas. Tente novamente.");
  return {
    momento: MOMENTS.includes(result?.momento) ? result.momento : "curioso",
    etapa: wanted || (STAGES.includes(result?.etapa) ? result.etapa : ""),
    abordagem: ["automacao", "site", "google", "imagem"].includes(result?.abordagem) ? result.abordagem : "",
    motivoAbordagem: String(result?.motivo_abordagem || "").slice(0, 200),
    time: String(result?.time || "").slice(0, 160),
    leitura: String(result?.leitura || "").slice(0, 240),
    objecao: String(result?.objecao || "").slice(0, 120),
    sugestoes,
    proximoPasso: String(result?.proximo_passo || "").slice(0, 240),
  };
}

const PROPOSAL_SYSTEM_PROMPT = [
  "Voce escreve propostas comerciais curtas para enviar pelo WhatsApp a empresas locais no Brasil.",
  "Recebe o lead (dados, problemas encontrados, conversa ate aqui), a oferta e o perfil de quem vende.",
  "Escreva uma proposta em texto corrido e escaneavel (use *negrito* do WhatsApp nos titulos), com: 1) o problema que o lead tem, com os dados reais; 2) a solucao da oferta, em 3 a 5 entregas concretas; 3) o resultado esperado em termos de clientes/atendimento, sem prometer numeros que o vendedor nao informou; 4) proximo passo com uma pergunta simples.",
  "Sem link. Preco: use o do perfil do vendedor se existir; senao escreva que o valor e combinado em uma conversa rapida. Tratar a pessoa pela saudacao.",
  "Responda apenas JSON: {\"titulo\":\"\",\"proposta\":\"\"}",
].join("\n");

async function writeProposal({ lead, offer, findings, conversation, commercial }, runAi) {
  const { result } = await runAi({
    system: PROPOSAL_SYSTEM_PROMPT,
    payload: {
      lead: lead || {},
      oferta: offer || "",
      problemas: (findings || []).slice(0, 6),
      conversa: (conversation || []).slice(-12),
      vendedor: commercial || {},
    },
  });
  const proposta = String(result?.proposta || "").replace(/https?:\/\/\S+|www\.\S+/gi, "").trim().slice(0, 2500);
  if (proposta.length < 40) throw new Error("A IA não devolveu uma proposta. Tente novamente.");
  return { titulo: String(result?.titulo || "Proposta").slice(0, 120), proposta };
}

module.exports = { runAnalyst, suggestReplies, writeProposal, MOMENTS };
