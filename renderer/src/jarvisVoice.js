// Voz do J.A.R.V.I.S.: síntese de fala do próprio Windows/Chromium, em pt-BR.
const KEY = 'p4j3_jarvis_voz';

/** Preferências da assistente (cada uma liga/desliga). */
export function jarvisPref(key, fallback = true) {
  try {
    const v = localStorage.getItem(`p4j3_jarvis_${key}`);
    return v === null ? fallback : v === 'on';
  } catch { return fallback; }
}

export function setJarvisPref(key, on) {
  try { localStorage.setItem(`p4j3_jarvis_${key}`, on ? 'on' : 'off'); } catch { /* sem armazenamento */ }
}

/** Fala e registra no console (qualquer tela pode chamar). */
export function jarvisSay(text, opts) {
  if (!text) return;
  window.dispatchEvent(new CustomEvent('sigma:jarvis-say', { detail: { text } }));
  speak(text, { ...opts, auto: true });
}

/**
 * Modo da voz: 'ordens' (padrão: fala só quando o senhor fala com ela),
 * 'sempre' (fala também os avisos) ou 'nunca' (só texto).
 */
export function voiceMode() {
  try {
    const v = localStorage.getItem(KEY);
    return ['ordens', 'sempre', 'nunca'].includes(v) ? v : 'ordens';
  } catch { return 'ordens'; }
}

export function setVoiceMode(mode) {
  try { localStorage.setItem(KEY, mode); } catch { /* sem armazenamento */ }
  if (mode === 'nunca') window.speechSynthesis?.cancel();
}

export function voiceEnabled() {
  return voiceMode() !== 'nunca';
}

function ptVoice() {
  const voices = window.speechSynthesis?.getVoices?.() || [];
  // Voz feminina, elegante e cuidadosa (neural/natural primeiro, quando existir).
  return voices.find((v) => /pt-BR/i.test(v.lang) && /francisca|thalita|leila|natural|neural/i.test(v.name))
    || voices.find((v) => /pt-BR/i.test(v.lang) && /maria|female/i.test(v.name))
    || voices.find((v) => /pt-BR/i.test(v.lang))
    || voices.find((v) => /^pt/i.test(v.lang))
    || null;
}

/**
 * Fala o texto conforme o modo. `auto` = aviso que ela deu sozinha (só fala
 * no modo 'sempre'); resposta a uma ordem fala em 'ordens' e 'sempre'.
 */
export function speak(text, { priority = false, auto = false } = {}) {
  const synth = window.speechSynthesis;
  const mode = voiceMode();
  // Sozinha ela só fala o urgente (priority: lead respondeu, caçada concluída); o resto vira balão.
  if (!synth || !text || mode === 'nunca' || (auto && !priority && mode !== 'sempre')) return;
  if (priority) synth.cancel();
  const u = new SpeechSynthesisUtterance(String(text).slice(0, 400));
  const voice = ptVoice();
  if (voice) u.voice = voice;
  u.lang = voice?.lang || 'pt-BR';
  u.rate = 0.98;
  u.pitch = 1.02;
  synth.speak(u);
}
