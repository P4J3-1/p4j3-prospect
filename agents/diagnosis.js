/**
 * Diagnóstico P4J3: o "presente de valor" prometido na conversa, em PDF de
 * uma página, com os dados reais do lead. A IA escreve em linguagem de dono
 * de negócio; sem IA, as regras montam o mesmo documento com os achados.
 */

const DIAGNOSIS_PROMPT = [
  "Voce escreve diagnosticos de presenca digital para donos de negocios locais no Brasil, em nome do vendedor.",
  "Recebe os dados REAIS do negocio ('dados'): nota e avaliacoes no Google, problemas do site, teste de cliente oculto, concorrentes da regiao e segmentos encontrados.",
  "Escreva em portugues simples de dono de negocio (sem termos tecnicos soltos; se usar, explique em 3 palavras). Seja especifico com os numeros reais. Nunca invente dado que nao veio.",
  "Estrutura: resumo (2 frases: onde o negocio esta e o que isso custa em clientes); fortes (2-3 pontos que ja estao bons, para gerar confianca); problemas (exatamente 3: titulo curto, impacto em clientes/dinheiro, solucao em 1 frase); plano (4 semanas, uma acao por semana, o que o cliente ganha); proximo_passo (convite leve, sem pressao, terminando em pergunta).",
  "Tom: consultor honesto, respeitoso, que quer ajudar. Sem exagero, sem promessa de resultado garantido.",
  "Responda apenas JSON: {\"titulo\":\"\",\"resumo\":\"\",\"fortes\":[\"\"],\"problemas\":[{\"titulo\":\"\",\"impacto\":\"\",\"solucao\":\"\"}],\"plano\":[{\"semana\":\"Semana 1\",\"acao\":\"\",\"ganho\":\"\"}],\"proximo_passo\":\"\"}",
].join("\n");

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

/** Diagnóstico por regras (sem IA ou se a IA falhar). */
// Problemas conhecidos: cada tipo aparece uma vez, com impacto e solução reais.
const KNOWN = [
  { id: "site_off", re: /fora do ar|erro|http \d{3}/i, titulo: "Site fora do ar", impacto: "Quem pesquisa e clica no site não consegue abrir e vai para o concorrente.", solucao: "Colocar no ar uma página rápida, com os serviços e o botão de WhatsApp." },
  { id: "sem_site", re: /n[aã]o tem site|sem site|s[oó] rede social/i, titulo: "Sem site próprio", impacto: "Quem pesquisa no Google não encontra uma página de vocês e escolhe quem aparece.", solucao: "Uma página simples com os serviços, fotos e o botão de WhatsApp." },
  { id: "mobile", re: /celular/i, titulo: "Site ruim no celular", impacto: "A maioria procura pelo celular; página difícil faz o cliente sair.", solucao: "Página pensada para celular, com os serviços e o botão de contato." },
  { id: "wa_btn", re: /sem bot[aã]o de whatsapp/i, titulo: "Sem botão de WhatsApp no site", impacto: "O cliente precisa copiar o número; muitos desistem no meio.", solucao: "Botão de WhatsApp em destaque em todas as páginas." },
  { id: "automacao", re: /automa[cç][aã]o|atende pelo whatsapp/i, titulo: "Atendimento só manual no WhatsApp", impacto: "Mensagens fora do horário ou em horário de pico ficam sem resposta e o cliente vai embora.", solucao: "Resposta automática na hora, com preços, horários e link de agendamento." },
  { id: "lento", re: /lento/i, titulo: "Site lento", impacto: "Cada segundo de espera faz visitantes desistirem.", solucao: "Otimizar imagens e hospedagem." },
  { id: "google", re: /google|descri[cç][aã]o|t[ií]tulo/i, titulo: "Pouco claro para o Google", impacto: "O Google não entende o que vocês fazem e mostra outro negócio no lugar.", solucao: "Título e descrição com o serviço e a região." },
];

/** Diagnóstico por regras (sem IA ou se a IA falhar). */
function ruleContent(d) {
  const problems = [];
  const used = new Set();
  const add = (p) => {
    if (problems.length >= 3 || used.has(p.id)) return;
    used.add(p.id);
    problems.push({ titulo: p.titulo, impacto: p.impacto, solucao: p.solucao });
  };
  const reviews = Number(d.avaliacoes) || 0;
  if (d.cliente_oculto && /não respondeu|sem resposta|\d+\s*(min|h)/.test(d.cliente_oculto)) {
    add({ id: "demora", titulo: "Demora para responder quem pergunta preço", impacto: `No teste, um cliente que perguntou o preço ${d.cliente_oculto.replace(/^respondeu um cliente/, "foi respondido")}. Nesse tempo ele já fechou com outro.`, solucao: "Resposta automática imediata com as informações principais e agendamento." });
  }
  for (const text of [...(d.site_problemas || []), ...(d.problemas || [])]) {
    const known = KNOWN.find((k) => k.re.test(text));
    if (known) add(known);
  }
  if (reviews < 20) {
    add({ id: "reviews", titulo: reviews ? `Só ${reviews} avaliação${reviews === 1 ? "" : "ões"} no Google` : "Sem avaliações no Google", impacto: "Quem compara vê poucas avaliações e escolhe quem tem mais prova de qualidade.", solucao: "Pedido de avaliação automático depois de cada atendimento." });
  }
  for (const k of KNOWN) if (problems.length < 3 && !used.has(k.id) && k.id === "google") add(k);
  const fortes = [];
  if (Number(d.nota) >= 4.5 && reviews >= 20) fortes.push(`Nota ${String(d.nota).replace(".", ",")} no Google com ${reviews} avaliações: seus clientes aprovam o serviço.`);
  else if (Number(d.nota) >= 4.5) fortes.push("Quem avaliou deu nota máxima: o serviço agrada.");
  if (d.site && !used.has("site_off")) fortes.push("Já existe um site: o caminho é ajustar, não começar do zero.");
  if (!fortes.length) fortes.push("Um negócio com clientes reais e espaço claro para crescer no digital.");
  const name = String(d.nome || "").split(/\s+[-|·]\s+/)[0];
  return {
    titulo: `Diagnóstico de presença digital — ${name}`,
    resumo: `${name} tem um serviço aprovado por quem conhece, mas ${problems.length} ponto${problems.length === 1 ? "" : "s"} faz${problems.length === 1 ? "" : "em"} clientes escolherem outro lugar antes de falar com vocês. São ajustes rápidos e de baixo custo.`,
    fortes,
    problemas: problems,
    plano: [
      { semana: "Semana 1", acao: problems[0]?.solucao || "Ajustar o perfil do Google.", ganho: "Mais gente encontrando vocês." },
      { semana: "Semana 2", acao: problems[1]?.solucao || "Botão de WhatsApp e resposta rápida.", ganho: "Menos clientes perdidos no caminho." },
      { semana: "Semana 3", acao: problems[2]?.solucao || "Fotos e informações atualizadas.", ganho: "Mais confiança na primeira impressão." },
      { semana: "Semana 4", acao: "Medir de onde vêm os clientes e ajustar.", ganho: "Decisões com números, não no achismo." },
    ],
    proximo_passo: "Se fizer sentido, te explico em 10 minutos como fazemos isso. Qual o melhor horário para você?",
  };
}

function cleanContent(c, fallback) {
  const list = (v, n) => (Array.isArray(v) ? v : []).slice(0, n);
  const problemas = list(c?.problemas, 3)
    .map((p) => ({ titulo: String(p?.titulo || "").slice(0, 80), impacto: String(p?.impacto || "").slice(0, 240), solucao: String(p?.solucao || "").slice(0, 200) }))
    .filter((p) => p.titulo);
  if (!c?.resumo || problemas.length < 2) return fallback;
  return {
    titulo: String(c.titulo || fallback.titulo).slice(0, 90),
    resumo: String(c.resumo).slice(0, 420),
    fortes: list(c.fortes, 3).map((x) => String(x).slice(0, 180)).filter(Boolean),
    problemas,
    plano: list(c.plano, 4).map((p) => ({ semana: String(p?.semana || "").slice(0, 20), acao: String(p?.acao || "").slice(0, 160), ganho: String(p?.ganho || "").slice(0, 120) })).filter((p) => p.acao),
    proximo_passo: String(c.proximo_passo || fallback.proximo_passo).replace(/https?:\/\/\S+|www\.\S+/gi, "").slice(0, 240),
  };
}

/** Conteúdo do diagnóstico (IA quando houver, regras como rede de segurança). */
async function buildDiagnosis(dados, runAi) {
  const fallback = ruleContent(dados);
  if (typeof runAi !== "function") return { ...fallback, ai: false };
  try {
    const { result } = await runAi({ system: DIAGNOSIS_PROMPT, payload: { dados } });
    return { ...cleanContent(result, fallback), ai: true };
  } catch {
    return { ...fallback, ai: false };
  }
}

/** HTML de uma página A4, pronto para virar PDF. */
function renderDiagnosisHtml(c, { lead = {}, seller = {}, date = new Date() } = {}) {
  const brand = escapeHtml(seller.agencyName || "P4J3");
  const who = escapeHtml([seller.sellerName, seller.agencyName].filter(Boolean).join(" · ") || "P4J3");
  const nota = lead.nota ? `${String(lead.nota).replace(".", ",")}★${lead.avaliacoes ? ` · ${escapeHtml(lead.avaliacoes)} ${Number(lead.avaliacoes) === 1 ? "avaliação" : "avaliações"}` : ""}` : "";
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${escapeHtml(c.titulo)}</title>
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: "Segoe UI", Arial, sans-serif; color: #0f172a; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .page { width: 210mm; min-height: 297mm; padding: 14mm 15mm 12mm; position: relative; }
  .top { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #0891b2; padding-bottom: 8px; }
  .brand { font-weight: 800; letter-spacing: .18em; color: #0891b2; font-size: 12px; }
  .date { font-size: 10px; color: #64748b; }
  h1 { font-size: 21px; margin: 10px 0 2px; line-height: 1.2; }
  .sub { color: #475569; font-size: 11.5px; margin: 0 0 10px; }
  .resumo { background: linear-gradient(135deg, #ecfeff, #f0fdf4); border-left: 4px solid #0891b2; padding: 10px 12px; border-radius: 8px; font-size: 12.5px; line-height: 1.5; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .1em; color: #0e7490; margin: 14px 0 6px; }
  ul.fortes { margin: 0; padding-left: 18px; font-size: 12px; line-height: 1.5; }
  .probs { display: grid; gap: 7px; }
  .prob { border: 1px solid #e2e8f0; border-radius: 10px; padding: 8px 11px; display: grid; grid-template-columns: 24px 1fr; gap: 2px 8px; }
  .prob .n { grid-row: span 3; width: 24px; height: 24px; border-radius: 50%; background: #dc2626; color: #fff; font-weight: 800; font-size: 12px; display: grid; place-items: center; }
  .prob b { font-size: 12.5px; }
  .prob .imp { font-size: 11.5px; color: #991b1b; }
  .prob .sol { font-size: 11.5px; color: #166534; }
  table { width: 100%; border-collapse: collapse; font-size: 11.5px; }
  td { padding: 6px 8px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
  td.w { width: 72px; font-weight: 800; color: #0891b2; white-space: nowrap; }
  td.g { color: #475569; width: 34%; }
  .next { margin-top: 12px; background: #0f172a; color: #e2e8f0; border-radius: 10px; padding: 11px 13px; font-size: 12.5px; }
  .next b { color: #67e8f9; }
  .foot { position: absolute; bottom: 9mm; left: 15mm; right: 15mm; display: flex; justify-content: space-between; font-size: 9.5px; color: #94a3b8; }
</style></head><body><div class="page">
  <div class="top"><div class="brand">${brand} · DIAGNÓSTICO GRATUITO</div><div class="date">${escapeHtml(date.toLocaleDateString("pt-BR"))}</div></div>
  <h1>${escapeHtml(c.titulo)}</h1>
  <p class="sub">${escapeHtml([lead.nicho, lead.regiao].filter(Boolean).join(" · "))}${nota ? ` · Google: ${nota}` : ""}</p>
  <div class="resumo">${escapeHtml(c.resumo)}</div>
  ${c.fortes?.length ? `<h2>O que já está bom</h2><ul class="fortes">${c.fortes.map((f) => `<li>${escapeHtml(f)}</li>`).join("")}</ul>` : ""}
  <h2>O que está custando clientes</h2>
  <div class="probs">${c.problemas.map((p, i) => `<div class="prob"><span class="n">${i + 1}</span><b>${escapeHtml(p.titulo)}</b><span class="imp">Impacto: ${escapeHtml(p.impacto)}</span><span class="sol">Como resolver: ${escapeHtml(p.solucao)}</span></div>`).join("")}</div>
  ${c.plano?.length ? `<h2>Plano de 30 dias</h2><table>${c.plano.map((p) => `<tr><td class="w">${escapeHtml(p.semana)}</td><td>${escapeHtml(p.acao)}</td><td class="g">${escapeHtml(p.ganho)}</td></tr>`).join("")}</table>` : ""}
  <div class="next"><b>Próximo passo:</b> ${escapeHtml(c.proximo_passo)}</div>
  <div class="foot"><span>Preparado por ${who}</span><span>Análise feita com dados públicos do Google e do site da empresa.</span></div>
</div></body></html>`;
}

module.exports = { DIAGNOSIS_PROMPT, buildDiagnosis, renderDiagnosisHtml, ruleContent, escapeHtml };
