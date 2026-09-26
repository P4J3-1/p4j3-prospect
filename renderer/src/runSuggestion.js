import { getJarvisContext } from './jarvisContext';

const say = (text) => text && window.dispatchEvent(new CustomEvent('sigma:jarvis-say', { detail: { text } }));

function openChat(chat, onNavigate) {
  window.__p4j3PendingChat = chat;
  window.dispatchEvent(new CustomEvent('sigma:open-chat', { detail: chat }));
  onNavigate?.('whatsapp');
}

/**
 * Executa a ação de uma sugestão (J.A.R.V.I.S., Crítico, Kanban): abre a
 * conversa certa, a fila, liga o piloto ou manda a ordem direto ao J.A.R.V.I.S.
 * (sem IA para entender). Devolve a resposta dela, se houver.
 */
export async function runSuggestion(acao, onNavigate) {
  if (!acao) return '';
  if (acao.tipo === 'responder' && acao.phone) {
    openChat({ phone: acao.phone, name: acao.name || '', text: acao.text || '' }, onNavigate);
    return '';
  }
  if (acao.tipo === 'fila' || acao.tipo === 'montar') {
    window.__p4j3OpenQueue = acao.tipo === 'fila';
    if (acao.tipo === 'montar') {
      window.__p4j3PendingFilter = { aba: 'disponiveis', filtro: 'pronto' };
      window.dispatchEvent(new CustomEvent('sigma:hunter-filter', { detail: window.__p4j3PendingFilter }));
    } else {
      window.dispatchEvent(new CustomEvent('sigma:open-queue'));
    }
    onNavigate?.('scraper');
    return '';
  }
  if (acao.tipo === 'piloto') {
    await window.autopilotAPI?.settings?.({ enabled: true });
    say('Piloto automático ligado. Os agentes estão em campo.');
    return '';
  }
  if (acao.tipo === 'respostas') {
    window.__p4j3AgentsTab = 'respostas';
    window.dispatchEvent(new CustomEvent('sigma:agents-tab', { detail: 'respostas' }));
    onNavigate?.('agents');
    return '';
  }
  if (acao.tipo === 'jarvis' && acao.acao) {
    const res = await window.jarvisAPI?.act?.(acao.acao, acao.parametros || {}, getJarvisContext());
    if (!res?.success) {
      say(res?.error || 'Não consegui agora, senhor.');
      return res?.error || '';
    }
    if (res.openChat?.phone) openChat(res.openChat, null);
    if (res.filter) {
      window.__p4j3PendingFilter = res.filter;
      window.dispatchEvent(new CustomEvent('sigma:hunter-filter', { detail: res.filter }));
    }
    if (res.navigate) onNavigate?.(res.navigate);
    say(res.reply);
    return res.reply || '';
  }
  if (acao.go) onNavigate?.(acao.go);
  return '';
}
