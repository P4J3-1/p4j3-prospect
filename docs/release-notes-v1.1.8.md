# Sigma GMaps Scraper v1.1.8

## Correções incluídas

- Aplicação do planejamento Open Design Desktop: superfícies, tokens, responsividade e estados principais.
- Correção de mojibake/UTF-8 e normalização de textos em leads coletados, migrados e renderizados.
- Kanban com sete etapas responsivas, sem corte horizontal em telas menores.
- Extração com seleção de `Distrito Federal — DF`, bairros, progresso agregado e logs expansíveis em português.
- Leads exibidos no mapa e no feed em tempo real durante a extração, com selo “Ao vivo”.
- Normalização, deduplicação e importação CSV/XLSX com prévia e auditoria do valor bruto.
- Toast animado de conclusão, aproximação do mapa à localização salva/concedida e limpeza confirmada da base local.
- Remoção de Status, Canais e Comunidades do módulo WhatsApp.
- Gráfico da Base consolidado em até doze agrupamentos legíveis.

## Validação

- 73/73 testes automatizados aprovados.
- QA Electron: 8 telas, 18 modais e 6 cenários funcionais sem erros.
- Comparação visual: 22/22 pares aprovados; contrato de layout aprovado.
- Smoke do pacote `v1.1.8`: versão, paleta de comandos, Base de Leads, mapa, Kanban e WhatsApp verificados.

## Observações

Validações manuais de DPI/bandeja nativa, transporte real do WhatsApp, credencial real do OpenCode e notas/lembretes/fixação de cards do Kanban continuam pendentes do plano original.
