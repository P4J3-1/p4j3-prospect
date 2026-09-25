/**
 * Otimiza a mensagem de campanha com IA a partir do que já funcionou
 * (auto-aperfeiçoamento: cada campanha disparada melhora a próxima).
 */
const OPTIMIZER_SYSTEM_PROMPT = [
  "Voce e copywriter especialista em prospeccao B2B por WhatsApp no Brasil.",
  "Reescreva a mensagem de primeiro contato e o follow-up usando os aprendizados reais das campanhas (mensagens que tiveram resposta x ignoradas, nichos e horarios).",
  "Regras obrigatorias:",
  "- Primeiro contato: ate 350 caracteres, sem link, sem preco, termina com UMA pergunta facil de responder.",
  "- Use {{saudacao}} para chamar a pessoa (nunca o nome da empresa como se fosse pessoa) e {{name}} so para citar a empresa.",
  "- Use spintax {opcao1|opcao2} em 2 a 4 pontos para que as mensagens nao saiam identicas.",
  "- Follow-up: curto, gentil, e termina oferecendo a saida: responder SAIR.",
  "- Preserve o que o vendedor oferece; nao prometa resultados que nao pode garantir.",
  "- Com poucos dados, siga boas praticas e diga isso na explicacao.",
  "Responda apenas JSON: {\"mensagem\":\"\",\"follow_up\":\"\",\"explicacao\":\"\",\"hipoteses\":[]}",
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
    hipoteses: (Array.isArray(result?.hipoteses) ? result.hipoteses : []).map(String).slice(0, 4),
    provider,
    model,
  };
}

module.exports = { optimizeCampaignMessage };
