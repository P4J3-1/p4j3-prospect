/**
 * Piloto automático dos agentes: um orquestrador que roda sozinho, 24h,
 * cada etapa no seu ritmo (caçar leads, triar, pesquisar, escrever a fila,
 * preparar respostas, estudar resultados). Nada é enviado sem você: o que
 * sai daqui são rascunhos na fila e respostas prontas para aprovar.
 *
 * As etapas vêm de fora (main.js), para o motor ser testável sozinho.
 */
const fs = require("fs");
const path = require("path");

const DEFAULT_SETTINGS = {
  enabled: false,
  // Missões do Caçador: o que procurar quando os leads disponíveis acabam.
  missions: [],
  reserveLeads: 40, // abaixo disso o Caçador sai para caçar
  huntGoal: 40, // leads novos por caçada
  draftTarget: 20, // rascunhos esperando aprovação
  researchPerRun: 3,
};

const MAX_FEED = 200;

class Autopilot {
  /**
   * @param {string} userDataPath
   * @param {{ stages: Array<{id:string, agent:string, label:string, everyMs:number, run:Function}>, onEvent?:Function, now?:Function }} opts
   */
  constructor(userDataPath, { stages = [], onEvent = () => {}, now = () => Date.now() } = {}) {
    this.filePath = path.join(userDataPath, "autopilot.json");
    this.stages = stages;
    this.onEvent = onEvent;
    this.now = now;
    let raw = {};
    try {
      raw = JSON.parse(fs.readFileSync(this.filePath, "utf-8")) || {};
    } catch { /* primeira execução */ }
    this.settings = { ...DEFAULT_SETTINGS, ...(raw.settings || {}) };
    this.feed = Array.isArray(raw.feed) ? raw.feed.slice(-MAX_FEED) : [];
    this.replyDrafts = raw.replyDrafts && typeof raw.replyDrafts === "object" ? raw.replyDrafts : {};
    this.intel = raw.intel && typeof raw.intel === "object" ? raw.intel : {};
    this.missionCursor = Number(raw.missionCursor) || 0;
    this.lastRun = raw.lastRun && typeof raw.lastRun === "object" ? raw.lastRun : {};
    this.stats = raw.stats && raw.stats.day === dayKey(this.now()) ? raw.stats : { day: dayKey(this.now()), byStage: {} };
    this.live = {}; // stageId -> { status, task, progress, startedAt }
    this.busy = false;
    this.timer = null;
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const tmp = `${this.filePath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({
        settings: this.settings,
        feed: this.feed.slice(-MAX_FEED),
        replyDrafts: this.replyDrafts,
        intel: this.intel,
        missionCursor: this.missionCursor,
        lastRun: this.lastRun,
        stats: this.stats,
      }), { mode: 0o600 });
      fs.renameSync(tmp, this.filePath);
    } catch (error) {
      console.warn("[AUTOPILOT] save:", error.message);
    }
  }

  updateSettings(patch = {}) {
    const next = { ...this.settings };
    if (typeof patch.enabled === "boolean") next.enabled = patch.enabled;
    for (const key of ["reserveLeads", "huntGoal", "draftTarget", "researchPerRun"]) {
      if (patch[key] !== undefined) next[key] = Math.max(0, Math.min(500, Math.round(Number(patch[key]) || 0)));
    }
    if (Array.isArray(patch.missions)) {
      next.missions = patch.missions
        .map((m) => ({
          niche: String(m?.niche || "").trim().slice(0, 80),
          city: String(m?.city || "").trim().slice(0, 80),
          neighborhoods: (Array.isArray(m?.neighborhoods) ? m.neighborhoods : String(m?.neighborhoods || "").split(","))
            .map((n) => String(n || "").trim().slice(0, 80))
            .filter(Boolean)
            .slice(0, 60),
          active: m?.active !== false,
        }))
        .filter((m) => m.niche && m.city)
        .slice(0, 30);
    }
    const turnedOn = !this.settings.enabled && next.enabled;
    this.settings = next;
    this.save();
    this.log("sistema", next.enabled ? (turnedOn ? "Piloto automático ligado: os agentes começam a trabalhar." : "Configuração atualizada.") : "Piloto automático pausado.", "info");
    this.emit();
    if (turnedOn) setImmediate(() => this.tick());
    return this.settings;
  }

  /** Próxima missão ativa (rodízio). */
  nextMission() {
    const active = this.settings.missions.filter((m) => m.active !== false);
    if (!active.length) return null;
    const mission = active[this.missionCursor % active.length];
    this.missionCursor = (this.missionCursor + 1) % active.length;
    this.save();
    return mission;
  }

  log(agent, text, kind = "ok") {
    const entry = { at: this.now(), agent, text: String(text).slice(0, 300), kind };
    this.feed.push(entry);
    if (this.feed.length > MAX_FEED) this.feed = this.feed.slice(-MAX_FEED);
    this.save();
    this.onEvent({ type: "feed", entry });
    return entry;
  }

  setLive(stageId, patch) {
    this.live[stageId] = { ...(this.live[stageId] || {}), ...patch };
    this.onEvent({ type: "live", stageId, live: this.live[stageId] });
  }

  countStage(stageId, amount) {
    const day = dayKey(this.now());
    if (this.stats.day !== day) this.stats = { day, byStage: {} };
    this.stats.byStage[stageId] = (Number(this.stats.byStage[stageId]) || 0) + (Number(amount) || 0);
  }

  isDue(stage) {
    return this.now() - (Number(this.lastRun[stage.id]) || 0) >= stage.everyMs;
  }

  /** Uma volta: roda, em ordem, as etapas que estão no horário. */
  async tick() {
    if (!this.settings.enabled || this.busy) return;
    this.busy = true;
    try {
      for (const stage of this.stages) {
        if (!this.settings.enabled) break;
        if (!this.isDue(stage)) continue;
        await this.runStage(stage);
      }
    } finally {
      this.busy = false;
      this.emit();
    }
  }

  async runStage(stage, { manual = false } = {}) {
    this.lastRun[stage.id] = this.now();
    this.setLive(stage.id, { status: "working", task: stage.label, startedAt: this.now(), progress: null });
    const ctx = {
      settings: this.settings,
      autopilot: this,
      manual,
      progress: (done, total, task) => this.setLive(stage.id, { progress: { done, total }, ...(task ? { task } : {}) }),
      log: (text, kind) => this.log(stage.agent, text, kind),
    };
    try {
      const result = (await stage.run(ctx)) || {};
      if (result.count) this.countStage(stage.id, result.count);
      if (result.text) this.log(stage.agent, result.text, result.kind || "ok");
      // "working": a etapa disparou algo que continua rodando (ex.: caçada na janela).
      const status = result.working ? "working" : result.idle ? "idle" : "done";
      this.setLive(stage.id, { status, task: result.status || result.text || "Nada a fazer agora.", progress: null, finishedAt: this.now() });
      return result;
    } catch (error) {
      this.log(stage.agent, `Falhou: ${error.message}`, "error");
      this.setLive(stage.id, { status: "error", task: error.message, progress: null, finishedAt: this.now() });
      return { error: error.message };
    } finally {
      this.save();
    }
  }

  /** Roda uma etapa agora (botão "Rodar agora"), mesmo com o piloto pausado. */
  async runNow(stageId) {
    const stage = this.stages.find((s) => s.id === stageId);
    if (!stage) throw new Error("Etapa desconhecida");
    if (this.live[stageId]?.status === "working") throw new Error("Esse agente já está trabalhando.");
    const result = await this.runStage(stage, { manual: true });
    this.emit();
    return result;
  }

  start(intervalMs = 30000) {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick().catch(() => {}), intervalMs);
    setTimeout(() => this.tick().catch(() => {}), 15000);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  setReplyDraft(phone, draft) {
    this.replyDrafts[phone] = { ...draft, at: this.now() };
    this.save();
    this.onEvent({ type: "reply-draft", phone, draft: this.replyDrafts[phone] });
  }

  dismissReplyDraft(phone) {
    delete this.replyDrafts[phone];
    this.save();
    this.onEvent({ type: "reply-draft", phone, draft: null });
  }

  setIntel(key, intel) {
    this.intel[key] = { ...intel, at: this.now() };
    const keys = Object.keys(this.intel);
    if (keys.length > 3000) {
      keys.sort((a, b) => (this.intel[a].at || 0) - (this.intel[b].at || 0));
      for (const k of keys.slice(0, keys.length - 3000)) delete this.intel[k];
    }
    this.save();
  }

  snapshot() {
    return {
      settings: this.settings,
      stages: this.stages.map((s) => ({
        id: s.id,
        agent: s.agent,
        label: s.label,
        everyMs: s.everyMs,
        lastRunAt: this.lastRun[s.id] || 0,
        nextRunAt: (this.lastRun[s.id] || 0) + s.everyMs,
        today: Number(this.stats.byStage?.[s.id]) || 0,
        live: this.live[s.id] || { status: this.settings.enabled ? "idle" : "off" },
      })),
      feed: [...this.feed].reverse().slice(0, 80),
      replyDrafts: this.replyDrafts,
      busy: this.busy,
    };
  }

  emit() {
    this.onEvent({ type: "state", state: this.snapshot() });
  }
}

function dayKey(now) {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

module.exports = { Autopilot, DEFAULT_SETTINGS };
