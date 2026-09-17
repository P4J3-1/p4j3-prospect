/**
 * Divisão inteligente de entradas em lote para extrações gigantes.
 * O usuário pode colar "dentistas, advogados, pizzarias" (nichos) ou
 * "Copacabana, Pinheiros, Centro" (bairros) e cada item vira um alvo.
 */

export const MAX_BATCH_ITEMS = 50;
export const MAX_MATRIX_TARGETS = 200;

function foldKey(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Quebra texto colado em itens únicos: vírgula, ponto-e-vírgula ou
 * quebra de linha valem como separador. Remove vazios e duplicados
 * (insensível a maiúsculas e acentos).
 */
export function splitBatchInput(value, { max = MAX_BATCH_ITEMS, maxLen = 80 } = {}) {
  const seen = new Set();
  const out = [];
  for (const raw of String(value ?? '').split(/[,;\n]+/)) {
    const item = raw.trim().replace(/\s+/g, ' ');
    if (!item) continue;
    const key = foldKey(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item.slice(0, maxLen));
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Matriz de alvos nicho × bairro. Sem bairros, cada nicho vira um alvo
 * no município inteiro. Limitada para não travar a fila.
 */
export function buildExtractionTargets(niches, neighborhoods) {
  const nicheList = (Array.isArray(niches) ? niches : []).filter(Boolean);
  const neighList = (Array.isArray(neighborhoods) ? neighborhoods : []).filter(Boolean);
  const targets = [];
  for (const niche of nicheList) {
    if (neighList.length) {
      for (const neighborhood of neighList) {
        targets.push({ niche, neighborhood, key: `${niche}||${neighborhood}` });
      }
    } else {
      targets.push({ niche, neighborhood: '', key: `${niche}||` });
    }
  }
  return targets.slice(0, MAX_MATRIX_TARGETS);
}
