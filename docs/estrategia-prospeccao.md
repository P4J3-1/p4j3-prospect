# Estratégia de prospecção P4J3

Objetivo: gerar **conversas** com empresas locais pelo WhatsApp sem queimar números. Venda acontece na conversa, não no primeiro disparo.

## 1. Lista: menos e melhor

1. **Extraia por nicho + bairro**, não por cidade inteira. O Google Maps devolve no máximo ~120 resultados por busca; bairro a bairro você cobre a cidade sem repetir.
2. **Rode o Lead Scoring antes de disparar.** Priorize `prioridade alta`: empresa com telefone, avaliações e sinais claros de problema (sem site, site sem HTTPS, sem WhatsApp no site, poucas avaliações).
3. **Monte grupos por dor, não por nicho.** "Dentistas sem site" e "Dentistas com site lento" recebem mensagens diferentes.

## 2. Mensagem: pedir permissão, não vender

O padrão do app já segue esta estrutura:

```
{Oi|Olá}, tudo bem? Vi a {{name}} no Google Maps e {tive|pensei em} uma ideia {rápida|simples}
para trazer mais clientes pelo WhatsApp. Posso te mandar em 2 linhas?
```

Por que funciona:

- **Curta e termina em pergunta.** Pergunta fácil gera resposta; resposta aquece o número.
- **Sem link no 1º toque.** Link de desconhecido é o maior gatilho de denúncia.
- **Contexto real** ("vi no Google Maps"): explica por que você está chamando.
- **Spintax `{a|b}`**: cada lead recebe uma combinação diferente. Mensagens idênticas em massa são o principal gatilho de bloqueio.

Com Lead Scoring + IA (DeepSeek, OpenRouter...), use `{{mensagem_whatsapp_ia}}` ou `{{dor_principal}}` para personalizar por lead.

## 3. Follow-up: o segundo toque

- **Um** follow-up automático após **48 h**, só para quem não respondeu, pelo **mesmo número**.
- Para sozinho quando o lead responde.
- Leva a saída explícita: *"se não fizer sentido, responda SAIR"*. Isso reduz denúncias e atende a LGPD.
- Em prospecção fria, boa parte das respostas vem do segundo toque. Acompanhe em **Campanhas → relatório**: "respostas que vieram depois do follow-up".

## 4. Descadastro automático

Quem responde **SAIR, PARAR, "não tenho interesse", "me tira da lista"** entra numa lista global e **nunca mais** recebe disparo de nenhuma campanha. O lead aparece como *pulado* nas campanhas seguintes.

## 5. Proteção do número

| Fase do número | Envios por dia | Intervalo |
|---|---|---|
| Novo (1ª semana) | 10–30 | 90–180 s |
| Aquecido (2–4 semanas, com respostas) | 60 | 60–120 s |
| Maduro | até 100 | 45–90 s |

- Suba de faixa só se a **taxa de resposta ficar acima de ~10%** e não houver bloqueios.
- Dispare em **horário comercial** (padrão 07h–18h). Terça a quinta, das 9h às 11h e das 14h às 16h, costuma ter a melhor leitura.
- Use **vários números** na mesma campanha: o app divide a lista e respeita o limite de cada um.
- O intervalo já tem variação aleatória de até +40% por envio.

## 6. Rotina semanal

1. **Segunda:** extração + Lead Scoring de 2–3 nichos.
2. **Terça a quinta:** campanhas de 30–60 leads por número, com follow-up ligado.
3. **Todo dia:** responder conversas em até 1 h. Velocidade de resposta pesa mais que o texto.
4. **Sexta:** ver no relatório a taxa de resposta por mensagem e horário; manter a melhor e testar **uma** variação nova.

## 7. Métricas que importam

- **Taxa de resposta** (meta: 10–20% em lista qualificada).
- **Respostas após o follow-up** (mostra se o segundo toque compensa).
- **Descadastros** (acima de 5% indica mensagem ou lista ruim).
- **Conversas → reuniões/vendas** no Kanban.
