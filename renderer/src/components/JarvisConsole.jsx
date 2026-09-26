import React, { useEffect, useRef, useState } from 'react';
import { Send, Volume2, VolumeX, X } from 'lucide-react';
import { speak, voiceEnabled, setVoiceEnabled } from '../jarvisVoice';

const SUGGESTIONS = [
  'Como estamos hoje?',
  'Caçar barbearia em Taguatinga, DF',
  'Radar de pet shop em Ceilândia, DF',
  'Aprovar os 20 melhores',
  'Preparar as respostas',
  'Quem está esperando resposta?',
];

/**
 * Console do J.A.R.V.I.S. (Ctrl+J em qualquer tela): ordens em português que
 * viram ações dos agentes, com resposta falada.
 */
export default function JarvisConsole({ onNavigate }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState([{ from: 'jarvis', text: 'Às suas ordens, senhor. O que vamos prospectar?' }]);
  const [voice, setVoice] = useState(voiceEnabled());
  const inputRef = useRef(null);
  const listRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    const onOpen = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('sigma:jarvis-open', onOpen);
    // Avisos proativos (lead respondeu, caçada concluída): falados e no histórico.
    const off = window.jarvisAPI?.onSay?.(({ text: said, priority } = {}) => {
      if (!said) return;
      setLog((l) => [...l, { from: 'jarvis', text: said }].slice(-40));
      speak(said, { priority });
    });
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('sigma:jarvis-open', onOpen);
      if (typeof off === 'function') off();
    };
  }, []);

  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 50); }, [open]);
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' }); }, [log, open]);

  const send = async (order) => {
    const value = String(order ?? text).trim();
    if (!value || busy) return;
    setText('');
    setBusy(true);
    setLog((l) => [...l, { from: 'voce', text: value }]);
    try {
      const res = await window.jarvisAPI.command(value);
      const reply = res?.success ? res.reply : res?.error || 'Não consegui agora, senhor.';
      setLog((l) => [...l, { from: 'jarvis', text: reply, ai: res?.ai }].slice(-40));
      speak(reply, { priority: true });
      if (res?.navigate) onNavigate?.(res.navigate);
    } catch (error) {
      setLog((l) => [...l, { from: 'jarvis', text: error?.message || 'Falhou.' }]);
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button type="button" className="jv-fab" onClick={() => setOpen(true)} title="J.A.R.V.I.S. (Ctrl+J)" aria-label="Abrir o J.A.R.V.I.S.">
        <span className="jv-fab-core" />
      </button>
    );
  }

  return (
    <div className="jv-console-backdrop" onClick={() => setOpen(false)}>
      <section className="jv-console" role="dialog" aria-label="J.A.R.V.I.S." onClick={(e) => e.stopPropagation()}>
        <header>
          <span className={`jv-console-core ${busy ? 'busy' : ''}`} aria-hidden="true" />
          <div>
            <b>J.A.R.V.I.S.</b>
            <small>{busy ? 'processando…' : 'ouvindo suas ordens · Ctrl+J'}</small>
          </div>
          <button type="button" className="ap-icon" title={voice ? 'Desligar voz' : 'Ligar voz'} onClick={() => { setVoiceEnabled(!voice); setVoice(!voice); }}>
            {voice ? <Volume2 size={16} /> : <VolumeX size={16} />}
          </button>
          <button type="button" className="ap-icon" title="Fechar (Esc)" onClick={() => setOpen(false)}><X size={16} /></button>
        </header>
        <ol className="jv-console-log" ref={listRef}>
          {log.map((m, i) => (
            <li key={i} className={m.from}>
              <span>{m.text}</span>
            </li>
          ))}
          {busy && <li className="jarvis typing"><span><i /><i /><i /></span></li>}
        </ol>
        <div className="jv-console-suggest">
          {SUGGESTIONS.map((s) => <button key={s} type="button" onClick={() => send(s)} disabled={busy}>{s}</button>)}
        </div>
        <form className="jv-console-input" onSubmit={(e) => { e.preventDefault(); send(); }}>
          <input ref={inputRef} value={text} onChange={(e) => setText(e.target.value)} placeholder="Ex.: caçar dentistas em Águas Claras, DF" aria-label="Ordem para o Jarvis" />
          <button type="submit" disabled={busy || !text.trim()} aria-label="Enviar ordem"><Send size={16} /></button>
        </form>
      </section>
    </div>
  );
}
