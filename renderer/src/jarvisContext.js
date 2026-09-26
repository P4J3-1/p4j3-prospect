// O que está na tela agora (tela aberta, lead selecionado, conversa aberta).
// O J.A.R.V.I.S. lê isto a cada ordem para analisar junto com você.
const state = { tela: '', lead: null, conversa: null };

/** Atualiza parte do contexto (cada tela informa o que mostra). */
export function setJarvisContext(patch) {
  Object.assign(state, patch || {});
}

/** Retrato compacto e seguro do contexto (sem dados sensíveis além do necessário). */
export function getJarvisContext() {
  const lead = state.lead
    ? {
        nome: String(state.lead.name || '').slice(0, 120),
        telefone: String(state.lead.phone || state.lead.tel || '').slice(0, 30),
        nicho: String(state.lead.category || '').slice(0, 80),
        bairro: String(state.lead.neighborhood || state.lead.city || '').slice(0, 80),
      }
    : null;
  return {
    tela: state.tela,
    lead,
    conversa: state.conversa
      ? {
          nome: String(state.conversa.name || '').slice(0, 120),
          telefone: String(state.conversa.phone || '').slice(0, 30),
          ultimas: (state.conversa.messages || []).slice(-12).map((m) => ({ de: m.fromMe ? 'voce' : 'lead', texto: String(m.text || '').slice(0, 300) })),
        }
      : null,
  };
}
