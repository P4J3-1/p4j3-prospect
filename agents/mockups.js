/**
 * Imagens de demonstração para o lead ver no celular (sem link, sem nada
 * público): "como ficaria seu site" e "simulação do atendimento automático".
 * Só HTML/CSS: o main renderiza numa janela invisível e salva em PNG.
 */
const { escapeHtml } = require("./diagnosis");

const SERVICE_HINTS = [
  [/barbear/i, ["Corte masculino", "Barba na navalha", "Pigmentação"]],
  [/sal[aã]o|cabel|beleza/i, ["Corte e escova", "Coloração", "Progressiva"]],
  [/unha|manicure|nail/i, ["Manicure e pedicure", "Unha em gel", "Alongamento"]],
  [/lava|polimento|est[eé]tica automotiva|carro/i, ["Lavagem completa", "Polimento", "Higienização interna"]],
  [/pet|banho e tosa|veterin/i, ["Banho e tosa", "Consulta", "Vacinas"]],
  [/pizz|hamburg|lanch|a[cç]a[ií]|restaur|marmit|confeit|padar/i, ["Cardápio completo", "Delivery", "Encomendas"]],
  [/psic/i, ["Psicoterapia", "Atendimento online", "Primeira consulta"]],
  [/fisio|pilates/i, ["Fisioterapia", "Pilates", "Avaliação"]],
  [/odonto|dent/i, ["Avaliação", "Limpeza", "Clareamento"]],
  [/est[eé]tica|harmoniza/i, ["Limpeza de pele", "Harmonização", "Avaliação gratuita"]],
  [/oficina|mec[aâ]nic/i, ["Revisão", "Troca de óleo", "Diagnóstico"]],
];

function servicesFor(category) {
  const hit = SERVICE_HINTS.find(([re]) => re.test(String(category || "")));
  return hit ? hit[1] : ["Atendimento personalizado", "Orçamento sem compromisso", "Agendamento fácil"];
}

function shortName(name) {
  return String(name || "Seu negócio").split(/\s+[-–—|·:]\s+/)[0].slice(0, 36);
}

const BASE_CSS = `
  * { box-sizing: border-box; margin: 0; }
  html, body { overflow: hidden; }
  body { width: 1080px; height: 1350px; font-family: "Segoe UI", Arial, sans-serif; display: grid; place-items: center;
    background: radial-gradient(900px 600px at 20% 0%, #cffafe, transparent 60%), radial-gradient(800px 600px at 100% 100%, #ede9fe, transparent 60%), #f8fafc; }
  .cap { position: absolute; top: 60px; left: 0; right: 0; text-align: center; }
  .cap b { display: block; font-size: 44px; color: #0f172a; letter-spacing: -.02em; }
  .cap span { font-size: 24px; color: #475569; }
  .phone { width: 470px; height: 960px; margin-top: 110px; border-radius: 64px; padding: 16px; background: #0f172a;
    box-shadow: 0 60px 120px -40px rgba(15, 23, 42, .6), inset 0 0 0 3px #334155; }
  .screen { width: 100%; height: 100%; border-radius: 50px; overflow: hidden; background: #fff; position: relative; }
  .foot { position: absolute; bottom: 48px; left: 0; right: 0; text-align: center; font-size: 20px; color: #64748b; }
`;

/** "Como ficaria seu site no celular". */
function siteMockHtml({ name, category, region, rating, reviews, seller }) {
  const nm = escapeHtml(shortName(name));
  const svc = servicesFor(category).map((s) => `<li>${escapeHtml(s)}</li>`).join("");
  const stars = rating ? `${"★".repeat(Math.round(Number(rating)))} <b>${escapeHtml(String(rating).replace(".", ","))}</b>${reviews ? ` · ${escapeHtml(reviews)} avaliações` : ""}` : "Avaliado pelos clientes";
  return `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}
  .hero { padding: 70px 30px 34px; color: #fff; background: linear-gradient(160deg, #0891b2, #6d28d9); }
  .hero small { font-size: 15px; letter-spacing: .14em; text-transform: uppercase; opacity: .85; }
  .hero h1 { font-size: 40px; line-height: 1.05; margin: 8px 0 10px; }
  .hero p { font-size: 18px; opacity: .92; }
  .stars { margin-top: 14px; font-size: 18px; color: #fde68a; }
  .stars b { color: #fff; }
  .body { padding: 26px 30px; }
  .body h2 { font-size: 20px; color: #0f172a; margin-bottom: 12px; }
  ul { list-style: none; padding: 0; display: grid; gap: 10px; }
  li { padding: 14px 16px; border-radius: 16px; background: #f1f5f9; font-size: 18px; color: #0f172a; font-weight: 600; }
  .cta { position: absolute; left: 22px; right: 22px; bottom: 26px; padding: 20px; border-radius: 20px; text-align: center; font-size: 21px; font-weight: 800; color: #fff; background: #16a34a; box-shadow: 0 16px 30px -12px #16a34a; }
  .map { margin-top: 18px; padding: 14px 16px; border-radius: 16px; border: 2px dashed #cbd5e1; font-size: 16px; color: #475569; }
  </style></head><body>
  <div class="cap"><b>Como ficaria o site da ${nm}</b><span>no celular do seu cliente</span></div>
  <div class="phone"><div class="screen">
    <div class="hero"><small>${escapeHtml(category || "Seu negócio")}</small><h1>${nm}</h1><p>${escapeHtml(region ? `Atendimento em ${region}` : "Atendimento com hora marcada")}</p><div class="stars">${stars}</div></div>
    <div class="body"><h2>Serviços</h2><ul>${svc}</ul><div class="map">📍 Como chegar · ⏰ Horários · 📸 Fotos do espaço</div></div>
    <div class="cta">💬 Chamar no WhatsApp</div>
  </div></div>
  <div class="foot">Demonstração preparada por ${escapeHtml(seller || "P4J3")} · rápido, no celular e aparecendo no Google</div>
  </body></html>`;
}

/** "Simulação de atendimento automático" (conversa de WhatsApp). */
function chatMockHtml({ name, category, seller }) {
  const nm = escapeHtml(shortName(name));
  const [s1, s2, s3] = servicesFor(category).map(escapeHtml);
  return `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}
  .top { background: #075e54; color: #fff; padding: 58px 20px 16px; display: flex; gap: 12px; align-items: center; }
  .av { width: 44px; height: 44px; border-radius: 50%; background: #25d366; display: grid; place-items: center; font-weight: 800; font-size: 20px; }
  .top b { font-size: 19px; display: block; } .top small { font-size: 14px; opacity: .85; }
  .chat { padding: 18px 14px; display: flex; flex-direction: column; gap: 10px; background: #efeae2; height: calc(100% - 118px); }
  .m { max-width: 82%; padding: 11px 14px; border-radius: 14px; font-size: 17px; line-height: 1.4; box-shadow: 0 1px 1px rgba(0,0,0,.08); }
  .in { align-self: flex-start; background: #fff; border-top-left-radius: 4px; }
  .out { align-self: flex-end; background: #d9fdd3; border-top-right-radius: 4px; }
  .t { display: block; text-align: right; font-size: 12px; color: #667781; margin-top: 4px; }
  .badge { align-self: center; font-size: 13px; background: #fff7cd; color: #854d0e; padding: 5px 12px; border-radius: 99px; }
  .opts { display: grid; gap: 6px; margin-top: 6px; }
  .opts span { display: block; padding: 8px 10px; border-radius: 10px; background: #fff; color: #0891b2; font-weight: 700; font-size: 15px; text-align: center; }
  </style></head><body>
  <div class="cap"><b>Seu cliente respondido em 5 segundos</b><span>mesmo às 22h, no sábado ou no horário de pico</span></div>
  <div class="phone"><div class="screen">
    <div class="top"><div class="av">${nm.slice(0, 1)}</div><div><b>${nm}</b><small>online</small></div></div>
    <div class="chat">
      <span class="badge">Sábado, 22:14</span>
      <div class="m in">Oi! Qual o valor? Tem horário essa semana?<span class="t">22:14</span></div>
      <div class="m out">Olá! Que bom falar com você 😊 Aqui é a ${nm}. Nossos serviços mais pedidos:<div class="opts"><span>1 · ${s1}</span><span>2 · ${s2}</span><span>3 · ${s3}</span></div><span class="t">22:14 ✓✓</span></div>
      <div class="m in">1<span class="t">22:15</span></div>
      <div class="m out">Perfeito! Tenho horário amanhã às 10h ou às 15h. Qual prefere? Já deixo reservado 🙌<span class="t">22:15 ✓✓</span></div>
      <div class="m in">15h 👍<span class="t">22:15</span></div>
      <div class="m out">Agendado! Te mando um lembrete no dia. Até amanhã!<span class="t">22:15 ✓✓</span></div>
    </div>
  </div></div>
  <div class="foot">Simulação preparada por ${escapeHtml(seller || "P4J3")} · o cliente é atendido na hora, e você só confirma</div>
  </body></html>`;
}

module.exports = { siteMockHtml, chatMockHtml, servicesFor, shortName };
