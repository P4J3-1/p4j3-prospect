/**
 * Acha na conversa um agendamento combinado ("quarta às 13h", "amanhã 10h",
 * "dia 02/10 às 15h30") e devolve a data real. Só regras: roda a todo momento
 * sem gastar IA.
 */
const DAY = 86400000;
const WEEKDAYS = [
  [/\bdomingo\b/, 0], [/\bsegunda\b|\bseg\b/, 1], [/\bter[cç]a\b|\bter\b/, 2], [/\bquarta\b|\bqua\b/, 3],
  [/\bquinta\b|\bqui\b/, 4], [/\bsexta\b|\bsex\b/, 5], [/\bs[aá]bado\b|\bs[aá]b\b/, 6],
];
const { isAutoReply } = require('./outreach-classifier');

const SCHEDULE_WORDS = /(agendad|agendar|agendamos|marcad|marcamos|marcar|combinad|confirm|fica (para|pra)|reuni|call|chamada|visita|apresenta[cç][aã]o)/i;
// Horário de funcionamento, link de agenda online: não é reunião combinada.
const NOT_A_MEETING = /(https?:\/\/|www\.|\b(de|da|das|dos)\s+\S+\s+(a|à|às|as|até)\s+\S+|funcionamento|atendemos|n[aã]o atendemos)/i;
const TIME = /\b(?:[aà]s\s*)?([01]?\d|2[0-3])\s*(?:h|:|horas?)\s*([0-5]\d)?\b/i;

function norm(text) {
  return String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function parseTime(text) {
  const m = norm(text).match(TIME);
  if (!m) return null;
  return { h: Number(m[1]), min: Number(m[2] || 0) };
}

/** Dia citado na frase, a partir da data da mensagem. */
function parseDay(text, base) {
  const t = norm(text);
  const start = new Date(base);
  start.setHours(0, 0, 0, 0);
  if (/\bdepois de amanha\b/.test(t)) return new Date(start.getTime() + 2 * DAY);
  if (/\bamanha\b/.test(t)) return new Date(start.getTime() + DAY);
  if (/\bhoje\b/.test(t)) return start;
  const dm = t.match(/\bdia\s*(\d{1,2})(?:\s*[/.-]\s*(\d{1,2}))?\b/) || t.match(/\b(\d{1,2})\s*\/\s*(\d{1,2})\b/);
  if (dm) {
    const day = Number(dm[1]);
    const month = dm[2] ? Number(dm[2]) - 1 : start.getMonth();
    let d = new Date(start.getFullYear(), month, day);
    if (d < start) d = dm[2] ? new Date(start.getFullYear() + 1, month, day) : new Date(start.getFullYear(), month + 1, day);
    return d;
  }
  for (const [re, wd] of WEEKDAYS) {
    if (re.test(t)) {
      const diff = (wd - start.getDay() + 7) % 7 || 7;
      return new Date(start.getTime() + diff * DAY);
    }
  }
  return null;
}

function label(at) {
  const d = new Date(at);
  const wd = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'][d.getDay()];
  const hm = `${d.getHours()}h${d.getMinutes() ? String(d.getMinutes()).padStart(2, '0') : ''}`;
  return `${wd}, ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} às ${hm}`;
}

/**
 * @param {Array<{fromMe: boolean, text: string, at: number}>} messages em ordem
 * @returns {{ at: number, label: string, quote: string, confirmed: boolean } | null}
 */
function detectMeeting(messages = []) {
  const list = (messages || []).filter((m) => m && m.text && m.at);
  for (let i = list.length - 1; i >= Math.max(0, list.length - 20); i -= 1) {
    const m = list[i];
    const time = parseTime(m.text);
    if (!time) continue;
    // O dia vale na mesma frase do horário ("quarta às 13h. Lembrete na terça" → quarta).
    if (NOT_A_MEETING.test(m.text) || (!m.fromMe && isAutoReply(m.text, 0))) continue;
    // O dia tem que estar na mesma frase do horário.
    const clause = String(m.text).split(/[.!?;\n]+/).find((part) => parseTime(part)) || m.text;
    let day = parseDay(clause, m.at);
    let quote = m.text;
    // Lead escolheu só o horário ("13h") entre opções que você mandou antes.
    if (!day && !m.fromMe) {
      const offer = [...list.slice(Math.max(0, i - 4), i)].reverse().find((x) => x.fromMe && parseDay(x.text, x.at));
      if (offer) {
        const options = norm(offer.text).split(/\bou\b|,/);
        const chosen = options.find((part) => { const t = parseTime(part); return t && t.h === time.h && t.min === time.min; }) || offer.text;
        day = parseDay(chosen, offer.at) || parseDay(offer.text, offer.at);
        quote = `${offer.text} → ${m.text}`;
      }
    }
    if (!day) continue;
    if (!SCHEDULE_WORDS.test(m.text) && !quote.includes('→')) continue;
    const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), time.h, time.min).getTime();
    const confirmed = /(agendad|combinad|confirmad|fechado|marcad|fica (para|pra))/i.test(m.text) || quote.includes('→');
    return { at, label: label(at), quote: quote.slice(0, 240), confirmed };
  }
  return null;
}

module.exports = { detectMeeting, parseDay, parseTime, label };
