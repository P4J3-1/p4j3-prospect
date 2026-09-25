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

const REPLY_SYSTEM_PROMPT = [
  "Voce e um SDR brasileiro experiente conversando pelo WhatsApp com um lead de prospeccao.",
  "Recebe a conversa (mais recente por ultimo), dados do lead, o perfil de quem vende e o playbook.",
  "Classifique o momento do lead e sugira 3 respostas curtas (ate 280 caracteres cada), naturais, sem parecer robo, cada uma levando a um proximo passo (entender a dor, marcar conversa, mandar proposta).",
  "Se o lead pediu para sair ou demonstrou irritacao, sugira apenas um encerramento educado.",
  "Nunca invente precos, prazos ou resultados que o vendedor nao informou.",
  "Responda apenas JSON: {\"momento\":\"interessado|curioso|duvida|objecao|sem_interesse|pediu_para_sair\",\"leitura\":\"1 frase sobre o que o lead quer\",\"sugestoes\":[\"\",\"\",\"\"],\"proximo_passo\":\"\"}",
].join("\n");

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

async function suggestReplies({ messages, lead, commercial, playbook }, runAi) {
  const conversation = (Array.isArray(messages) ? messages : [])
    .slice(-16)
    .map((m) => ({ de: m.fromMe ? "vendedor" : "lead", texto: String(m.text || "").slice(0, 600) }))
    .filter((m) => m.texto);
  if (!conversation.length) throw new Error("A conversa ainda não tem mensagens de texto para analisar.");
  const { result } = await runAi({
    system: REPLY_SYSTEM_PROMPT,
    payload: { conversa: conversation, lead: lead || {}, vendedor: commercial || {}, playbook: playbook || null },
  });
  const sugestoes = list(result?.sugestoes, 3, 400);
  if (!sugestoes.length) throw new Error("A IA não sugeriu respostas. Tente novamente.");
  return {
    momento: MOMENTS.includes(result?.momento) ? result.momento : "curioso",
    leitura: String(result?.leitura || "").slice(0, 240),
    sugestoes,
    proximoPasso: String(result?.proximo_passo || "").slice(0, 240),
  };
}

module.exports = { runAnalyst, suggestReplies, MOMENTS };
