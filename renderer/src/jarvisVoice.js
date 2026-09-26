// Voz do J.A.R.V.I.S.: síntese de fala do próprio Windows/Chromium, em pt-BR.
const KEY = 'p4j3_jarvis_voz';

export function voiceEnabled() {
  try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; }
}

export function setVoiceEnabled(on) {
  try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* sem armazenamento */ }
  if (!on) window.speechSynthesis?.cancel();
}

function ptVoice() {
  const voices = window.speechSynthesis?.getVoices?.() || [];
  // Prefere vozes masculinas/neutras pt-BR quando existirem (estilo Jarvis).
  return voices.find((v) => /pt-BR/i.test(v.lang) && /daniel|antonio|francisco|male/i.test(v.name))
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
  u.rate = 1.05;
  u.pitch = 0.9;
  synth.speak(u);
}
