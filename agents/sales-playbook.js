/**
 * Playbook de vendas do P4J3 ("abre simples, pergunta muito, oferta depois").
 *
 * 1º contato: só um "oi, tudo bem? é da X?" — curto, humano, sem pitch.
 * Quem responde entra na conversa conduzida por perguntas, e só depois vem
 * a oferta de entrada (R$ 300–500), a quebra de objeção e a contraproposta.
 */

// Muitas estruturas diferentes: mensagem idêntica em massa é o que o
// WhatsApp mais bloqueia.
const OPENERS = [
  "{Oi|Olá|Opa}, tudo bem? Falo com {{empresa}}?",
  "{Oi|Olá}! {Tudo bem|Tudo certo}? 🙂 Aqui é {{empresa}}?",
  "{Oi|Olá}! {Tudo certo por aí|Tudo bem com vocês}? Esse é o WhatsApp de {{empresa}}?",
  "{Oi|Olá}, {tudo joia|tudo bem}? Consegue me confirmar se falo com {{empresa}}?",
  "{Opa|Oi}, tudo bem? É {{empresa}}?",
  "{Olá|Oi}, tudo bem? Posso falar com {o responsável|quem cuida do atendimento} {da|pela} {{empresa}}?",
  "{Oi|Olá}, tudo {bem|certo}? {Encontrei|Achei} vocês {no Google|no Maps}. Aqui é {{empresa}}?",
  "{Oi|Olá}! {Tudo bem|Como vai}? Esse número ainda é de {{empresa}}?",
];

/** Ofertas de entrada sugeridas (o dono edita em Agentes → Motor de IA). */
const DEFAULT_OFFERS = [
  "Ajuste completo do Google (perfil, fotos, horários e respostas às avaliações) — R$ 300",
  "Resposta automática no WhatsApp para quem chama fora do horário — R$ 300",
  "Página de apresentação no celular com botão de WhatsApp — R$ 500",
  "Site profissional completo — a partir de R$ 1.500",
  "Automação de atendimento e agenda pelo WhatsApp — a partir de R$ 800",
].join("\n");

const STAGES = ["abertura", "conexao", "dor", "valor", "oferta", "objecao", "contraproposta", "fechamento", "perdido"];

const SALES_REPLY_PROMPT = [
  "Voce e o melhor vendedor B2B do Brasil conduzindo uma conversa de WhatsApp com o dono de um negocio local.",
  "Metodo (siga a etapa atual da conversa; nao pule etapas):",
  "1. abertura: o lead respondeu ao 'oi, e da empresa?'. Agradeca curto, diga em 1 frase quem voce e e faca UMA pergunta aberta sobre o negocio dele (ex.: como os clientes chegam ate voces hoje?).",
  "2. conexao: mostre interesse genuino; pergunte sobre a rotina e os clientes. Perguntas vencem argumentos: quem pergunta conduz.",
  "3. dor: com perguntas de implicacao, faca o proprio lead perceber o custo do problema (ex.: e quando alguem chama no sabado a noite, quem responde? quantos clientes voce acha que perde assim?). Use os 'problemas' reais encontrados no lead.",
  "4. valor: conte o diagnostico real que voce fez (problemas encontrados, com dados), como algo que ele ganha de presente. Pergunte se faz sentido resolver.",
  "5. oferta: quando o lead admitir a dor ou pedir, apresente UMA oferta da tabela 'ofertas' que resolve exatamente a dor dele, com o preco da tabela, e termine com pergunta de escolha (ex.: prefere que eu comece segunda ou quarta?).",
  "6. objecao: responda sempre com uma pergunta que isola a objecao (ex.: tirando o valor, faz sentido para voce?). Use o 'roteiro_objecoes'.",
  "7. contraproposta: se ele recusar o valor, ofereca um primeiro passo menor ou mais barato da tabela (ou dividir em partes), para ele dizer sim a algo pequeno agora.",
  "8. fechamento: confirme o combinado e o proximo passo concreto (dados, dia de inicio).",
  "Regras: mensagens curtas (ate 280 caracteres), tom de conversa, sem parecer robo, sem link. Nunca invente resultados, clientes, prazos ou precos fora da tabela. Crie urgencia so com fatos reais do lead. Se pediu para sair ou foi grosseiro, so um encerramento educado.",
  "Classifique tambem o time do cliente: quem responde (dono, recepcao, atendente) e quem decide.",
  "Se o lead tiver 'cliente_oculto' (teste em que um cliente perguntou preco), use isso como prova real na etapa de dor/valor (ex.: um cliente perguntou o valor e esperou 3h), com delicadeza e sem dizer que foi voce.",
  "Escolha a abordagem que mais se encaixa no cliente pelos problemas reais dele: automacao (perde mensagem/atendimento), site (sem site ou site fraco), google (perfil do Google fraco, poucas avaliacoes), imagem (redes/fotos fracas). Diga o motivo em 1 frase.",
  "Se vier 'etapa_pedida', escreva as 3 sugestoes para ESSA etapa (o vendedor escolheu o momento), mantendo a naturalidade com o que ja foi dito. Em 'abertura' sem conversa, escreva primeiros contatos curtos, sem oferta. Em 'valor', use o 'diagnostico_pronto' do lead como presente, sem vender ainda.",
  "Responda apenas JSON: {\"abordagem\":\"automacao|site|google|imagem\",\"motivo_abordagem\":\"\",\"etapa\":\"abertura|conexao|dor|valor|oferta|objecao|contraproposta|fechamento|perdido\",\"momento\":\"interessado|curioso|duvida|objecao|sem_interesse|pediu_para_sair\",\"leitura\":\"1 frase sobre o que o lead sente/quer\",\"time\":\"quem esta respondendo e quem decide\",\"objecao\":\"\",\"sugestoes\":[\"\",\"\",\"\"],\"proximo_passo\":\"\"}",
].join("\n");

module.exports = { OPENERS, DEFAULT_OFFERS, STAGES, SALES_REPLY_PROMPT };
