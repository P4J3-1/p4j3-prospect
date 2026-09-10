import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pause as PauseIcon, Play as PlayIcon } from 'lucide-react';

function formatTime(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}

function finiteTime(value) {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : 0;
}

/**
 * Player de voz baseado no HTMLMediaElement real. O relógio e o seek seguem
 * currentTime/duration do arquivo, com guardas para fontes ainda indisponíveis.
 */
export default function ChatVoicePlayer({
  msgId,
  src,
  isPtt,
  secondsHint,
  loading,
  error,
  onLoad,
  onRetry,
}) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [mediaDuration, setMediaDuration] = useState(0);
  const [buffering, setBuffering] = useState(false);

  const hintedDuration = finiteTime(secondsHint);
  const duration = mediaDuration || hintedDuration;

  const syncMediaTime = useCallback(() => {
    const media = audioRef.current;
    if (!media) return;
    setElapsed(finiteTime(media.currentTime));
    const nextDuration = finiteTime(media.duration);
    if (nextDuration > 0) setMediaDuration(nextDuration);
  }, []);

  useEffect(() => {
    const media = audioRef.current;
    if (!media) return undefined;
    try {
      media.pause();
      media.currentTime = 0;
    } catch {
      // A fonte pode ainda não estar pronta no Chromium/Electron.
    }
    setPlaying(false);
    setElapsed(0);
    setMediaDuration(0);
    setBuffering(false);
    return undefined;
  }, [msgId, src]);

  useEffect(() => () => {
    try {
      audioRef.current?.pause();
    } catch {
      // best effort during unmount
    }
  }, []);

  const togglePlay = useCallback(async () => {
    if (!src) {
      onLoad?.();
      return;
    }

    const media = audioRef.current;
    if (!media) return;

    try {
      if (!media.paused) {
        media.pause();
        return;
      }

      document.querySelectorAll('audio[data-sigma-voice="1"]').forEach((other) => {
        if (other !== media) {
          try {
            other.pause();
          } catch {
            // One bad player cannot block this message.
          }
        }
      });

      setBuffering(true);
      await media.play();
    } catch {
      setPlaying(false);
      setBuffering(false);
    }
  }, [onLoad, src]);

  const seekTo = useCallback((next) => {
    const media = audioRef.current;
    const max = finiteTime(media?.duration) || duration;
    if (!media || !src || max <= 0) return;
    const target = Math.max(0, Math.min(max, Number(next) || 0));
    try {
      media.currentTime = target;
      setElapsed(target);
    } catch {
      // Metadata can disappear while a remote media file is being retried.
    }
  }, [duration, src]);

  const seekFromPointer = useCallback((event) => {
    event.stopPropagation();
    const rect = event.currentTarget?.getBoundingClientRect?.();
    if (!rect?.width || duration <= 0) return;
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    seekTo(ratio * duration);
  }, [duration, seekTo]);

  const handleSeekKeyDown = useCallback((event) => {
    if (duration <= 0) return;
    const step = event.shiftKey ? 10 : 5;
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      seekTo(elapsed - step);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      seekTo(elapsed + step);
    } else if (event.key === 'Home') {
      event.preventDefault();
      seekTo(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      seekTo(duration);
    }
  }, [duration, elapsed, seekTo]);

  const shownTime = playing || elapsed > 0 ? elapsed : duration;
  const progress = duration > 0 ? Math.min(100, (Math.min(elapsed, duration) / duration) * 100) : 0;

  return (
    <div className={`chat-voice ${src ? 'ready' : ''} ${isPtt ? 'ptt' : ''} ${buffering ? 'buffering' : ''}`}>
      <button
        type="button"
        className={`chat-voice-play ${playing ? 'playing' : ''}`}
        onClick={(event) => {
          event.stopPropagation();
          togglePlay();
        }}
        disabled={!!loading}
        title={src ? (playing ? 'Pausar' : 'Reproduzir') : 'Carregar áudio'}
        aria-label={src ? (playing ? 'Pausar áudio' : 'Reproduzir áudio') : 'Carregar áudio'}
      >
        {loading || buffering ? <span className="chat-voice-spinner" /> : playing ? <PauseIcon size={16} /> : <PlayIcon size={16} />}
      </button>
      <div className="chat-voice-body">
        <div
          className="chat-voice-wave"
          role="slider"
          tabIndex={0}
          aria-label="Posição do áudio"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(elapsed)}
          onClick={seekFromPointer}
          onKeyDown={handleSeekKeyDown}
        >
          <div className="chat-voice-wave-bg" />
          <div className="chat-voice-wave-fill" style={{ width: `${progress}%` }} />
          <div className="chat-voice-bars" aria-hidden="true">
            {Array.from({ length: 24 }).map((_, index) => (
              <span key={index} style={{ height: `${30 + ((index * 17) % 55)}%` }} />
            ))}
          </div>
        </div>
        <div className="chat-voice-meta">
          <span>{isPtt ? 'Mensagem de voz' : 'Áudio'}</span>
          <span className="chat-voice-time">{formatTime(shownTime)}</span>
        </div>
      </div>
      <audio
        ref={audioRef}
        src={src || undefined}
        data-sigma-voice="1"
        data-msg-id={msgId || ''}
        preload="metadata"
        style={{ display: 'none' }}
        onLoadedMetadata={syncMediaTime}
        onDurationChange={syncMediaTime}
        onTimeUpdate={syncMediaTime}
        onPlay={() => {
          setPlaying(true);
          setBuffering(false);
          syncMediaTime();
        }}
        onPause={() => {
          setPlaying(false);
          setBuffering(false);
          syncMediaTime();
        }}
        onWaiting={() => setBuffering(true)}
        onCanPlay={() => setBuffering(false)}
        onEnded={() => {
          setPlaying(false);
          setBuffering(false);
          setElapsed(0);
          try {
            if (audioRef.current) audioRef.current.currentTime = 0;
          } catch {
            // Media may already be detached.
          }
        }}
        onError={() => {
          setPlaying(false);
          setBuffering(false);
        }}
      />
      {error ? (
        <button
          type="button"
          className="chat-media-retry"
          onClick={(event) => {
            event.stopPropagation();
            onRetry?.();
          }}
        >
          Tentar de novo
        </button>
      ) : null}
    </div>
  );
}
