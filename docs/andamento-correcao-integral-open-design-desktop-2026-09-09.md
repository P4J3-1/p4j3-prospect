# Andamento — correção integral Open Design Desktop

Base: `plano-correcao-integral-open-design-desktop-2026-09-09.md`
Atualizado: 09/09/2026

## Implementado em código

- [x] Casca desktop (janela, bandeja, estado de janela e zoom de acessibilidade).
- [x] Sidebar, superfícies principais e tokens visuais do Open Design.
- [x] Correção de texto UTF-8 corrompido na coleta, migração e renderização de leads.
- [x] Kanban com as sete etapas padrão e colunas responsivas, sem depender de corte horizontal.
- [x] Extração com seleção explícita de `Distrito Federal — DF`.
- [x] Extração por bairro, com progresso agregado, total encontrado, bairros concluídos, pendentes e registro expansível pelo ícone de informação.
- [x] Empresas entram no mapa e no feed em tempo real durante a extração; o cartão recebe o selo “Ao vivo” até a gravação final na base.
- [x] Registro de coleta em português, inclusive para contagem, início, nova tentativa, empresa extraída, item ignorado, erro e conclusão.
- [x] Normalização e deduplicação de leads coletados antes de salvar na base.
- [x] Importação CSV/XLSX com prévia, normalização, deduplicação e preservação do valor bruto para auditoria.
- [x] Toast de conclusão por 5 segundos, subindo no canto inferior direito.
- [x] Animação de aproximação do mapa para a referência salva ou localização concedida ao abrir Scraper Maps.
- [x] Configurações com confirmação para limpar a base local de leads, grupos, buscas e histórico; exportações não são apagadas.
- [x] Status, Canais e Comunidades removidos do módulo WhatsApp por solicitação explícita.
- [x] Gráfico da Base limitado a doze agrupamentos legíveis, consolidando o restante em “Outros”.

## Validação concluída nesta rodada

- [x] Build do renderer concluído e 73/73 testes automatizados aprovados.
- [x] QA do Electron isolado: 8 telas, 18 modais e 6 cenários funcionais, sem erro registrado.
- [x] Extração simulada comprovou um lead aparecendo no feed e no mapa antes da conclusão, com logs em português.
- [x] Capturas reais de Base de Leads, Kanban, Scraper e Configurações revisadas; o Kanban de 1024 px não tem overflow global.
- [x] Comparação visual: 22/22 pares, contrato de layout aprovado.
- [x] Smoke do pacote final `dist-release-v1.1.8-nsis`: versão 1.1.8, Base, mapa, Kanban, WhatsApp e paleta de comandos abriram sem erro, sem alterar a instalação atualmente aberta.

## Ainda pendente do plano original

- [ ] Validação manual em monitores/DPI diferentes e da bandeja nativa do Windows.
- [ ] Teste de transporte real do WhatsApp com conta autorizada; a QA continua sem envio real.
- [ ] Teste de OpenCode com credencial/configuração real do usuário, se desejado.
- [ ] Revisar notas, lembretes e fixação de cards do Kanban previstos no plano.
- [x] Instalador final e release GitHub `v1.1.8` publicados com instalador, ZIP portátil, `latest.yml`, blockmap e hashes SHA-256.

## Critério para marcar como concluído

Só passa para concluído após build, testes e inspeção visual do aplicativo empacotado, sem texto corrompido, cortes horizontais ou regressões nas telas alteradas.
