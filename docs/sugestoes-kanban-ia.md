# Kanban com IA: sugestões (não implementadas)

Proposta para transformar o Kanban no painel de decisão da operação, aproveitando o que já existe: status de contato em tempo real, triagem, pesquisa do lead, playbook do Analista e o Agente de Respostas.

## 1. Dashboard no topo do Kanban

| Indicador | Fonte | Por que importa |
|---|---|---|
| Valor em aberto por etapa (R$) | cards + valor do negócio | mostra onde está o dinheiro parado |
| Tempo médio em cada etapa | data de entrada na coluna | revela o gargalo (ex.: leads parados em "Respondeu") |
| Taxa de avanço entre etapas | histórico de movimentos | mede a qualidade da abordagem por etapa |
| Leads "esfriando" | último evento do WhatsApp há mais de 3 dias | lista de quem precisa de ação hoje |
| Previsão do mês | valor × chance de fechar (pesquisa/triagem) | meta realista, não otimista |

## 2. IA sugerindo a próxima ação em cada card

- Um selo "Próxima ação" em cada card, gerado pelo Agente de Respostas a partir da conversa: *ligar*, *mandar proposta*, *reengajar*, *encerrar*.
- Botão **"Resolver com IA"**: abre a conversa com a resposta sugerida já no campo (o vendedor revisa e envia).
- Card com resposta nova do WhatsApp sobe para o topo da coluna e ganha destaque.

## 3. Movimentação automática (com confirmação)

- Resposta recebida → sugerir mover para **"Em conversa"** (um clique para aceitar).
- Lead pediu para sair → mover para **"Perdido"** com motivo "descadastro".
- Palavras de compra na conversa ("quanto custa", "pode mandar proposta") → sugerir **"Proposta"**.
- Nada muda sozinho sem o vendedor aceitar: evita card no lugar errado.

## 4. Resoluções guiadas por objeção

- Quando a conversa trava numa objeção (preço, tempo, "já tenho"), o card mostra a resposta recomendada da triagem e do playbook.
- O Analista registra quais respostas destravaram negócios e passa a priorizá-las (auto-aperfeiçoamento aplicado ao funil).

## 5. Revisão semanal automática

- Toda segunda, o Analista gera um resumo do Kanban: negócios ganhos/perdidos, principal motivo de perda, nicho com melhor conversão e **3 ações para a semana**.
- Exibido como um cartão fixo no topo do Kanban, com botão para arquivar.

## 6. Priorização da coluna

- Ordenar cards por **valor × chance de fechar ÷ dias parado**: o que vale mais e está esfriando aparece primeiro.

## Ordem sugerida de implementação

1. Dashboard (dados já existem, sem custo de IA).
2. Selo de próxima ação + "Resolver com IA" (reaproveita o Agente de Respostas).
3. Movimentação sugerida com um clique.
4. Revisão semanal do Analista.
