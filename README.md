# Sigma GMaps Scraper

Desktop local-first para transformar pesquisas do Google Maps em uma operação de prospecção: encontrar empresas, organizar leads, priorizar oportunidades e iniciar conversas pelo WhatsApp.

[![Release](https://img.shields.io/github/v/release/olucianobotelho/google-maps-sigma-scrapper?display_name=tag)](https://github.com/olucianobotelho/google-maps-sigma-scrapper/releases)
[![License](https://img.shields.io/github/license/olucianobotelho/google-maps-sigma-scrapper)](LICENSE)

## Fluxo do produto

```text
Google Maps → base de leads → lead scoring → WhatsApp → campanha/Kanban → métricas
```

O app combina scraping, tratamento de dados, análise comercial e execução de campanhas em uma única aplicação Electron para Windows.

## Recursos

### Pesquisa e base de leads

- Pesquisa por nicho, bairro ou cidade no Google Maps, com paginação e coleta dos dados públicos disponíveis.
- Campos de negócio como nome, categoria, telefone, site, Instagram, e-mail, avaliação, endereço e coordenadas.
- Deduplicação por negócio e normalização de categorias; variações como “dentista”, “clínica odontológica” e “ortodontia” são agrupadas em **Odontologia**.
- Extrações de planilhas/CSV/XLSX ficam fora da lista de extrações reais do Maps.
- Visualização em tabela ou mapa Leaflet com camada **Ruas**, pins com coordenadas e indicador de precisão.
- Filtros, seleção em lote e exportação CSV/XLSX.

### Lead Scoring

- Auditoria do site do lead para sinais técnicos e comerciais: HTTPS, responsividade, pixel, WhatsApp, presença digital e qualidade do site.
- Score, prioridade, argumentos de abordagem e mensagem sugerida para WhatsApp.
- Grupos salvos por pesquisa/filtro para trabalhar a lista por etapas.
- Análise opcional com provedores OpenCode/OpenRouter, com fallback local quando não há chave configurada.

### WhatsApp

- Conexão de múltiplos números por QR Code usando Baileys ou Meta Cloud API.
- Conversas, contatos, grupos, etiquetas, mensagens, mídia, áudio e gatilhos.
- Campanhas com mensagem variável, intervalo, agendamento e limite diário por conexão.
- Uma campanha pode ser criada como **rascunho** mesmo sem WhatsApp conectado; a conexão é exigida apenas para iniciar os disparos.

### Campanhas e Kanban

- Campanhas por lista de leads, com relatório de envio, entrega, leitura, respostas e tempo de resposta.
- Kanban individual por campanha com três etapas persistentes:
  - **Novos**
  - **Em conversa**
  - **Finalizados**
- Mova cards por drag-and-drop ou pelo seletor acessível; a etapa continua preservada quando a lista é editada.

![Kanban por campanha](docs/qa/open-design-lote1/whatsapp-campaign-kanban-1440x900.png)

![Criação de campanha offline](docs/qa/open-design-lote1/whatsapp-campaign-offline-draft-1440x900.png)

### Interface e operação

- Shell visual baseado no Open Design do produto, com visão geral, Scraper Maps, Base de Leads, Lead Scoring, WhatsApp, Dashboard e Configurações.
- Dashboard com cobertura da base e distribuição por categoria.
- Atualizações automáticas na versão instalada via GitHub Releases.
- Dados da aplicação e sessões do WhatsApp ficam no perfil local do Electron; chamadas externas acontecem apenas para Maps, sites analisados, WhatsApp e provedores de IA configurados.

## Download para Windows

Baixe a [release mais recente](https://github.com/olucianobotelho/google-maps-sigma-scrapper/releases).

Na release `v1.1.4`, os arquivos são:

- `Sigma-GMaps-Scraper-1.1.4-x64.exe` — instalador NSIS recomendado.
- `Sigma-GMaps-Scraper-1.1.4-x64.zip` — versão portátil.
- `latest.yml` e `.blockmap` — metadados usados pelo atualizador automático.

Após instalar, abra o Sigma e comece por **Nova Extração**. Para campanhas, conecte um número em **WhatsApp → Sessão** ou salve primeiro um rascunho e conecte depois.

> O atualizador automático funciona na versão instalada pelo NSIS. `win-unpacked` é uma saída de teste local e não deve ser usada para validar atualização in-place.

## Desenvolvimento

### Requisitos

- Windows 10/11 64-bit.
- Node.js 20 ou superior.
- Acesso à internet para Maps, sites analisados, downloads e WhatsApp.

### Instalar e executar

```bash
npm install
npm start                 # builda o renderer e abre o Electron
```

Para trabalhar apenas no front-end:

```bash
npm run dev:renderer      # Vite em http://localhost:5173
```

### Comandos úteis

```bash
npm test                  # suíte Node --test
npm run build:renderer    # build do React/Vite
npm run qa:ui             # captura visual das rotas e fluxos principais
npm run build:win         # instalador NSIS + ZIP em dist/
```

O build de produção usa Electron Builder e publica artefatos Windows x64 conforme o campo `build.publish` do `package.json`.

## Estrutura principal

```text
main.js                            Processo Electron e IPC seguro
preload.js                         Ponte entre renderer e processo principal
renderer/                          React + Vite + interface Open Design
lead-scoring/                      Crawler, score, grupos e exportação
campaigns/                         Store, scheduler, analytics e Kanban
whatsapp/                          Providers, autenticação e normalização
scripts/capture-open-design-ui.js  QA visual determinístico
test/                              Testes unitários e de integração local
```

## Contribuir e reportar problemas

- Abra uma [Issue](https://github.com/olucianobotelho/google-maps-sigma-scrapper/issues) com versão, sistema operacional, passos para reproduzir e logs relevantes.
- Pull requests devem manter `npm test` e `npm run qa:ui` verdes.

## Licença

MIT — veja [LICENSE](LICENSE).
