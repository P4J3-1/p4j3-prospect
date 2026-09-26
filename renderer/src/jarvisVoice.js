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
  speak(text, opts);
}

export function voiceEnabled() {
  try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; }
}

export function setVoiceEnabled(on) {
  try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* sem armazenamento */ }
  if (!on) window.speechSynthesis?.cancel();
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

/** Fala o texto (se a voz estiver ligada). `priority` interrompe o que estiver falando. */
export function speak(text, { priority = false } = {}) {
  const synth = window.speechSynthesis;
  if (!synth || !voiceEnabled() || !text) return;
  if (priority) synth.cancel();
  const u = new SpeechSynthesisUtterance(String(text).slice(0, 400));
  const voice = ptVoice();
  if (voice) u.voice = voice;
  u.lang = voice?.lang || 'pt-BR';
  u.rate = 0.98;
  u.pitch = 1.02;
  synth.speak(u);
}
