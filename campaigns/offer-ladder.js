/**
 * Escada de ofertas B2B: o problema encontrado na triagem define a oferta de
 * entrada; quem não responde recebe, depois, a próxima oferta da escada.
 * Também monta o diagnóstico de imagem (reputação no Google comparada aos
 * concorrentes do mesmo bairro e nicho).
 */
const OFFERS = {
  site: {
    label: "Site profissional",
    gancho: "ter um site próprio que aparece no Google e leva o cliente direto para o WhatsApp",
  },
  reforma_site: {
    label: "Reformulação do site",
    gancho: "deixar o site rápido, bonito no celular e pensado para gerar pedidos",
  },
  automacao: {
    label: "Automação de WhatsApp",
    gancho: "responder clientes na hora, 24h, sem perder pedido fora do horário",
  },
  imagem: {
    label: "Presença de imagem (Google e redes)",
    gancho: "fortalecer a imagem no Google e nas redes para passar mais confiança que os concorrentes",
  },
};

// Roteiro de objeções por serviço: resposta curta + próximo passo (sem preço, sem prometer resultado).
const OBJECTIONS = {
  _comum: [
    { objecao: "Está caro / não tenho verba", resposta: "Entendo. Antes de falar de valor, me diz: quantos clientes por mês vocês acham que deixam de fechar hoje? Se o que eu proponho não se pagar com isso, não faz sentido." },
    { objecao: "Não tenho tempo agora", resposta: "Justo! Por isso eu cuido de tudo; de você só preciso de 15 minutos para entender o negócio. Qual o melhor dia essa semana?" },
    { objecao: "Me manda uma proposta", resposta: "Mando sim! Para ela vir certeira, posso te fazer 3 perguntas rápidas sobre como os clientes chegam até vocês hoje?" },
    { objecao: "Vou pensar", resposta: "Claro. Para te ajudar a pensar: o que pesaria mais na decisão, valor, prazo ou ter certeza de que vai trazer cliente?" },
  ],
  site: [{ objecao: "O Instagram já resolve", resposta: "O Instagram ajuda muito! O site entra para quem pesquisa no Google e ainda não segue vocês; é outro público. Quer que eu te mostre quem aparece hoje quando procuram seu serviço aqui?" }],
  reforma_site: [{ objecao: "Já tenho site", resposta: "Ótimo, então o caminho é mais curto: é ajustar o que já existe para virar pedido pelo WhatsApp. Posso te apontar os 3 pontos que eu mudaria primeiro?" }],
  automacao: [{ objecao: "Prefiro atender pessoalmente", resposta: "E deve continuar! A automação só responde na hora e organiza o pedido; a conversa importante continua com você. Quantas mensagens chegam fora do horário?" }],
  imagem: [{ objecao: "Não ligo para avaliação no Google", resposta: "Entendo. Só que quem não te conhece compara as notas antes de ligar. Quer ver como vocês aparecem hoje em relação a quem está perto?" }],
};

/** Objeções comuns + as específicas da oferta. */
function objectionsFor(offer) {
  return [...(OBJECTIONS[offer] || []), ...OBJECTIONS._comum];
}

const LADDERS = {
  site: ["site", "automacao", "imagem"],
  reforma_site: ["reforma_site", "imagem", "automacao"],
  automacao: ["automacao", "site", "imagem"],
  imagem: ["imagem", "site", "automacao"],
};

/** Oferta de entrada a partir dos segmentos da triagem. */
function entryOffer(triage) {
  const seg = new Set(triage?.segments || []);
  if (seg.has("sem_site") || seg.has("so_rede_social")) return "site";
  if (seg.has("site_fora_do_ar") || seg.has("site_fraco")) return "reforma_site";
  if (seg.has("atendimento_manual")) return "automacao";
  return "imagem";
}

/** Próxima oferta da escada que ainda não foi feita a este lead (null = esgotou). */
function nextOffer(entry, tried = []) {
  const ladder = LADDERS[entry] || LADDERS.imagem;
  return ladder.find((id) => !tried.includes(id)) || null;
}

function toNumber(value) {
  const n = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function reviewCount(lead) {
  return Number(String(lead?.reviewCount ?? lead?.reviews ?? lead?.totalReviews ?? 0).replace(/\D/g, "")) || 0;
}

function median(values) {
  const list = values.filter((v) => v > 0).sort((a, b) => a - b);
  if (!list.length) return 0;
  const mid = Math.floor(list.length / 2);
  return list.length % 2 ? list[mid] : (list[mid - 1] + list[mid]) / 2;
}

/**
 * Diagnóstico de imagem com dados que o Google Maps mostra. `peers` são os
 * concorrentes do mesmo nicho (idealmente do mesmo bairro) já na base.
 * `comparacao` é argumento para DEPOIS que a conversa começou: não entra no
 * primeiro contato.
 */
function imageDiagnosis(lead = {}, peers = []) {
  const findings = [];
  const rating = toNumber(lead.rating);
  const reviews = reviewCount(lead);
  const photos = Number(lead.photos?.count ?? lead.photoCount ?? 0) || 0;
  const others = peers.filter((p) => p !== lead && (p.placeId ? p.placeId !== lead.placeId : p.name !== lead.name));
  const medRating = median(others.map((p) => toNumber(p.rating)));
  const medReviews = median(others.map(reviewCount));

  if (reviews && reviews < 20) findings.push(`Poucas avaliações no Google (${reviews})`);
  if (rating && rating < 4.3) findings.push(`Nota ${String(rating).replace(".", ",")} no Google, abaixo do que passa confiança (4,5+)`);
  if (photos <= 2) findings.push("Poucas fotos no perfil do Google");
  if (!lead.instagram) findings.push("Sem Instagram ligado ao perfil");

  let comparacao = null;
  if (others.length >= 3) {
    const better = others
      .filter((p) => toNumber(p.rating) > rating && reviewCount(p) > reviews)
      .sort((a, b) => reviewCount(b) - reviewCount(a))[0];
    comparacao = {
      concorrentes: others.length,
      notaMediana: medRating,
      avaliacoesMediana: medReviews,
      abaixoDaMedia: (rating && medRating && rating < medRating) || (medReviews && reviews < medReviews * 0.5),
      destaque: better ? { nome: better.name, nota: toNumber(better.rating), avaliacoes: reviewCount(better) } : null,
    };
  }
  return { findings, comparacao };
}

module.exports = { LADDERS, OBJECTIONS, OFFERS, entryOffer, imageDiagnosis, nextOffer, objectionsFor, reviewCount };
