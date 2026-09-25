/**
 * Como chamar o lead na mensagem. O nome do Google Maps é o da empresa
 * ("Clínica Sorriso"), e ninguém se chama assim: "Olá, Clínica Sorriso" soa
 * robótico. Ordem de preferência:
 * 1) saudação definida pela pesquisa/IA;
 * 2) primeiro nome do decisor (sócio/dono identificado);
 * 3) "Dr./Dra. Fulano" presente no próprio nome da empresa;
 * 4) "pessoal da <empresa>".
 */
const TITLE_RE = /\b(dra|dr|doutora|doutor)\.?\s+([A-ZÀ-Ý][a-zà-ÿ]+)/i;

// Palavras que não são nome de pessoa quando aparecem em "Dr. X".
const NOT_A_NAME = new Set(['consultas', 'clinica', 'clínica', 'odonto', 'saude', 'saúde', 'pet', 'vet']);

function capitalize(word) {
  const w = String(word || '').toLowerCase();
  return w.charAt(0).toUpperCase() + w.slice(1);
}

function firstName(fullName) {
  const first = String(fullName || '').trim().split(/\s+/)[0] || '';
  return first.length >= 2 ? capitalize(first) : '';
}

function titleFromBusinessName(name) {
  const match = String(name || '').match(TITLE_RE);
  if (!match || NOT_A_NAME.has(match[2].toLowerCase())) return '';
  const title = match[1].toLowerCase().startsWith('dra') || match[1].toLowerCase() === 'doutora' ? 'Dra.' : 'Dr.';
  return `${title} ${capitalize(match[2])}`;
}

function shortBusinessName(name) {
  // Corta sufixos jurídicos e o que vem depois de separadores ("X - Unidade Centro").
  return String(name || '')
    .split(/\s[-|–—·]\s/)[0]
    .replace(/\b(ltda|me|eireli|epp|s\/?a)\.?$/i, '')
    .trim();
}

function deriveGreeting(lead = {}) {
  const explicit = String(lead.saudacao || '').trim();
  if (explicit) return explicit;
  const decisor = typeof lead.decisor === 'object' ? lead.decisor?.nome : lead.decisor;
  const byDecisor = firstName(decisor);
  const byTitle = titleFromBusinessName(lead.name || lead.company);
  // "Dra. Ana" é melhor que "Ana" quando o decisor é o profissional do nome.
  if (byDecisor && byTitle && byTitle.endsWith(` ${byDecisor}`)) return byTitle;
  if (byDecisor) return byDecisor;
  if (byTitle) return byTitle;
  const business = shortBusinessName(lead.company || lead.name);
  return business ? `pessoal da ${business}` : 'pessoal';
}

module.exports = { deriveGreeting, firstName, titleFromBusinessName, shortBusinessName };
