# Plano de correção integral — Sigma Scraper GMaps

Data: 09/09/2026
Status: planejamento aprovado; implementação ainda não iniciada
Plataforma-alvo: aplicação desktop Electron para Windows

## 1. Objetivo

Alinhar integralmente o Sigma Scraper GMaps ao projeto visual do Open Design, corrigindo também os problemas funcionais, de dados, integração, tratamento de erros, responsividade desktop e execução em segundo plano.

Este documento considera as capturas anotadas como evidência visual. As solicitações do usuário prevalecem quando alteram elementos presentes no protótipo.

O escopo é exclusivamente desktop. Não será criada nem otimizada uma interface mobile.

## 2. Estado verificado

- Executável inspecionado em um segundo monitor, com processo responsivo.
- 64 testes automatizados existentes passaram.
- A suíte atual não cobre adequadamente áudio real, múltiplos monitores, bandeja, ciclo da janela, todos os modais e integrações reais do WhatsApp.
- Campanhas: 12 no total, sendo 10 concluídas, 2 canceladas e nenhuma ativa, agendada ou pausada.
- Visão Geral: 1.322 leads deduplicados.
- Kanban: 1.288 entidades, seis colunas e nenhuma regra de negócio configurada nos dados atuais.
- Lead Scoring: somente 32 leads na base atual e um grupo sem membros.
- 1.258 dos 1.288 perfis do Kanban não possuem cidade/UF.
- Todos os 32 leads da base atual de scoring estão sem bairro.
- Categorias de restaurantes continuam fragmentadas entre categoria principal e subnichos.
- A migração anterior de endereços modificou poucos registros e não tratou integralmente o armazenamento ativo do renderer.
- O repositório estava limpo no momento da auditoria.
- Nenhuma mensagem foi enviada durante a auditoria.

## 3. Problemas confirmados

### 3.1 Janela e aplicação desktop

- Região de arraste inconsistente no cabeçalho frameless.
- Ausência de implementação de bandeja do sistema.
- Fechar a janela encerra o processo e desmonta os serviços.
- Controles de janela podem desaparecer por CSS.
- Bounds, monitor e estado da janela não possuem recuperação completa.

### 3.2 Navegação e identidade

- Sidebar inicia recolhida em vez de aberta.
- Expansão por hover conflita com o comportamento solicitado.
- Identidade ainda contém “Sigma GMaps”, “Community”, “Lote 2” e “Lote 1 · Teal · Light”.
- Busca global aparece fora da Visão Geral.
- Indicador do WhatsApp não permanece visível de forma consistente em todas as rotas.

### 3.3 WhatsApp

- Layout apresenta overflow horizontal e vertical global.
- Áudios ultrapassam os limites do balão.
- O seek visual não reposiciona corretamente o áudio real.
- Algumas mídias são exibidas como “Mensagem não suportada”.
- Status usa dados locais; Canais e Comunidades são placeholders.
- A barra de gatilhos está escondida.
- Existem arquivos antigos de gatilhos sem reconciliação confiável com os registros atuais.
- O componente principal está excessivamente concentrado, aumentando o risco de regressões.

### 3.4 Campanhas

- Intervalo padrão atual é 30 segundos.
- O assistente repete o número da etapa e a barra de progresso.
- Campos e opções podem cortar ou quebrar texto.
- Grupos vazios podem ser selecionados automaticamente.
- Fontes de leads não compartilham uma base canônica.
- Faltam garantias completas contra clique duplo, duplicidade e retomada indevida.

### 3.5 Kanban

- Não existe uma etapa padrão clara de “Enviados”.
- Kanban geral e Kanban de campanhas usam modelos diferentes.
- Faltam notas, pinagem, lembretes e histórico completo de movimentos.
- O quadro pode cortar colunas e produzir página vazia por conflito de overflow.

### 3.6 Lead Scoring

- OpenRouter ainda aparece como padrão em partes do sistema.
- A interface atual pode simular teste de conexão bem-sucedido sem requisição real.
- A auditoria visível pode executar heurística local em vez do backend real.
- O crawler atual não produz uma auditoria visual completa com navegador.

### 3.7 Dados e mapa

- Bases apresentam contagens e identificadores incompatíveis.
- Cidade e bairro não são recuperados de aliases ou campos estruturados de maneira uniforme.
- Taxonomia de categorias não diferencia corretamente categoria principal e subnicho.
- Caracteres invisíveis e especiais ainda precisam ser tratados em todos os caminhos de entrada e consulta.
- Marcadores do mapa são genéricos.
- Persistência da localização não possui confirmação e contrato versionado claros.

## 4. Comportamento final da janela e bandeja

- A janela será arrastável por áreas vazias do cabeçalho.
- Botões, campos, menus e abas serão regiões `no-drag`.
- Duplo clique no cabeçalho alternará maximizar e restaurar.
- Posição, tamanho, monitor e estado maximizado serão persistidos.
- A janela será recuperada automaticamente caso um monitor seja removido.
- Trocas de DPI entre monitores serão tratadas.
- Minimizar enviará a aplicação para a bandeja.
- WhatsApp e tarefas explicitamente iniciadas permanecerão ativos enquanto o processo estiver vivo.
- Rascunhos e campanhas canceladas nunca iniciarão automaticamente.
- No primeiro clique em fechar, o usuário escolherá entre continuar em segundo plano ou encerrar o Sigma, podendo memorizar a preferência.
- O menu da bandeja terá Abrir, estado do WhatsApp, campanhas ativas, pausa segura e Sair.
- Uma segunda abertura restaurará a instância existente.
- Após encerramento completo, queda ou reinicialização do computador, disparos não serão retomados sem confirmação.
- Minimizar, maximizar/restaurar e fechar permanecerão visíveis inclusive em tela cheia.

## 5. Plano de execução

### Fase 0 — Proteção dos dados e disparos

1. Criar backup versionado de `userData`, JSONs, campanhas, Kanban, configurações e armazenamento do renderer.
2. Registrar hash, quantidade, versão e schema de cada base.
3. Introduzir modo de manutenção com transporte de mensagens desabilitado.
4. Criar fixtures anonimizados com a mesma estrutura e volume dos dados reais.
5. Validar novamente a ausência de campanhas ativas.
6. Formalizar os estados: rascunho, pronta, agendada, executando, pausada, interrompida, concluída e cancelada.
7. Tratar “cancelada” como estado terminal.
8. Exigir confirmação específica antes de qualquer teste com transporte real.

Critério de aceite: migração e QA não podem enviar mensagens, reativar campanhas ou perder registros.

### Fase 1 — Shell desktop, movimentação e bandeja

1. Corrigir regiões Electron com `-webkit-app-region: drag` e `no-drag`.
2. Separar minimizar para bandeja, fechar para bandeja e sair de verdade.
3. Implementar `Tray`, menu, tooltip, notificações e ícone de estado.
4. Implementar encerramento controlado com flag de saída explícita.
5. Manter serviços vivos quando a janela estiver apenas escondida.
6. Adicionar trava de instância única.
7. Persistir bounds e validar coordenadas contra os monitores disponíveis.
8. Restaurar automaticamente janelas fora da área visível.
9. Tratar movimentação entre monitores com DPIs diferentes.
10. Manter a barra superior fixa acima do conteúdo.

Critério de aceite: ocultar e restaurar 20 vezes, mover entre monitores, redimensionar, maximizar e reabrir sem duplicação, perda de estado ou disparo indevido.

### Fase 2 — Estrutura visual desktop

Viewports obrigatórios:

- 900×600.
- 1024×768.
- 1280×720.
- 1366×768.
- 1440×900.
- 1600×900.
- 1920×1080.
- 2560×1440.
- Escalas do Windows em 100%, 125%, 150% e 175%.

Regras:

1. Não criar layout mobile.
2. Usar modo desktop compacto em telas menores.
3. Eliminar rolagem horizontal no documento.
4. Permitir rolagem somente em painéis internos apropriados.
5. Calcular a altura útil descontando cabeçalhos e áreas fixas.
6. Manter a composição do WhatsApp sempre acessível.
7. Impedir quebra, sobreposição ou corte de textos e controles.
8. Criar zoom de acessibilidade persistente, com atalhos e restauração.
9. Respeitar preferência de movimento reduzido.

### Fase 3 — Sidebar e identidade

1. Sidebar aberta por padrão.
2. Clique no ícone Sigma recolhe ou expande.
3. Remover expansão por hover.
4. Persistir a preferência depois do primeiro uso.
5. Usar “Sigma Scraper” na primeira linha e “GMaps” na segunda.
6. Remover “Community”, “Lote 2” e “Lote 1 · Teal · Light”.
7. Remover “Sigma” ao lado de Campanhas no WhatsApp.
8. Exibir busca global somente na Visão Geral.
9. Manter o estado do WhatsApp em todas as telas.
10. Manter controles da janela em todas as rotas.

Imagem da sidebar:

- Arte abstrata monocromática verde/teal.
- Sem texto ou logo embutido.
- Baixo contraste atrás da navegação.
- Arquivos 1× e 2×.
- Fallback em gradiente.
- Contraste AA em todos os textos.

### Fase 4 — Tratamento integral dos dados existentes

Criar uma fonte canônica única de leads.

Prioridade de identidade:

1. `placeId`.
2. Telefone E.164.
3. URL canônica.
4. Coordenadas confiáveis.
5. Hash controlado de nome, endereço e localização.

Implementação:

1. Preservar valores originais em `raw`.
2. Remover caracteres invisíveis, bidi, private-use, emojis de localização e outros ruídos.
3. Executar normalização na importação, migração, busca, cache e geocodificação.
4. Padronizar aliases de cidade e bairro.
5. Extrair localização somente quando houver evidência estruturada ou geográfica.
6. Usar “Não identificado” com motivo quando não for possível determinar o valor.
7. Separar categoria principal e subnicho.
8. Consolidar restaurantes sob a categoria principal “Restaurante”.
9. Remover o indicador “WA” visual da Base de Leads.
10. Manter telefone e capacidade de WhatsApp como atributos diferentes.
11. Reconciliar grupos antigos usando a identidade canônica.
12. Colocar correspondências ambíguas em quarentena, sem descarte.
13. Migrar arquivos e armazenamento ativo do renderer.
14. Garantir idempotência.
15. Emitir relatório com totais, uniões, enriquecimentos, alterações, ambiguidades e erros.

Critério de aceite: Visão Geral, Base, Scoring, Campanhas e Kanban devem consultar o mesmo índice e justificar qualquer diferença de contagem.

### Fase 5 — Scraper Maps

1. Normalizar endereço antes de geocodificar.
2. Migrar chaves antigas do cache.
3. Implementar retry e estado “não localizado”.
4. Recalcular o mapa após resize, maximização, troca de monitor ou mudança da sidebar.
5. Substituir círculos genéricos por marcadores de categoria.
6. Criar seletor de emoji por categoria.
7. Renderizar emojis de maneira consistente entre versões do Windows.
8. Salvar localização, zoom e área pesquisada em configuração versionada.
9. Mostrar confirmação visual de localização salva.
10. Diferenciar carregamento, vazio, endereço inválido, indisponibilidade e limite excedido.
11. Permitir cancelamento sem salvar resultados parciais inconsistentes.

### Fase 6 — WhatsApp

Separar o painel em módulos de sessões, conversas, mensagens, mídia, status, canais, comunidades, gatilhos e campanhas.

Layout:

1. Lista e conversa com alturas independentes.
2. Rolagem somente nos painéis internos.
3. Divisor ajustável.
4. Modo desktop compacto em telas menores.
5. Barra de composição sempre acessível.
6. Nenhum espaço vazio ou overflow global.

Áudio:

1. Conter waveform, duração e botão no balão.
2. Implementar `currentTime`, seek, pausa e retomada reais.
3. Mostrar loading, buffering e erro.
4. Normalizar duração e metadados.
5. Validar OGG/Opus, WebM, MP3, M4A e WAV.
6. Transcodificar somente quando necessário.
7. Corrigir classificação de mídias conhecidas.
8. Oferecer download ou retry quando a mídia falhar.

Gatilhos:

1. Reexibir barra compacta.
2. Criar acesso claro ao gerenciador.
3. Migrar textos, mídias e áudios antigos.
4. Detectar e recuperar arquivos órfãos.
5. Implementar pesquisa e atalhos de teclado.
6. Testar inserção, envio, edição e remoção.

Status, Canais e Comunidades:

1. Remover placeholders estáticos.
2. Criar APIs reais no adaptador do provedor.
3. Mostrar loading, erro, reconexão e retry.
4. Informar explicitamente quando uma função não for suportada pela conexão.
5. Atualizar o provedor somente após prova de compatibilidade e preservação da sessão.

### Fase 7 — Campanhas

1. Alterar o intervalo padrão para 60 segundos.
2. Remover “Etapa X de 4” e preservar somente a barra de progresso.
3. Usar títulos curtos e instruções contextuais.
4. Fixar cabeçalho e rodapé do assistente.
5. Corrigir estabilidade e foco do nome da campanha.
6. Carregar destinatários da fonte canônica.
7. Mostrar quantidade real por grupo.
8. Não selecionar automaticamente grupos vazios.
9. Bloquear avanço sem destinatários válidos.
10. Exibir destinatários únicos, intervalo, estimativa, conexão, limites e horário.
11. Diferenciar visualmente começar agora, agendar e salvar rascunho.
12. Bloquear clique duplo e criação duplicada.
13. Usar chave de idempotência.
14. Exigir confirmação final.
15. Impedir retomada de campanhas canceladas.
16. Oferecer pausa segura antes do encerramento do processo.
17. Usar transporte falso em toda a suíte automatizada.

Gamificação saudável:

- Medidor de prontidão.
- Progresso de validação.
- Marcos de enviados, entregues e respondidos.
- Feedback de conclusão.
- Sem pontos artificiais, excesso de animação ou informação duplicada.

### Fase 8 — Kanban geral e CRM

Colunas padrão sugeridas:

- Novos.
- Enviados.
- Em contato.
- Qualificados.
- Proposta.
- Ganhos.
- Perdidos.

Funcionalidades:

1. Toda campanha alimentará o Kanban geral.
2. `campaign.sent` moverá o lead para Enviados.
3. Uma resposta recebida moverá o lead para Em contato.
4. Regras poderão usar campanha, score, categoria, localização e interação.
5. Movimento manual pausará automações daquele lead.
6. Manter histórico de movimentos e origem.
7. Implementar quadro horizontal arrastável sem corte de colunas.
8. Suportar roda+Shift, trackpad e arraste do fundo.
9. Suportar drag-and-drop de cards.
10. Oferecer alternativa por teclado e seletor.
11. Exibir contadores por coluna e total prospectado.
12. Adicionar notas, pinagem, lembretes e ação de ligação.
13. Permitir lembretes por data e atalhos como sete dias.
14. Exibir lembretes vencidos na aplicação e na bandeja.
15. Transformar o Kanban de campanha em visão filtrada do Kanban global.
16. Simular regras antes de aplicá-las em massa.

### Fase 9 — OpenCode, Lead Scoring e Computer Use

Open Design continuará como referência visual. OpenCode será o provedor padrão de IA.

1. Definir OpenCode como padrão real.
2. Validar base URL e descoberta de modelos contra documentação oficial.
3. Unificar configurações do frontend e backend.
4. Proteger credenciais com armazenamento seguro do sistema.
5. Fazer o teste de conexão executar uma requisição real.
6. Remover chave demonstrativa, sucesso artificial e análises pré-preenchidas.
7. Conectar a auditoria ao backend real.
8. Identificar fallback local claramente como análise local.
9. Registrar provedor, modelo, método de captura e horário.

Computer Use:

1. Usar Playwright embutido como modo padrão.
2. Detectar harnesses locais por adaptadores permitidos.
3. Não instalar nem executar ferramentas automaticamente.
4. Exigir escolha explícita do usuário.
5. Capturar screenshot, DOM, copy, CTAs e sinais visuais.
6. Mostrar progresso e permitir cancelamento.
7. Bloquear URLs privadas, protocolos perigosos e redirecionamentos indevidos.
8. Aplicar limites de tempo, tamanho e quantidade de páginas.
9. Isolar cookies e credenciais.
10. Salvar evidência visível da auditoria.
11. Manter análise somente HTML como fallback identificado.

### Fase 10 — Modais, acessibilidade e erros

Todos os modais fazem parte do escopo, incluindo:

- Nova extração.
- Exportação.
- Criar e adicionar grupo.
- Detalhe do lead.
- Configuração de IA.
- Detalhe do scoring.
- Configuração do Kanban.
- Detalhe CRM do card.
- Nova conversa.
- Perfil do contato.
- Conexões.
- QR Code.
- Perfil da sessão.
- Encaminhar.
- Status.
- Gatilhos.
- Lista e monitor de campanhas.
- Assistente de campanha.
- Confirmações e erros.

Contrato comum:

1. Cabeçalho e ações sempre visíveis.
2. Corpo com rolagem interna.
3. Operação completa em 900×600.
4. Foco preso no modal.
5. `Esc` fecha quando for seguro.
6. Ações destrutivas exigem confirmação.
7. Foco retorna ao elemento de origem.
8. Resize não apaga estado.
9. Campos preservam rascunho.
10. Erros aparecem próximos da causa.
11. Botões possuem loading e bloqueio de clique duplicado.
12. Não há informação redundante de progresso.

## 6. Matriz de testes

| Camada | Validação obrigatória |
|---|---|
| Unitária | Normalização, migração, identidade, categorias, áudio, campanhas, limites, regras e bounds da janela |
| Integração | WhatsApp, mídias, status, canais, comunidades, campanhas, OpenCode, geocoder e eventos do Kanban |
| E2E Electron | Navegação, todos os modais, resize, zoom, arraste, maximização, bandeja e restauração |
| Dados existentes | 1.322 leads, 1.288 cards, 363 conversas e referências antigas, sem expor informações pessoais |
| Segurança | Transporte falso, zero mensagens, URLs seguras, segredos mascarados, arquivos corrompidos e rollback |
| Visual | Comparação com o HTML do Open Design, capturas anotadas e executável compilado |
| Desempenho | Base completa, filtros, scroll, troca de rotas, memória e conversas extensas |
| Recuperação | Offline, sessão expirada, áudio ausente, API inválida, rate limit, JSON corrompido e monitor removido |

### Gate visual

- Geometria estática com tolerância máxima de 2 px.
- Tokens de cor, borda, raio e tipografia alinhados ao Open Design.
- Diferença perceptual máxima de 1% após mascarar dados dinâmicos.
- Zero overflow no documento.
- Zero controle cortado.
- Todos os modais capturados em 900×600, 1366×768 e 1920×1080.
- Captura física nos dois monitores e em diferentes escalas de DPI.

## 7. Dependências

1. Segurança e backup precedem qualquer migração.
2. Fonte canônica e migração precedem Base, Campanhas, Kanban e Scoring.
3. Shell desktop e estrutura visual precedem o E2E definitivo.
4. Adaptador real do WhatsApp precede Status, Canais e Comunidades.
5. Eventos de campanhas precedem a consolidação do Kanban.
6. Backend real precede a validação do OpenCode e Computer Use.
7. Nenhuma distribuição pode ser publicada antes de todos os gates.

## 8. Tratamento de erros obrigatório

Cada fluxo crítico deverá distinguir:

- Carregando.
- Vazio legítimo.
- Sem conexão.
- Sessão expirada.
- Dados inválidos.
- Permissão negada.
- Limite ou rate limit.
- Timeout.
- Arquivo ausente ou corrompido.
- Recurso não suportado pelo provedor.
- Falha recuperável com retry.
- Falha que exige intervenção do usuário.

Logs deverão usar identificadores de correlação e não poderão expor chaves, tokens, conteúdo privado ou dados pessoais desnecessários.

## 9. Critério de conclusão

O trabalho somente será considerado 100% concluído quando:

- Todos os testes novos e os 64 existentes passarem.
- Nenhuma mensagem for disparada durante QA.
- Dados existentes forem migrados e reconciliados.
- O executável instalado reproduzir o Open Design.
- Todos os modais forem validados.
- Áudios funcionarem visual e funcionalmente.
- Status, Canais e Comunidades tiverem integração real ou erro de capacidade explícito.
- OpenCode realizar uma auditoria real.
- Kanban, campanhas e leads compartilharem a mesma fonte de verdade.
- A janela puder ser arrastada e redimensionada entre monitores.
- A bandeja mantiver o processo vivo de maneira segura.
- A atualização sobre a versão anterior for validada.
- Hashes dos artefatos forem conferidos.
- Commit, tag, release notes, instalador e ZIP forem publicados e verificados no GitHub.

## 10. Release e rollback

Versão sugerida: `1.2.0`, por incluir alterações funcionais e de arquitetura.

Sequência:

1. Criar backup e tag de segurança.
2. Executar migração em uma cópia dos dados.
3. Executar a suíte completa.
4. Gerar renderer e distribuição limpos.
5. Instalar sobre a versão anterior.
6. Validar migração, WhatsApp, áudio, mapa, Kanban, OpenCode, janela e bandeja no executável instalado.
7. Conferir hashes do instalador e ZIP.
8. Publicar commit, tag e release notes.
9. Publicar os artefatos no GitHub.
10. Baixar novamente os artefatos publicados e executar o smoke test final.

Rollback:

- Restaurar a versão anterior do aplicativo.
- Restaurar o backup versionado dos dados.
- Preservar o relatório da migração com a causa da reversão.
- Não permitir que uma reversão reative campanhas canceladas ou interrompidas.

## 11. Estado deste documento

Este arquivo registra somente o planejamento. A implementação, migração, geração da imagem, nova distribuição e publicação no GitHub dependem do início formal da execução deste plano.
