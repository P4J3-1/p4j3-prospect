/**
 * Triagem de leads (Agente de Triagem): em segundos diz se a empresa não tem
 * site, tem site fraco, atende WhatsApp sem automação ou tem alto potencial,
 * e prepara a entrevista de qualificação + um diagnóstico gratuito (presente
 * de valor) para abrir a conversa entregando algo útil antes de vender.
 */
const fs = require("fs");
const path = require("path");
const { deriveGreeting } = require("../campaigns/greeting");

const FETCH_TIMEOUT_MS = 8000;
const HEADERS = {
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "accept-language": "pt-BR,pt;q=0.9",
  accept: "text/html,application/xhtml+xml",
};

// Widgets de atendimento automatizado/chat. Botão flutuante de WhatsApp não é bot.
const CHAT_WIDGETS = [
  ["Tawk.to", /tawk\.to/i],
  ["JivoChat", /jivosite|jivochat/i],
  ["Zendesk", /zdassets|zendesk\.com\/embeddable/i],
  ["Intercom", /widget\.intercom\.io|intercomcdn/i],
  ["Crisp", /client\.crisp\.chat/i],
  ["ManyChat", /manychat/i],
  ["BotConversa", /botconversa/i],
  ["Blip", /blip\.ai|take\.net/i],
  ["Landbot", /landbot/i],
  ["Octadesk", /octadesk/i],
  ["Huggy", /huggy\.io|huggy\.app/i],
  ["Zenvia", /zenvia/i],
  ["Kommo", /kommo\.com|amocrm/i],
  ["Chatwoot", /chatwoot/i],
  ["Tidio", /tidio/i],
  ["HubSpot Chat", /js\.hs-scripts\.com|hubspot/i],
  ["RD Station Conversas", /rdstation.*(chat|conversas)|conversas\.rdstation/i],
];
const SOCIAL_HOST = /(^|\.)(instagram\.com|facebook\.com|fb\.com|linktr\.ee|tiktok\.com|wa\.me|api\.whatsapp\.com|youtube\.com|twitter\.com|x\.com|linkedin\.com)$/i;

function words(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

const { phoneCore } = require("../utils/phone-key");

/** Chave estável do lead (mesma regra no renderer: renderer/src/triage.mjs). */
function triageKey(lead = {}) {
  const phone = phoneCore(lead.phone || lead.tel);
  if (phone.length >= 10) return `p:${phone}`;
  const name = words(lead.name || lead.company).join("-");
  return name ? `n:${name}` : "";
}

function isMobile(phone) {
  const core = phoneCore(phone);
  return core.length === 11 && core[2] === "9";
}

function normalizeUrl(url) {
  const raw = String(url || "").trim();
  if (!raw) return "";
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}

function isSocialUrl(url) {
  try {
    return SOCIAL_HOST.test(new URL(normalizeUrl(url)).hostname.replace(/^www\./, ""));
  } catch {
    return false;
  }
}

async function probeWebsite(url, { fetchImpl = fetch, now = Date.now() } = {}) {
  const target = normalizeUrl(url);
  const started = now;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetchImpl(target, { headers: HEADERS, redirect: "follow", signal: controller.signal });
    const html = String(await res.text()).slice(0, 600000);
    const elapsed = Date.now() - started;
    const finalUrl = res.url || target;
    const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ");
    const years = [...html.matchAll(/(?:©|&copy;|copyright)\s*(?:\d{4}\s*[-–]\s*)?(20\d{2})/gi)].map((m) => Number(m[1]));
    return {
      reachable: res.ok || (res.status >= 300 && res.status < 400),
      status: res.status,
      https: /^https:/i.test(finalUrl),
      responseMs: elapsed,
      mobile: /<meta[^>]+name=["']viewport["']/i.test(html),
      title: (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").replace(/\s+/g, " ").trim().slice(0, 120),
      description: /<meta[^>]+name=["']description["'][^>]+content=["'][^"']{20,}/i.test(html),
      wordCount: words(text).length,
      copyrightYear: years.length ? Math.max(...years) : null,
      whatsappLink: /wa\.me\/|api\.whatsapp\.com|web\.whatsapp\.com\/send|whatsapp:\/\//i.test(html),
      chatWidgets: CHAT_WIDGETS.filter(([, re]) => re.test(html)).map(([name]) => name),
      form: /<form[\s>]/i.test(html),
      pixel: /fbq\(|connect\.facebook\.net/i.test(html),
      analytics: /gtag\(|googletagmanager|google-analytics/i.test(html),
      booking: /agendar|agendamento|calendly|doctoralia|marque (sua|uma) consulta/i.test(text),
    };
  } catch (error) {
    return { reachable: false, status: 0, error: error?.name === "AbortError" ? "timeout" : String(error?.message || error).slice(0, 120) };
  } finally {
    clearTimeout(timer);
  }
}

function siteWeaknesses(site, year = new Date().getFullYear()) {
  if (!site?.reachable) return [];
  const out = [];
  if (!site.https) out.push("Sem HTTPS (navegador marca como não seguro)");
  if (!site.mobile) out.push("Não é adaptado para celular");
  if (site.wordCount < 150) out.push("Pouco conteúdo explicando os serviços");
  if (site.copyrightYear && site.copyrightYear < year - 2) out.push(`Parado desde ${site.copyrightYear}`);
  if (!site.description) out.push("Sem descrição para o Google");
  if (!site.whatsappLink && !site.form) out.push("Sem botão de WhatsApp nem formulário de contato");
  if (site.responseMs > 4000) out.push(`Lento para abrir (${Math.round(site.responseMs / 1000)} s)`);
  return out;
}

const SEGMENT_LABELS = {
  sem_site: "Sem site",
  so_rede_social: "Só rede social",
  site_fora_do_ar: "Site fora do ar",
  site_fraco: "Site fraco",
  atendimento_manual: "WhatsApp sem automação",
  ja_automatizado: "Já tem chat/bot",
  alto_potencial: "Alto potencial",
};

/** Triagem determinística: rápida, sem custo e base para a IA (que não pode inventar). */
function computeTriage(lead = {}, site = null, { year = new Date().getFullYear() } = {}) {
  const segments = [];
  const findings = [];
  const website = String(lead.website || "").trim();
  let opportunity = 0;

  if (!website) {
    segments.push("sem_site");
    findings.push("Não tem site próprio");
    opportunity += 35;
  } else if (isSocialUrl(website)) {
    segments.push("so_rede_social");
    findings.push("Usa só rede social como site");
    opportunity += 32;
  } else if (site && !site.reachable) {
    segments.push("site_fora_do_ar");
    findings.push(site.error === "timeout" ? "Site demora demais para abrir" : site.status ? `Site com erro (HTTP ${site.status})` : "Site não abre");
    opportunity += 35;
  } else if (site) {
    const weak = siteWeaknesses(site, year);
    findings.push(...weak);
    if (weak.length >= 2) {
      segments.push("site_fraco");
      opportunity += 20 + Math.min(10, weak.length * 2);
    } else {
      opportunity += 8;
    }
  }

  const hasWhatsapp = isMobile(lead.phone) || !!site?.whatsappLink;
  if (site?.chatWidgets?.length) {
    segments.push("ja_automatizado");
    findings.push(`Já usa atendimento automatizado (${site.chatWidgets.join(", ")})`);
  } else if (hasWhatsapp) {
    segments.push("atendimento_manual");
    findings.push("Atende pelo WhatsApp sem automação visível");
    opportunity += 15;
  }
  if (site?.reachable && !site.pixel && !site.analytics) findings.push("Não mede visitas nem anúncios (sem Pixel/Analytics)");

  const rating = Number(String(lead.rating || "").replace(",", "."));
  // "1.234" é formato BR (mil duzentos...), por isso só dígitos.
  const reviews = Number(String(lead.reviewCount ?? lead.reviews ?? lead.totalReviews ?? 0).replace(/\D/g, "")) || 0;
  let activity = Math.min(20, Math.round(reviews / 10));
  if (rating >= 4.3) activity += 10;
  else if (rating >= 4) activity += 5;
  const contactability = isMobile(lead.phone) ? 15 : lead.phone ? 8 : 0;
  const score = Math.max(0, Math.min(100, opportunity + activity + contactability + (lead.instagram ? 5 : 0)));
  if (score >= 70) segments.push("alto_potencial");

  return {
    key: triageKey(lead),
    score,
    level: score >= 70 ? "alto" : score >= 45 ? "medio" : "baixo",
    segments,
    segmentLabels: segments.map((s) => SEGMENT_LABELS[s]),
    findings: findings.slice(0, 8),
    site: site ? { reachable: site.reachable, https: site.https, mobile: site.mobile, chatWidgets: site.chatWidgets || [], whatsappLink: !!site.whatsappLink, title: site.title || "" } : null,
    hasPhone: !!lead.phone,
  };
}

const INTERVIEW_BY_SEGMENT = {
  sem_site: [
    "Hoje, como os clientes novos chegam até vocês?",
    "Quando alguém pesquisa vocês no Google, o que encontra além do Maps?",
    "Já pensaram em ter uma página para mostrar serviços, preços e agendamento?",
  ],
  so_rede_social: [
    "O Instagram traz clientes todo mês ou oscila bastante?",
    "Quem não usa Instagram consegue ver seus serviços e falar com vocês fácil?",
  ],
  site_fora_do_ar: ["Vocês sabiam que o site não está abrindo? Isso tem afastado clientes?"],
  site_fraco: [
    "Quantos contatos por mês chegam pelo site hoje?",
    "O site foi feito há quanto tempo? Vocês atualizam com frequência?",
  ],
  atendimento_manual: [
    "Quantas mensagens por dia vocês recebem no WhatsApp?",
    "Quem responde, e fora do horário comercial alguém atende?",
    "Já perderam cliente por demorar para responder?",
  ],
};

function fallbackInterview(triage, commercial = {}) {
  const questions = [];
  for (const seg of triage.segments) questions.push(...(INTERVIEW_BY_SEGMENT[seg] || []));
  questions.push("Se isso estivesse resolvido, quanto a mais vocês conseguiriam atender por mês?");
  questions.push("Quem decide sobre esse tipo de investimento aí?");
  const services = (commercial.services || []).filter(Boolean);
  return {
    perguntas: [...new Set(questions)].slice(0, 6),
    sinais_de_compra: ["Reclama de perder clientes ou de demora no atendimento", "Pergunta sobre prazo ou valor", "Diz que já pensou em resolver isso"],
    objecoes: [
      { objecao: "Não tenho tempo agora.", resposta: "Por isso a ideia é simples e rápida; te mostro em 5 minutos o que muda." },
      { objecao: "Está caro.", resposta: "Faz sentido comparar com quantos clientes vocês perdem hoje; se não se pagar, não vale." },
    ],
    servico_recomendado: services[0] || "",
  };
}

/** Diagnóstico gratuito (presente de valor) montado só com fatos coletados. */
function fallbackGift(lead, triage) {
  const greeting = deriveGreeting(lead);
  const points = triage.findings.slice(0, 3);
  if (!points.length) return null;
  const list = points.map((p, i) => `${i + 1}. ${p}`).join("\n");
  const count = points.length === 1 ? "um ponto" : `${points.length} pontos`;
  return {
    titulo: "Mini-diagnóstico gratuito",
    mensagem: `Oi, ${greeting}! Fiz uma análise rápida e gratuita da presença digital de vocês e separei ${count} que podem estar custando clientes:\n${list}\nQuer que eu te explique como resolver cada um? Sem compromisso.`,
  };
}

const TRIAGE_SYSTEM_PROMPT = [
  "Voce e um agente de triagem comercial B2B no Brasil. Recebe leads com segmentos e problemas ja calculados pelo sistema (site, WhatsApp, avaliacoes) e o perfil de quem vende.",
  "Para cada lead: 1) indique o servico do vendedor que mais se encaixa; 2) escreva uma triagem em 1-2 frases; 3) monte uma entrevista de qualificacao curta (4-6 perguntas abertas, em ordem, para descobrir dor, urgencia, decisor e orcamento); 4) sinais de compra e 2 objecoes com resposta; 5) um presente de valor: mini-diagnostico gratuito de ate 600 caracteres, pronto para WhatsApp, citando so os problemas encontrados, sem link, tratando a pessoa pela saudacao informada e terminando com uma pergunta.",
  "Use o playbook do analista quando existir.",
  "Responda apenas JSON: {\"leads\":[{\"key\":\"\",\"servico_recomendado\":\"\",\"resumo\":\"\",\"prioridade\":\"alta|media|baixa\",\"entrevista\":{\"perguntas\":[],\"sinais_de_compra\":[],\"objecoes\":[{\"objecao\":\"\",\"resposta\":\"\"}]},\"presente\":{\"titulo\":\"\",\"mensagem\":\"\"}}]}",
].join("\n");

function cleanList(value, max, len = 240) {
  return (Array.isArray(value) ? value : []).map((v) => String(v || "").trim().slice(0, len)).filter(Boolean).slice(0, max);
}

function mergeAiTriage(base, ai) {
  if (!ai || typeof ai !== "object") return base;
  const entrevista = ai.entrevista || {};
  const perguntas = cleanList(entrevista.perguntas, 6);
  const presente = ai.presente?.mensagem
    ? { titulo: String(ai.presente.titulo || "Mini-diagnóstico gratuito").slice(0, 80), mensagem: String(ai.presente.mensagem).replace(/https?:\/\/\S+/g, "").slice(0, 900) }
    : base.presente;
  const sinais = cleanList(entrevista.sinais_de_compra, 4);
  const objecoes = (Array.isArray(entrevista.objecoes) ? entrevista.objecoes : [])
    .map((o) => ({ objecao: String(o?.objecao || "").slice(0, 160), resposta: String(o?.resposta || "").slice(0, 300) }))
    .filter((o) => o.objecao && o.resposta)
    .slice(0, 3);
  return {
    ...base,
    resumo: String(ai.resumo || base.resumo || "").slice(0, 400),
    prioridade: ["alta", "media", "baixa"].includes(ai.prioridade) ? ai.prioridade : base.prioridade,
    entrevista: {
      perguntas: perguntas.length ? perguntas : base.entrevista.perguntas,
      sinais_de_compra: sinais.length ? sinais : base.entrevista.sinais_de_compra,
      objecoes: objecoes.length ? objecoes : base.entrevista.objecoes,
      servico_recomendado: String(ai.servico_recomendado || base.entrevista.servico_recomendado || "").slice(0, 80),
    },
    presente,
    aiApplied: true,
  };
}

function baseResult(lead, triage, commercial) {
  return {
    ...triage,
    name: String(lead.name || "").slice(0, 160),
    resumo: triage.findings.slice(0, 2).join("; "),
    prioridade: triage.level === "alto" ? "alta" : triage.level === "medio" ? "media" : "baixa",
    entrevista: fallbackInterview(triage, commercial),
    presente: fallbackGift(lead, triage),
    aiApplied: false,
  };
}

/**
 * Triagem em lote. Sites são checados em paralelo (pool de 4); a IA recebe os
 * leads em blocos de 8 para economizar chamadas.
 */
async function triageLeads(leads = [], { settings = {}, runAi = null, playbook = "", fetchImpl, onProgress = () => {}, aiBudget = Infinity } = {}) {
  const commercial = settings.commercial || {};
  const results = new Array(leads.length);
  let next = 0;
  const worker = async () => {
    while (next < leads.length) {
      const index = next++;
      const lead = leads[index] || {};
      const website = String(lead.website || "").trim();
      const site = website && !isSocialUrl(website) ? await probeWebsite(website, { fetchImpl }) : null;
      results[index] = baseResult(lead, computeTriage(lead, site), commercial);
      onProgress({ phase: "site", done: results.filter(Boolean).length, total: leads.length });
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, leads.length) }, worker));

  let aiError = "";
  let aiUsed = 0;
  if (typeof runAi === "function") {
    const eligible = results.map((r, i) => ({ r, i })).filter(({ r }) => r.hasPhone).slice(0, Math.max(0, aiBudget));
    for (let start = 0; start < eligible.length; start += 8) {
      const chunk = eligible.slice(start, start + 8);
      try {
        const { result } = await runAi({
          system: TRIAGE_SYSTEM_PROMPT,
          payload: {
            vendedor: commercial,
            playbook_do_analista: playbook || null,
            leads: chunk.map(({ r, i }) => ({
              key: r.key,
              nome: leads[i].name,
              categoria: leads[i].category || "",
              cidade: leads[i].city || "",
              nota: leads[i].rating || "",
              avaliacoes: leads[i].totalReviews || leads[i].reviews || "",
              saudacao: deriveGreeting(leads[i]),
              segmentos: r.segmentLabels,
              problemas_encontrados: r.findings,
              score: r.score,
            })),
          },
        });
        const rows = Array.isArray(result?.leads) ? result.leads : [];
        chunk.forEach(({ r, i }, pos) => {
          const row = rows.find((x) => x?.key === r.key) || rows[pos];
          results[i] = mergeAiTriage(r, row);
        });
        aiUsed += chunk.length;
        onProgress({ phase: "ai", done: aiUsed, total: eligible.length });
      } catch (error) {
        aiError = error.message;
        break;
      }
    }
  }
  const at = Date.now();
  return { results: results.map((r) => ({ ...r, triagedAt: at })), aiUsed, aiError };
}

/** Resultados da triagem por lead (processo principal), com aviso de mudança. */
class TriageStore {
  constructor(userDataPath, { onChange = () => {} } = {}) {
    this.filePath = path.join(userDataPath, "lead-triage.json");
    this.onChange = onChange;
    try {
      this.data = JSON.parse(fs.readFileSync(this.filePath, "utf-8")) || {};
    } catch {
      this.data = {};
    }
  }

  save() {
    try {
      const tmp = `${this.filePath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.data), { mode: 0o600 });
      fs.renameSync(tmp, this.filePath);
    } catch (error) {
      console.warn("[TRIAGE] save:", error.message);
    }
  }

  getAll() {
    return this.data;
  }

  has(key) {
    return !!this.data[key];
  }

  putMany(results) {
    const changed = {};
    for (const r of results) {
      if (!r?.key) continue;
      // Resultado com IA não é sobrescrito por um sem IA (ex.: cota esgotada).
      if (this.data[r.key]?.aiApplied && !r.aiApplied) continue;
      this.data[r.key] = r;
      changed[r.key] = r;
    }
    if (Object.keys(changed).length) {
      this.save();
      try { this.onChange(changed); } catch { /* UI fechada */ }
    }
    return changed;
  }
}

module.exports = {
  SEGMENT_LABELS,
  TriageStore,
  computeTriage,
  fallbackGift,
  isSocialUrl,
  probeWebsite,
  siteWeaknesses,
  triageKey,
  triageLeads,
};
