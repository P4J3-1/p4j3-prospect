/**
 * Otimiza a mensagem de campanha com IA a partir do que já funcionou
 * (auto-aperfeiçoamento: cada campanha disparada melhora a próxima).
 */
const OPTIMIZER_SYSTEM_PROMPT = [
  "Voce e copywriter especialista em prospeccao B2B por WhatsApp no Brasil.",
  "Reescreva a mensagem de primeiro contato e o follow-up usando os aprendizados reais das campanhas (mensagens que tiveram resposta x ignoradas, nichos e horarios).",
  "Regras e seus motivos:",
  "- Primeiro contato com ate 350 caracteres, sem link e sem preco, terminando com uma pergunta facil de responder: mensagem curta e sem link de desconhecido gera menos denuncia, e pergunta facil gera resposta.",
  "- Use {{saudacao}} para chamar a pessoa e {{name}} so para citar a empresa, porque ninguem se chama pelo nome da empresa.",
  "- Use spintax {opcao1|opcao2} em 2 a 4 pontos: mensagens identicas em massa sao o principal gatilho de bloqueio do numero.",
  "- Follow-up curto e gentil, terminando com a opcao de responder SAIR (o sistema descadastra quem responde SAIR).",
  "- Mantenha o que o vendedor oferece e nao prometa resultados que ele nao pode garantir.",
  "- Com poucos dados, siga boas praticas e diga isso na explicacao.",
  "Responda apenas JSON: {\"mensagem\":\"\",\"follow_up\":\"\",\"explicacao\":\"\"}",
].join("\n");

const REQUIRED_VAR = "{{saudacao}}";

function sanitizeTemplate(text, max) {
  return String(text || "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .trim()
    .slice(0, max);
}

async function optimizeCampaignMessage({ template, followUp, insights, commercial }, runAi) {
  const { result, provider, model } = await runAi({
    system: OPTIMIZER_SYSTEM_PROMPT,
    payload: {
      mensagem_atual: template || "",
      follow_up_atual: followUp || "",
      vendedor: commercial || {},
      aprendizados: insights || null,
    },
  });
  let mensagem = sanitizeTemplate(result?.mensagem, 600);
  if (!mensagem) throw new Error("A IA não devolveu uma mensagem. Tente novamente.");
  if (!mensagem.includes(REQUIRED_VAR)) mensagem = `{Oi|Olá}, ${REQUIRED_VAR}! ${mensagem}`;
  return {
    mensagem,
    followUp: sanitizeTemplate(result?.follow_up, 400),
    explicacao: String(result?.explicacao || "").slice(0, 800),
    provider,
    model,
  };
}

module.exports = { optimizeCampaignMessage };
