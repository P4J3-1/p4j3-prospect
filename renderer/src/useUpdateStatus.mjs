// Estado de atualização compartilhado entre o aviso do topo e as Configurações.
// Escuta o processo principal e se sincroniza ao montar, porque a verificação
// de abertura pode acontecer antes de qualquer tela existir.

import { useCallback, useEffect, useRef, useState } from 'react';

export function reduceUpdateEvent(data) {
  if (!data?.status) return null;
  if (data.status === 'checking') return { type: 'checking' };
  if (data.status === 'available') return { type: 'available', version: data.version };
  if (data.status === 'progress') {
    return {
      type: 'progress',
      percent: Math.min(100, Math.max(0, Number(data.percent) || 0)),
      transferred: Number(data.transferred) || 0,
      total: Number(data.total) || 0,
    };
  }
  if (data.status === 'downloaded') return { type: 'downloaded', version: data.version };
  if (data.status === 'not-available') return { type: 'up-to-date' };
  if (data.status === 'error') return { type: 'error', message: data.message };
  return null;
}

export function useUpdateStatus() {
  const [state, setState] = useState({ type: 'loading' });
  const [capability, setCapability] = useState(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    let cleanup;
    if (window.electronAPI?.onUpdateStatus) {
      cleanup = window.electronAPI.onUpdateStatus((data) => {
        const next = reduceUpdateEvent(data);
        // Não regride um download em andamento com um evento mais antigo.
        if (next) setState((current) => (current.type === 'progress' && (next.type === 'checking' || next.type === 'up-to-date') ? current : next));
      });
    }
    window.electronAPI?.getUpdateStatus?.()
      .then((res) => {
        if (!mountedRef.current || !res) return;
        setCapability({
          version: res.version,
          isPackaged: res.isPackaged,
          hasUpdater: res.hasUpdater,
          unavailableReason: res.unavailableReason || null,
        });
        if (res.unavailableReason) {
          setState({ type: 'unavailable', message: res.unavailableReason });
          return;
        }
        const restored = reduceUpdateEvent(res.last);
        setState(restored || { type: 'idle' });
      })
      .catch(() => {
        if (mountedRef.current) setState({ type: 'idle' });
      });
    return () => {
      mountedRef.current = false;
      if (typeof cleanup === 'function') cleanup();
    };
  }, []);

  const check = useCallback(async () => {
    setState({ type: 'checking' });
    try {
      const res = await window.electronAPI?.checkUpdate?.();
      if (!res?.success) {
        setState({ type: 'error', message: res?.error || 'Não foi possível verificar a atualização.' });
        return false;
      }
      return true;
    } catch (error) {
      setState({ type: 'error', message: error?.message || 'Não foi possível verificar a atualização.' });
      return false;
    }
  }, []);

  const download = useCallback(async () => {
    setState({ type: 'progress', percent: 0, transferred: 0, total: 0 });
    try {
      const res = await window.electronAPI?.downloadUpdate?.();
      if (!res?.success) {
        setState({ type: 'error', message: res?.error || 'Não foi possível baixar a atualização.' });
        return false;
      }
      return true;
    } catch (error) {
      setState({ type: 'error', message: error?.message || 'Não foi possível baixar a atualização.' });
      return false;
    }
  }, []);

  const install = useCallback(async () => {
    try {
      const res = await window.electronAPI?.installUpdate?.();
      if (!res?.success) {
        setState({ type: 'error', message: res?.error || 'Não foi possível instalar a atualização.' });
        return false;
      }
      return true;
    } catch (error) {
      setState({ type: 'error', message: error?.message || 'Não foi possível instalar a atualização.' });
      return false;
    }
  }, []);

  return { state, capability, check, download, install };
}

export function formatMb(bytes) {
  const value = Number(bytes) || 0;
  if (value <= 0) return '';
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}
