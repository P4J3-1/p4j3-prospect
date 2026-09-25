/**
 * Agentes de IA do P4J3: configuração (ligado, automático, limite diário),
 * uso do dia, registro de atividade e o playbook do Analista (memória de
 * aprendizado que alimenta os outros agentes).
 */
const fs = require("fs");
const path = require("path");

const AGENTS = {
  triagem: {
    name: "Agente de Triagem",
    role: "Classifica cada lead: sem site, site fraco, WhatsApp sem automação ou alto potencial. Monta a entrevista de qualificação e o presente de valor (diagnóstico gratuito para abrir a conversa).",
    trigger: "Roda sozinho ao fim de cada extração (só leads com telefone) e pelo botão “Gerar presente” na ficha do lead.",
    unit: "leads/dia com IA",
    defaults: { enabled: true, auto: true, dailyLimit: 150 },
  },
  pesquisador: {
    name: "Agente Pesquisador",
    role: "Busca a empresa na web, confere o CNPJ, acha o dono no quadro de sócios e estima a chance de fechar.",
    trigger: "Botão Localizar (pino) no Scraper Maps.",
    unit: "pesquisas/dia com IA",
    defaults: { enabled: true, auto: false, dailyLimit: 60 },
  },
  copywriter: {
    name: "Agente Copywriter",
    role: "Reescreve a mensagem e o follow-up das campanhas com base no que teve resposta.",
    trigger: "Botão “Melhorar com IA” ao criar campanha.",
    unit: "otimizações/dia",
    defaults: { enabled: true, auto: false, dailyLimit: 30 },
  },
  respostas: {
    name: "Agente de Respostas",
    role: "Lê a conversa no WhatsApp e sugere 3 respostas para levar o lead ao próximo passo. Nunca envia sozinho.",
    trigger: "Botão “Sugerir resposta” na conversa.",
    unit: "sugestões/dia",
    defaults: { enabled: true, auto: false, dailyLimit: 200 },
  },
  proposta: {
    name: "Agente de Proposta",
    role: "Quando o lead se interessa, escreve a proposta com o problema real dele, as entregas da oferta e o próximo passo. Sem link.",
    trigger: "Botão “Gerar proposta” no painel do lead (WhatsApp), depois que ele respondeu.",
    unit: "propostas/dia",
    defaults: { enabled: true, auto: false, dailyLimit: 20 },
  },
  analista: {
    name: "Agente Analista",
    role: "Estuda os resultados das campanhas e escreve o playbook: nichos, horários e mensagens que funcionam. Os outros agentes seguem esse playbook.",
    trigger: "Roda sozinho a cada 25 novos envios e ao fim das campanhas.",
    unit: "análises/dia",
    defaults: { enabled: true, auto: true, dailyLimit: 3 },
  },
};

function todayKey(now = Date.now()) {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

class AgentStore {
  constructor(userDataPath, { onLog = () => {} } = {}) {
    this.filePath = path.join(userDataPath, "agents.json");
    this.onLog = onLog;
    let raw = {};
    try {
      raw = JSON.parse(fs.readFileSync(this.filePath, "utf-8")) || {};
    } catch { /* primeira execução */ }
    this.state = {
      settings: raw.settings || {},
      usage: raw.usage || { date: todayKey(), byAgent: {}, tokens: {} },
      log: Array.isArray(raw.log) ? raw.log : [],
      playbook: raw.playbook || null,
    };
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const tmp = `${this.filePath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2), { mode: 0o600 });
      fs.renameSync(tmp, this.filePath);
    } catch (error) {
      console.warn("[AGENTS] save:", error.message);
    }
  }

  settings(id) {
    return { ...AGENTS[id]?.defaults, ...(this.state.settings[id] || {}) };
  }

  update(id, patch = {}) {
    if (!AGENTS[id]) throw new Error(`Agente desconhecido: ${id}`);
    const next = { ...this.settings(id) };
    if (typeof patch.enabled === "boolean") next.enabled = patch.enabled;
    if (typeof patch.auto === "boolean") next.auto = patch.auto;
    if (patch.dailyLimit !== undefined) next.dailyLimit = Math.max(0, Math.min(5000, Math.round(Number(patch.dailyLimit) || 0)));
    this.state.settings[id] = next;
    this.save();
    return next;
  }

  _roll(now = Date.now()) {
    const key = todayKey(now);
    if (this.state.usage.date !== key) this.state.usage = { date: key, byAgent: {}, tokens: {} };
  }

  usedToday(id, now = Date.now()) {
    this._roll(now);
    return Number(this.state.usage.byAgent[id] || 0);
  }

  /** Quantas chamadas de IA o agente ainda pode fazer hoje (0 se desligado). */
  remaining(id, now = Date.now()) {
    const s = this.settings(id);
    if (!s.enabled) return 0;
    return Math.max(0, s.dailyLimit - this.usedToday(id, now));
  }

  consume(id, amount = 1, now = Date.now()) {
    if (!amount) return;
    this._roll(now);
    this.state.usage.byAgent[id] = this.usedToday(id, now) + amount;
    this.save();
  }

  /** Soma os tokens (entrada + saída) que o provedor informou para o agente hoje. */
  addTokens(id, usage, now = Date.now()) {
    const total = Number(usage?.total_tokens) || (Number(usage?.prompt_tokens) || 0) + (Number(usage?.completion_tokens) || 0);
    if (!total) return;
    this._roll(now);
    this.state.usage.tokens = this.state.usage.tokens || {};
    this.state.usage.tokens[id] = (Number(this.state.usage.tokens[id]) || 0) + total;
    this.save();
  }

  tokensToday(id, now = Date.now()) {
    this._roll(now);
    return Number(this.state.usage.tokens?.[id] || 0);
  }

  log(agent, text, ok = true, now = Date.now()) {
    const entry = { at: now, agent, text: String(text).slice(0, 300), ok };
    this.state.log.push(entry);
    if (this.state.log.length > 120) this.state.log = this.state.log.slice(-120);
    this.save();
    try { this.onLog(entry); } catch { /* UI fechada */ }
    return entry;
  }

  getPlaybook() {
    return this.state.playbook;
  }

  /** Texto compacto do playbook para entrar nos prompts dos agentes. */
  playbookText() {
    const p = this.state.playbook;
    if (!p) return "";
    return [
      p.resumo,
      ...(p.regras || []).map((r) => `- ${r}`),
      p.nichos?.length ? `Nichos prioritários: ${p.nichos.join(", ")}` : "",
      p.horarios?.length ? `Melhores horários: ${p.horarios.join(", ")}` : "",
    ].filter(Boolean).join("\n").slice(0, 1500);
  }

  setPlaybook(playbook, now = Date.now()) {
    this.state.playbook = { ...playbook, updatedAt: now };
    this.save();
    return this.state.playbook;
  }

  snapshot(now = Date.now()) {
    return {
      agents: Object.entries(AGENTS).map(([id, info]) => ({
        id,
        name: info.name,
        role: info.role,
        trigger: info.trigger,
        unit: info.unit,
        settings: this.settings(id),
        usedToday: this.usedToday(id, now),
        tokensToday: this.tokensToday(id, now),
        remaining: this.remaining(id, now),
      })),
      log: [...this.state.log].reverse().slice(0, 60),
      playbook: this.state.playbook,
    };
  }
}

module.exports = { AGENTS, AgentStore, todayKey };
