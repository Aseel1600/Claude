---
title: "Obruxo — matriz de modelos por tipo e nível"
status: proposed
updated: 2026-08-24
---

# Obruxo: matriz de modelos por tipo e nível

Esta é a política alvo para o roteador `OBRUXO`. Ela documenta a intenção de
delegação; não habilita combos nem altera a seleção de modelos sozinha.

`tools` aparece na matriz como uma visão de capacidade/compatibilidade, mas não
é uma categoria semântica primária: enviar `tools` não força `agentic` nem
promove automaticamente para `HIGH`. A categoria continua sendo determinada
por `coder`, `analyser`, `reviewer` ou `agentic` quando houver delegação real.

## Níveis

| Nível   | Uso esperado                                                                  | Regra de promoção                                                         |
| ------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `MID`   | Tarefa curta, reversível e de baixo risco                                     | Ponto de entrada econômico para tarefas rotineiras.                       |
| `HIGH`  | Implementação, análise ou revisão com várias etapas                           | Usar quando há testes, contexto adicional ou risco moderado.              |
| `XHIGH` | Arquitetura, debugging difícil, revisão ampla ou contexto grande              | Requer maior consistência e capacidade de manter contexto.                |
| `MAX`   | Segurança, migração irreversível, decisão crítica ou investigação excepcional | Reservado para casos em que uma falha custa mais que o consumo adicional. |

`MAX` é um nível real do contrato do roteador e agora será reservado para a
cadeia Opus. O `GPT-5.5 xhigh` não participa da matriz do Obruxo. O fallback
interno de `MAX` é ordenado: `cc/claude-opus-5` → `claude/claude-opus-4-8`.

Para uma seleção explícita, o alias `BRUXO-MAX` força qualquer categoria
semântica (`coder`, `analyser`, `reviewer`, `agentic` ou `tools`) para o combo
`MAX` correspondente. O alias não altera o comportamento automático do
`BRUXO`.

## Matriz proposta

Valores são médias simples de input/output por 1 milhão de tokens, usando a
tabela local de custos do OmniRoute. `DeepSeek*` representa custo efetivo zero
na conexão atualmente disponível; o preço de lista local aproximado é
`$0,20/M` nessa mesma média.

| Nível   | Codex       | Claude               | KimiCode       | Gemini                | DeepSeek  | Média de referência |
| ------- | ----------- | -------------------- | -------------- | --------------------- | --------- | ------------------: |
| `MID`   | Luna Medium | Haiku 4.5            | —              | Gemini 3.1 Flash-Lite | V4 Flash* |     `$0,20–$2,60/M` |
| `HIGH`  | Luna High   | Haiku 4.5 / Sonnet 5 | K2.7 Code      | Gemini 3.6 Flash High | V4 Pro*   |     `$0,60–$5,20/M` |
| `XHIGH` | Luna XHigh  | Sonnet 5             | K2.7 Highspeed | Gemini 3.6 Flash High | V4 Pro*   |     `$0,60–$5,20/M` |
| `MAX`   | —           | Opus 5 → Opus 4.8    | —              | —                     | —         |          `$13,00/M` |

### Referência de custo local

| Família                           | Input / output por 1M | Média simples |
| --------------------------------- | --------------------: | ------------: |
| Codex Luna                        |       `$0,20 / $1,20` |       `$0,60` |
| Claude Haiku 4.5                  |       `$1,00 / $5,00` |       `$2,60` |
| Claude Sonnet 5                   |      `$2,00 / $10,00` |       `$6,00` |
| Claude Opus 5                     |      `$5,00 / $25,00` |      `$15,00` |
| Kimi K2.7 Code                    |       `$0,95 / $4,00` |       `$2,17` |
| Kimi K2.7 Code Highspeed          |       `$1,90 / $8,00` |       `$4,34` |
| Gemini 3.1 Flash-Lite             |       `$0,25 / $1,50` |       `$0,75` |
| Gemini 3.6 Flash                  |       `$0,75 / $3,75` |       `$1,95` |
| DeepSeek V4 Flash, preço de lista |       `$0,14 / $0,28` |       `$0,20` |

Os valores acima são referência para decisão. O custo efetivo depende da
conexão, assinatura, quota e `billing_mode`; em especial, uma conexão gratuita
ou incluída em plano deve vencer uma opção paga somente quando permanecer dentro
do mesmo tipo, nível e requisitos de capacidade.

## Política de uso

- **DeepSeek V4 Flash**: candidato principal para `MID`, tarefas mecânicas e
  tools simples; o custo efetivo é zero quando a conexão gratuita estiver
  disponível.
- **Kimi K2.7 Code**: opção para `HIGH` quando a tarefa é bem delimitada e
  exige mais qualidade de código que o `MID` econômico.
- **Kimi K2.7 Code Highspeed**: opção para `XHIGH` quando baixa latência for
  importante; o custo adicional precisa ser justificado pela tarefa.
- **Codex Luna**: `Luna Medium` cobre o trabalho comum, `Luna High` cobre
  implementação moderada e `Luna XHigh` cobre tarefas difíceis sem o custo do
  GPT-5.5.
- **Claude**: Haiku 4.5 para `MID/HIGH`, Sonnet 5 para `HIGH/XHIGH` e Opus 5
  exclusivamente em `MAX`, com Opus 4.8 como fallback.
- **Gemini Flash**: Gemini 3.1 Flash-Lite para `MID` e Gemini 3.6 Flash High
  para `HIGH/XHIGH`, conforme a decisão atual de custo e capacidade.

## Como medir antes de ajustar

Depois de implantar a migration `135_routing_observations.sql` e reiniciar o
serviço, gerar o relatório com:

```bash
node scripts/sre/routing-observability-report.mjs --hours 6
```

O relatório deve ser lido por `task_type/category/difficulty`, `resolved_combo`
e `selected_provider/model`. Para comparar níveis, observar ao menos:

- volume e participação de cada tipo/nível;
- média de input, output e reasoning tokens por requisição;
- custo médio por requisição e custo total;
- taxa de sucesso, latência e fallback;
- modelo efetivamente escolhido dentro do combo.

Não alterar pisos ou trocar modelos com base em poucas requisições. Primeiro
coletar uma janela de algumas horas e, idealmente, comparar períodos equivalentes
por tipo de tarefa.
