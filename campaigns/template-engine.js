const { deriveGreeting } = require('./greeting');

const VARIABLE_MAP = {
  'nome': 'name',
  'empresa': 'name',
  'categoria': 'category',
  'telefone': 'phone',
  'endereco': 'address',
  'site': 'website',
  'instagram': 'instagram',
  'email': 'email',
  'rating': 'rating',
  'nota': 'rating',
  'estrelas': 'rating',
  'avaliacoes': 'totalReviews',
  'reviews': 'totalReviews',
  'totalreviews': 'totalReviews',
  'score': 'score',
  'prioridade': 'prioridade',
  'dor_principal': 'dor_principal',
  'oportunidade_principal': 'oportunidade_principal',
  'argumento_principal': 'argumento_principal',
  'mensagem_whatsapp_ia': 'mensagem_whatsapp_ia',
  'ticket_estimado': 'ticket_estimado',
  'chance_resposta': 'chance_resposta',
  'saudacao': 'saudacao',
  'decisor': 'decisor',
};

// Variáveis calculadas: sempre têm valor, mesmo sem dado salvo no lead.
const COMPUTED_VARS = {
  saudacao: (lead) => deriveGreeting(lead),
  decisor: (lead) => (typeof lead.decisor === 'object' ? lead.decisor?.nome : lead.decisor) || '',
};

function resolveVar(varName, leadData) {
  const field = VARIABLE_MAP[varName.toLowerCase()] || varName.toLowerCase();
  const lead = leadData || {};
  const value = COMPUTED_VARS[field] ? COMPUTED_VARS[field](lead) : lead[field];
  if (value == null || value === '') return '';
  return String(value)
    .replace(/[<>]/g, '')
    .replace(/[\n\r]+/g, ' ')
    .trim();
}

// {{var}} ou {{var|padrão}}. Variável vazia vira o padrão ou some: mandar
// "{{mensagem_whatsapp_ia}}" cru para o lead é pior do que omitir o trecho.
const VAR_RE = /\{\{(\w+)(?:\|([^{}]*))?\}\}/g;

function fillVars(text, leadData) {
  return String(text).replace(VAR_RE, (match, varName, fallback) => (
    resolveVar(varName, leadData) || String(fallback || '').trim()
  ));
}

/**
 * Resolve spintax patterns like {Olá|Oi|Hey} by picking a random variant.
 * Supports nested patterns and multiple occurrences per string.
 */
function resolveSpintax(text) {
  if (typeof text !== 'string') return text;
  let maxIterations = 20;
  while (text.includes('{') && maxIterations-- > 0) {
    const result = _resolveOneSpintax(text);
    if (result === text) break;
    text = result;
  }
  return text;
}

function _resolveOneSpintax(text) {
  let depth = 0;
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (text[i] === '}') {
      depth--;
      if (depth === 0 && start >= 0) {
        const inner = text.substring(start + 1, i);
        const options = inner.split('|');
        if (options.length > 1) {
          const chosen = options[Math.floor(Math.random() * options.length)];
          return text.substring(0, start) + chosen + text.substring(i + 1);
        }
        start = -1;
      }
    }
  }
  return text;
}

function interpolate(template, leadData) {
  if (typeof template === 'string') {
    return resolveSpintax(fillVars(template, leadData));
  }
  if (typeof template === 'object' && template !== null) {
    const result = {};
    if (template.text) result.text = resolveSpintax(fillVars(template.text, leadData));
    if (template.header) result.header = resolveSpintax(fillVars(template.header, leadData));
    if (template.footer) result.footer = resolveSpintax(fillVars(template.footer, leadData));
    if (Array.isArray(template.buttons)) {
      result.buttons = template.buttons.map(b => ({
        id: b.id || b.buttonId,
        text: resolveSpintax(fillVars(b.text || b.buttonText || '', leadData)),
      }));
    }
    // Pass media attachment through (no interpolation needed for binary)
    if (template.media) {
      result.media = template.media;
    }
    return result;
  }
  return template;
}

function extractVariables(template) {
  let text = '';
  if (typeof template === 'string') {
    text = template;
  } else if (typeof template === 'object' && template !== null) {
    text = [template.header, template.text, template.footer, ...(template.buttons || []).map(b => b.text || b.buttonText)].filter(Boolean).join(' ');
  }
  return [...new Set([...text.matchAll(VAR_RE)].map((m) => m[1]))];
}

module.exports = { interpolate, extractVariables, resolveSpintax };
