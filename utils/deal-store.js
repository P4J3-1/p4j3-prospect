const fs = require("fs");
const path = require("path");
const { phoneCore: phoneKey } = require("./phone-key");

/**
 * Negócios em andamento por telefone: agendamento (detectado na conversa ou
 * informado por você), valor e próximo passo. Arquivo próprio (deals.json).
 */
class DealStore {
  constructor(userDataPath) {
    this.file = path.join(userDataPath, "deals.json");
    this.deals = {};
    try {
      this.deals = JSON.parse(fs.readFileSync(this.file, "utf8")).deals || {};
    } catch {
      this.deals = {};
    }
  }

  _save() {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ deals: this.deals }));
    fs.renameSync(tmp, this.file);
  }

  get(phone) {
    return this.deals[phoneKey(phone)] || null;
  }

  all() {
    return this.deals;
  }

  /** Mescla campos; `null` apaga o campo. Devolve o negócio atualizado. */
  update(phone, patch = {}) {
    const key = phoneKey(phone);
    if (!key || key.length < 10) throw new Error("Telefone inválido.");
    const next = { ...(this.deals[key] || {}) };
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === undefined) delete next[k];
      else next[k] = v;
    }
    next.updatedAt = Date.now();
    this.deals[key] = next;
    this._save();
    return next;
  }
}

module.exports = { DealStore };
