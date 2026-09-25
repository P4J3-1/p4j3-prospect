const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { deriveGreeting } = require('../campaigns/greeting');
const { interpolate } = require('../campaigns/template-engine');
const intel = require('../lead-scoring/lead-intel');
const { computeInsights } = require('../campaigns/learning');
const { optimizeCampaignMessage } = require('../lead-scoring/message-optimizer');

describe('saudação', () => {
  it('nunca trata a empresa como pessoa', () => {
    assert.equal(deriveGreeting({ name: 'Clínica Sorriso Ltda' }), 'pessoal da Clínica Sorriso');
    assert.equal(deriveGreeting({ name: 'Consultório Dra. Ana Lima' }), 'Dra. Ana');
    assert.equal(deriveGreeting({ name: 'Padaria X', decisor: { nome: 'WASGHTON DA CONCEICAO' } }), 'Wasghton');
    assert.equal(deriveGreeting({ name: 'Dra. Ana Lima Odonto', decisor: 'Ana Lima Souza' }), 'Dra. Ana');
    assert.equal(deriveGreeting({ name: 'X', saudacao: 'Seu João' }), 'Seu João');
  });

  it('template usa saudação e nunca envia variável crua', () => {
    const text = interpolate('Olá, {{saudacao}}! {{mensagem_whatsapp_ia}}Site: {{site|não tem}}', { name: 'Pet Center' });
    assert.equal(text, 'Olá, pessoal da Pet Center! Site: não tem');
  });
});

describe('pesquisa do lead', () => {
  const ddgHtml = `
    <div class="result results_links"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fcnpj.biz%2F16852564000192&rut=x">Padaria Real Park 16852564000192 Guarulhos</a>
    <a class="result__snippet">Central de Paes Mel e Pimenta &amp; Cia</a></div>
    <div class="result result--ad"><a class="result__a" href="https://ads.example.com">Anúncio</a></div>
    <div class="result"><a class="result__a" href="https://padariarealpark.com.br">Padaria Real Park - Site</a><a class="result__snippet">Pães e doces</a></div>`;

  it('lê resultados orgânicos e ignora anúncios', () => {
    const results = intel.parseSearchResults(ddgHtml);
    assert.equal(results.length, 2);
    assert.equal(results[0].url, 'https://cnpj.biz/16852564000192');
    assert.equal(results[0].snippet, 'Central de Paes Mel e Pimenta & Cia');
  });

  it('valida CNPJ pelos dígitos verificadores', () => {
    assert.equal(intel.isValidCnpj('16.852.564/0001-92'), true);
    assert.equal(intel.isValidCnpj('16.852.564/0001-93'), false);
    assert.deepEqual(intel.extractCnpjs('a 16852564000192 b 00.000.000/0001-91 c 11111111111111'), ['16852564000192', '00000000000191']);
  });

  it('IA não pode inventar decisor fora dos dados', () => {
    const corpus = intel.words('Padaria Real Park Wasghton da Conceicao');
    assert.equal(intel.sanitizeAiDecisor({ nome: 'Carlos Pereira' }, corpus), null);
    assert.equal(intel.sanitizeAiDecisor({ nome: 'Wasghton', confianca: 'alta' }, corpus).nome, 'Wasghton');
  });

  it('pesquisa completa com busca, Receita e IA simuladas', async () => {
    const fakeFetch = async (url) => {
      if (url.includes('duckduckgo')) return { ok: true, status: 200, text: async () => ddgHtml };
      if (url.includes('brasilapi')) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            razao_social: 'CENTRAL DE PAES MEL E PIMENTA LTDA',
            nome_fantasia: 'PADARIA REAL PARK',
            descricao_situacao_cadastral: 'ATIVA',
            municipio: 'GUARULHOS',
            uf: 'SP',
            qsa: [{ nome_socio: 'WASGHTON DA CONCEICAO', qualificacao_socio: 'Sócio-Administrador' }],
          }),
        };
      }
      return { ok: false, status: 404, text: async () => '' };
    };
    const payloads = [];
    const runAi = async ({ payload }) => {
      payloads.push(payload);
      return {
        provider: 'deepseek',
        model: 'deepseek-chat',
        result: {
          decisor: { nome: 'Wasghton da Conceicao', cargo: 'Sócio', confianca: 'alta' },
          saudacao: 'Wasghton',
          abordagem: { angulo: 'Encomendas pelo WhatsApp', mensagem: 'Oi Wasghton, tudo bem? Posso te mostrar uma ideia?' },
          chance_fechamento: { percentual: 180, classificacao: 'alta', justificativa: 'ok' },
        },
      };
    };
    const lead = { name: 'Padaria Real Park', address: 'Av. X, 10 - Centro, Guarulhos - SP' };
    const r = await intel.researchLead(lead, { commercial: { agencyName: 'P4J3' } }, { fetchImpl: fakeFetch, runAi, insights: { sent: 30, replyRate: 12, repliedMessages: ['Oi'], bestCategories: [] } });
    assert.equal(r.company.cnpj, '16852564000192');
    assert.equal(r.decisor.nome, 'Wasghton da Conceicao');
    assert.equal(r.saudacao, 'Wasghton');
    assert.equal(r.chance.percentual, 100, 'percentual limitado a 100');
    assert.equal(payloads[0].vendedor.agencyName, 'P4J3');
    assert.equal(payloads[0].aprendizados.taxa_resposta, 12);
  });

  it('sem IA ainda entrega decisor e estimativa por regras', async () => {
    const r = await intel.researchLead({ name: 'Consultório Dra. Ana Lima', phone: '11999990000' }, {}, { fetchImpl: async () => ({ ok: false, status: 500, text: async () => '' }) });
    assert.equal(r.decisor.nome, 'Ana Lima');
    assert.equal(r.saudacao, 'Dra. Ana');
    assert.ok(r.chance.percentual > 0);
  });
});

describe('aprendizado e otimização', () => {
  const now = Date.now();
  const campaigns = [{
    leads: [
      ...Array.from({ length: 6 }, (_, i) => ({ category: 'Padaria', sentAt: now - i, sentText: `A${i}`, repliedAt: now, status: 'replied' })),
      ...Array.from({ length: 6 }, (_, i) => ({ category: 'Dentista', sentAt: now - i, sentText: `B${i}`, status: 'read' })),
      { sentAt: now, status: 'failed' },
    ],
  }];

  it('mede o que teve resposta', () => {
    const insights = computeInsights(campaigns);
    assert.equal(insights.sent, 12);
    assert.equal(insights.replyRate, 50);
    assert.equal(insights.bestCategories[0].category, 'padaria');
    assert.ok(insights.repliedMessages.includes('A0'));
    assert.ok(insights.ignoredMessages.includes('B0'));
  });

  it('otimizador mantém {{saudacao}} e remove links', async () => {
    const res = await optimizeCampaignMessage({ template: 'x', insights: computeInsights(campaigns) }, async () => ({
      provider: 'deepseek',
      result: { mensagem: 'Oi! Veja https://spam.com agora?', follow_up: 'E aí? Responda SAIR se não quiser.', explicacao: 'teste' },
    }));
    assert.ok(res.mensagem.includes('{{saudacao}}'));
    assert.ok(!res.mensagem.includes('http'));
    assert.equal(res.followUp, 'E aí? Responda SAIR se não quiser.');
  });
});
