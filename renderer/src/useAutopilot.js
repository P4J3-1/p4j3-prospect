import { useCallback, useEffect, useState } from 'react';

/** Estado do piloto automático, atualizado ao vivo pelo processo principal. */
export function useAutopilot() {
  const [state, setState] = useState(null);

  const reload = useCallback(async () => {
    const res = await window.autopilotAPI?.getState?.().catch(() => null);
    if (res?.success) setState(res);
  }, []);

  useEffect(() => {
    reload();
    const off = window.autopilotAPI?.onEvent?.((event) => {
      if (!event) return;
      if (event.type === 'state') setState((current) => ({ ...(current || {}), ...event.state, success: true }));
      else if (event.type === 'feed') {
        setState((current) => (current ? { ...current, feed: [event.entry, ...(current.feed || [])].slice(0, 80) } : current));
      } else if (event.type === 'live') {
        setState((current) => (current ? {
          ...current,
          stages: (current.stages || []).map((s) => (s.id === event.stageId ? { ...s, live: event.live } : s)),
        } : current));
      } else if (event.type === 'reply-draft') {
        setState((current) => {
          if (!current) return current;
          const replyDrafts = { ...(current.replyDrafts || {}) };
          if (event.draft) replyDrafts[event.phone] = event.draft;
          else delete replyDrafts[event.phone];
          return { ...current, replyDrafts };
        });
      }
    });
    return () => { if (typeof off === 'function') off(); };
  }, [reload]);

  return [state, setState, reload];
}
