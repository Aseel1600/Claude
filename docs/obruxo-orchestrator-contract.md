# Contrato do Orquestrador Obruxo ↔ OmniRoute

> **Versão:** 2.0 (Simplificado + Benchmark Validador)
> **Data:** 2026-08-22
> **Fonte:** Validado contra ambiente de produção (`omniroute-prod`, `/app/data/storage.sqlite`)
> **Status:** ✅ Task-Aware Smart Router (PT-BR) + Auto-Scoring (13 fatores) + Context Handoff + Telemetria Nerd

---

## 1. Visão Geral da Arquitetura

O **Obruxo** (orquestrador local) delega toda a inteligência de seleção de modelo, failover, roteamento por tarefa e controle de contexto para o **OmniRoute** (gateway de modelos).

```
┌─────────────────┐       model: "obruxo"       ┌─────────────────┐
│     Obruxo      │ ──────────────────────────► │    OmniRoute    │
│  (Orquestrador) │    HTTP POST /v1/chat/...   │    (Gateway)    │
└─────────────────┘                             └────────┬────────┘
                                                         │
                        ┌────────────────────────────────┴────────────────────────────────┐
                        │ 1. Task-Aware Detection (Coding, Analysis, Vision, Summary)    │
                        │ 2. Context Window Pre-Filter (Exclui candidatos insuficientes) │
                        │ 3. Auto-Scoring 13 Fatores (Health, Quota, Latência, Custo...) │
                        │ 4. Universal Context Handoff (Preserva memória entre IAs)      │
                        └────────────────────────────────┬────────────────────────────────┘
                                                         │
                                                         ▼
                                          ┌─────────────────────────────┐
                                          │     Modelo Selecionado      │
                                          │  (GPT-5.6 Terra, Gemini,    │
                                          │   Kimi Highspeed, etc)      │
                                          └─────────────────────────────┘
```

**Princípio Fundamental:**

> O Obruxo envia requisições usando unicamente o modelo `obruxo`.
> Toda variação por agente (Ask, Plan, Agent, Multi-task, Sub-agent) ou função (coding, análise, visão, revisão, resumo) é 100% automatizada pelo OmniRoute.

---

## 2. Endpoint & Autenticação

| Campo            | Valor                                                                            |
| ---------------- | -------------------------------------------------------------------------------- |
| **Base URL**     | `http://localhost:20130` (Dashboard/API) ou `http://localhost:20131` (API Split) |
| **Endpoint**     | `POST /v1/chat/completions`                                                      |
| **Auth**         | `Authorization: Bearer <API_KEY>`                                                |
| **Content-Type** | `application/json`                                                               |
| **Protocolo**    | OpenAI Chat Completions (Compatível)                                             |

---

## 3. Modelo Único (`model`)

| Modelo        | Identificador (`body.model`) | Estratégia                   | Objetivo                                                                                                                                                                                                              |
| ------------- | ---------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🤖 **Obruxo** | `obruxo`                     | `bruxoMasterRouter` + `auto` | Modelo único de entrada. O OmniRoute classifica automaticamente o tipo de tarefa, a complexidade e a presença de tools para direcionar a requisição ao combo e modelo ideal (com prioridade `FREE > PLAN > METERED`). |

_Nota: Todas as variações (Ask, Plan, Agent, Multi-task e Sub-agents) utilizam exclusivamente o modelo `obruxo`. Os combos internos e modelos reais permanecem ocultos para o cliente._

---

## 4. Matriz de Especialistas por Tarefa (Validação por Benchmark Real)

O OmniRoute classifica a intenção da mensagem do usuário e direciona para o pool de especialistas ideal:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 🖥️  CODING:     codex/gpt-5.6-terra (2.4s) → kmc/kimi-for-coding-highspeed   │
│                (3.5s) → gemini-2.5-flash (2.5s)                             │
│                                                                             │
│ 🧠 ANALYSIS:   codex/gpt-5.6-terra (2.4s) → kmc/kimi-for-coding-highspeed   │
│                (3.5s) → deepseek-v4-pro (14.8s - fallback)                  │
│                                                                             │
│ 🔍 REVIEW:     codex/gpt-5.6-terra (2.4s) → deepseek-v4-pro (14.8s)        │
│                → kmc/kimi-for-coding-highspeed (3.5s)                       │
│                                                                             │
│ 👁️  VISION:     gemini-2.5-flash (1.09s) → codex/gpt-5.6-terra (3.4s)        │
│                → KIMI [1M] (4.4s)                                           │
│                                                                             │
│ 📝 SUMMARY:    gemini-2.5-flash (1.1s) → codex/gpt-5.6-terra (1.6s)         │
│                → kmc/kimi-for-coding-highspeed (3.0s)                       │
│                                                                             │
│ 🔧 BACKGROUND: gemini-2.5-flash (1.1s) → gpt-4o-mini (1.7s)                  │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Dicionário de Detecção PT-BR (Task-Aware Smart Router)

Gatilhos em Português configurados em `taskRouting.customPatterns`:

| Tarefa            | Patterns PT-BR                                                                                                                              | Patterns Universais                    | Rota Intent       |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | ----------------- |
| **Coding**        | `"escrever código"`, `"escreva código"`, `"depurar"`, `"debugar"`, `"corrigir"`, `"refatorar"`, `"teste unitário"`, `"revisão de código"`   | ` ` ```, `function `, `class `, `def ` | `auto/coding`     |
| **Analysis**      | `"analisar"`, `"análise"`, `"comparar"`, `"avaliar"`, `"explicar"`, `"prós e contras"`, `"implicações"`, `"arquitetura"`                    | `SELECT`, `INSERT`, `compare`          | `auto/reasoning`  |
| **Vision**        | `"olhe para esta imagem"`, `"nesta imagem"`, `"o que você vê"`, `"descreva esta imagem"`, `"analise esta imagem"`, `"leia este screenshot"` | `image_url`, `data:image`              | `auto/vision`     |
| **Summarization** | `"resumir"`, `"resumo"`, `"tldr"`, `"resumo breve"`, `"pontos principais"`, `"destaques"`                                                   | `summary`, `tldr`                      | `auto/chat:fast`  |
| **Background**    | `"gerar título"`, `"criar título"`, `"nomeie isto"`, `"descrição curta"`, `"resumo de uma linha"`                                           | `title`, `name this`                   | `auto/chat:cheap` |

---

## 6. Comunicação entre Agentes (Context Handoff)

Quando o OmniRoute alterna de um modelo para outro (ex: do Arquiteto `gpt-5.6-terra` para o Coder `kimi-coding-highspeed`), ele injeta automaticamente o **Handoff Payload** no topo da conversa:

```json
{
  "summary": "Síntese densa do que foi discutido e decidido até o momento (max 200 palavras).",
  "keyDecisions": ["Decisão 1", "Decisão 2"],
  "taskProgress": "Estado atual da tarefa: concluído, pendente e próximos passos.",
  "activeEntities": ["src/lib/db/providers.ts", "schema.ts", "feature X"]
}
```

Isso garante que a troca de modelos aconteça **sem perda de contexto** e **sem desperdício de tokens**.

---

## 7. Detecção do Tipo de Requisição: ASK, PLAN ou AGENT?

Quando uma requisição chega ao OmniRoute, o gateway analisa a **estrutura do JSON** para determinar a natureza da chamada:

```
                          REQ HTTP CHEGA AO OMNIROUTE
                                     │
                 ┌───────────────────┼───────────────────┐
                 ▼                   ▼                   ▼
            [Tem `tools`?]    [Solicita Plano?]    [Pergunta Simples?]
                 │                   │                   │
                 ▼                   ▼                   ▼
           Modo: AGENT          Modo: PLAN          Modo: ASK
         (Tool Calling)      (High Reasoning)     (Fast / Standard)
```

### 📋 Tabela de Identificação de Requisições

| Tipo         | Como o OmniRoute Detecta                                                       | Modelo / Intent Roteado                                        | Exemplo de Uso                                             |
| ------------ | ------------------------------------------------------------------------------ | -------------------------------------------------------------- | ---------------------------------------------------------- |
| 💬 **ASK**   | Sem `tools`, texto direto, pergunta sem keywords pesadas                       | `auto/chat:fast` ou modelo solicitado                          | _"O que faz esta função?"_, _"Como funciona o Docker?"_    |
| 📐 **PLAN**  | Keywords `"plano"`, `"arquitetura"`, `"passo a passo"`, `"desenhar"` no prompt | `auto/reasoning` (`codex/gpt-5.6-terra`)                       | _"Crie um plano para refatorar o auth de JWT para OAuth2"_ |
| 🤖 **AGENT** | Contém array `tools: [...]` (chamada de ferramentas, busca, terminal, edição)  | `auto/coding` (com validação estrita de `supportsTools: true`) | _"Refatore o arquivo `router.ts` e execute os testes"_     |

---

## 8. Sub-Agents vs Multi-Agents vs Multi-Task

### 🔹 Sub-Agents (`runSubagent`)

- **O que são**: Agentes filhos autônomos disparados por um agente pai para resolver uma tarefa focada (ex: buscar um erro nos logs, testar um endpoint, ler uma doc).
- **Como funcionam no contrato**: Cada sub-agente faz uma chamada isolada para `POST /v1/chat/completions` com o modelo `obruxo` ou `obruxo-economic`. O sub-agente recebe o **Handoff** da tarefa e retorna 1 relatório ao agente pai.

### 🔹 Multi-Agents (`/mult` / Obruxo Cycle)

- **O que é**: Um fluxo sequencial de papéis encadeados para garantir qualidade sem alucinação:
  1. **Explorer**: Mapeia arquivos e contexto (Leitura/RAG) → Modelo: `gemini-2.5-flash`
  2. **Coder**: Escreve o código da solução → Modelo: `kmc/kimi-for-coding-highspeed`
  3. **Tester**: Executa testes reais ou linter no terminal
  4. **Reviewer**: Audita o diff gerado para bugs/segurança → Modelo: `codex/gpt-5.6-terra`

### 🔹 Multi-Task (Execução Concorrente)

- **O que é**: Execução paralela de múltiplos sub-agentes ou chamadas simultâneas de ferramentas.
- **Como o OmniRoute lida**: O OmniRoute possui controle de concorrência (`maxConcurrent`) por conexão e balanceia as requisições paralelas entre diferentes providers sem travar o servidor.

---

## 9. Rodapé Nerd & Transparência de Telemetria (Nerd Stats)

O OmniRoute suporta a injeção automática de um **Rodapé Nerd** ao final da resposta do assistente (em texto ou streaming) e o envio de **cabeçalhos HTTP de telemetria**, fornecendo total transparência sobre qual modelo e provedor realmente processaram o pedido:

```markdown
---

📊 **OmniRoute Nerd Stats**:
• 🏢 **Provider**: `Codex` (`openai-compatible-responses`)
• 🧠 **Model**: `gpt-5.3-codex-spark`
• 🎯 **Task Detectada**: `Coding` (Task-Aware Router)
• ⚡ **Latência**: `2.45s`
• 🪙 **Tokens**: `18 in` | `283 out` | `301 total`
• 💰 **Tier**: `Premium`
```

### Cabeçalhos HTTP de Telemetria (`Response Headers`)

A cada requisição concluída, o OmniRoute devolve os seguintes cabeçalhos no HTTP Response:

| Header HTTP              | Exemplo               | Descrição                                |
| ------------------------ | --------------------- | ---------------------------------------- |
| `X-OmniRoute-Provider`   | `Codex`               | Provider real que processou a requisição |
| `X-OmniRoute-Model`      | `gpt-5.3-codex-spark` | Modelo real selecionado pelo router      |
| `X-OmniRoute-Task`       | `coding`              | Tarefa detectada pelo Task-Aware Router  |
| `X-OmniRoute-Latency-Ms` | `2450`                | Tempo total de execução em milissegundos |

### Ativação no Settings (`settings.json` / Database)

```json
{
  "appendNerdStats": true
}
```

---

## 10. Regras de Resiliência & Failover

1. **Gestão de Cota do Spark**: `cx/gpt-5.3-codex-spark` não é colocado na linha de frente primária para evitar esgotamento precoce de cota.
2. **Latência do DeepSeek**: O DeepSeek v4 permanece como fallback secundário/terciário devido à instabilidade ocasional da API oficial (>14s).
3. **Proteção contra Context Overflow**: Se um prompt exceder a janela do modelo selecionado (ex: 262k do Kimi Code), o OmniRoute remove o modelo pequeno do pool e redireciona automaticamente para modelos com janela de 1M (`codex/gpt-5.6-terra`, `KIMI [1M]`).

---

## 11. Manutenção do Modelo e Combos Internos

O modelo de entrada exposto ao cliente é unicamente:

- ✅ `obruxo` (Modelo Único com Master Routing Automático)

Os combos internos (`coder-*`, `agentic-*`, `analyser-*`, `obruxo-premium`, etc.) permanecem ativos no banco de dados e no runtime do OmniRoute para resolução transparente de rotas, mas ficam ocultos na interface e na documentação do contrato de integração.
