/**
 * Memória por lead: o momento da conversa (lido pelo Agente de Respostas),
 * a temperatura e as objeções que já apareceram. Com o histórico da fila e o
 * status do WhatsApp, é o que impede os agentes de repetir abordagem.
 */
const fs = require("fs");
const path = require("path");

const TEMPERATURE_BY_MOMENT = {
  interessado: "quente",
  curioso: "morno",
  duvida: "morno",
  objecao: "morno",
  sem_interesse: "frio",
  pediu_para_sair: "frio",
};

const { phoneCore, rekeyPhoneMap } = require("../utils/phone-key");

/**
 * Temperatura: o momento lido na conversa manda; sem ele, o status do
 * WhatsApp dá uma estimativa (respondeu = morno, só leu = frio).
 */
function temperatureOf(contact, memory) {
  if (memory?.momento && TEMPERATURE_BY_MOMENT[memory.momento]) return TEMPERATURE_BY_MOMENT[memory.momento];
  if (!contact) return null;
  if (contact.status === "respondeu") return "morno";
  if (contact.status === "descadastrado" || contact.status === "nao_contatar") return "frio";
  return "frio";
}

class LeadMemory {
  constructor(userDataPath) {
    this.filePath = path.join(userDataPath, "lead-memory.json");
    try {
      this.data = rekeyPhoneMap(JSON.parse(fs.readFileSync(this.filePath, "utf-8")) || {}).map;
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
      console.warn("[MEMORIA] save:", error.message);
    }
  }

  get(phone) {
    return this.data[phoneCore(phone)] || null;
  }

  /** Registra o que o Agente de Respostas leu na conversa. */
  recordReading(phone, { momento, leitura, objecao } = {}, now = Date.now()) {
    const key = phoneCore(phone);
    if (!key || key.length < 10) return null;
    const prev = this.data[key] || { objecoes: [] };
    const objecoes = objecao && !prev.objecoes.includes(objecao) ? [...prev.objecoes, objecao].slice(-6) : prev.objecoes;
    this.data[key] = { ...prev, momento: momento || prev.momento, leitura: leitura || prev.leitura, objecoes, updatedAt: now };
    this.save();
    return this.data[key];
  }

  getAll() {
    return this.data;
  }
}

module.exports = { LeadMemory, TEMPERATURE_BY_MOMENT, temperatureOf };
