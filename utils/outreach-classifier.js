/**
 * Classifica conversas de prospecção:
 *  - resposta automática (saudação do WhatsApp Business, menu, pesquisa de
 *    satisfação) não é resposta de verdade e não pode virar "Respondeu";
 *  - conversa pessoal não é prospecção e não pode virar "Contatado".
 */

// Frases que praticamente só aparecem em mensagem automática: valem sozinhas.
const STRONG_PATTERNS = [
  /mensagem autom[aá]tica/i,
  /pesquisa de satisfa[cç][aã]o/i,
  /atendimento (foi )?iniciado/i,
  /seja (muito )?bem[- ]?vind[oa](\(a\)|\(o\))? (a[oà]?|à) /i,
  /(assistente|atendente) virtual/i,
];

const AUTO_PATTERNS = [
  ...STRONG_PATTERNS,
  /seja (muito )?bem[- ]?vind[oa]/i,
  /(que bom|alegria|prazer) (em )?ter voc[eê]/i,
  /agradece (o |seu |sua |pelo )?(seu )?(contato|mensagem|avalia)/i,
  /(obrigad[oa]|obgd?a?|grat[oa]) (por|pelo) (entrar em )?contato/i,
  /agradecemos (o |a |seu |sua |pelo )?(contato|mensagem)/i,
  /(em breve|assim que poss[ií]vel) (retornaremos|responderemos|entraremos|um de nossos|nossa equipe)/i,
  /(retornaremos|responderemos) (em breve|o mais breve|assim que)/i,
  /hor[aá]rio de (atendimento|funcionamento)/i,
  /(no momento )?(n[aã]o )?(estamos|estou) (dispon[ií]ve(l|is)|ausente|fora do hor[aá]rio)/i,
  /(digite|escolha|selecione) (o n[uú]mero|uma das op[cç][oõ]es|a op[cç][aã]o)/i,
  /\b1\s*[-–).]\s*\S+[\s\S]{0,80}\b2\s*[-–).]\s*\S+/,
  /(avalie|avalia[cç][aã]o d[eo]|nos ajude a (aprimorar|melhorar))/i,
  /como (podemos|posso) (te |lhe )?ajudar\??\s*$/i,
  /(nosso|nossa) (card[aá]pio|cat[aá]logo) (est[aá]|segue)/i,
];

/**
 * @param {string} text texto da mensagem recebida
 * @param {number} [delayMs] tempo desde a sua mensagem anterior
 */
function isAutoReply(text, delayMs = Infinity) {
  const t = String(text || "").trim();
  if (!t) return false;
  if (STRONG_PATTERNS.some((re) => re.test(t))) return true;
  const hits = AUTO_PATTERNS.filter((re) => re.test(t)).length;
  // Muito texto padrão, ou texto padrão que chegou logo depois da sua mensagem.
  if (hits >= 2) return true;
  if (hits >= 1 && delayMs <= 10 * 60 * 1000) return true;
  return false;
}

const PROSPECT_PATTERNS = /(presen[çc]a (digital|online)|\bsite\b|google|oportunidade|an[aá]lise|analisei|instagram|avalia[çc][õo]es|agendamento|automa[çc][ãa]o|diagn[oó]stico|pessoal d[ao]|mais clientes|atendimento autom)/i;

/** A primeira mensagem sua parece abordagem comercial? */
function looksLikeProspecting(text) {
  const t = String(text || "");
  return t.length >= 60 && PROSPECT_PATTERNS.test(t);
}

/**
 * Entra no controle de contatados? Lead da base, envio feito pelo app, ou
 * conversa que você começou com texto de prospecção.
 */
function isProspectingConversation(entry, { isKnownLead = false, sentByApp = false } = {}) {
  if (isKnownLead || sentByApp) return true;
  return !!entry?.startedByMe && looksLikeProspecting(entry?.firstText);
}

module.exports = { isAutoReply, looksLikeProspecting, isProspectingConversation };
