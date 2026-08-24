---
title: "BRUXO Architecture & Operabilidade — Perguntas & Respostas"
version: 1.0
lastUpdated: 2026-08-23
---

# BRUXO Architecture & Operabilidade — Perguntas & Respostas

> **Documento Técnico de Referência**  
> **Data:** 2026-08-23  
> **Alvo:** Integração Obruxo ↔ OmniRoute (`omniroute-prod`)

---

## 1. Perguntas Bloqueadoras

### Q1. O identificador canônico e case-sensitive é exatamente `obruxo`?

**Resposta:**  
O roteador mestre aceita tanto `BRUXO` quanto `obruxo`. A comparação é insensível a maiúsculas/minúsculas (`model.trim().toLowerCase()`), de modo que `BRUXO`, `obruxo` e `Bruxo` resolvem rigorosamente a mesma regra.

### Q2. O modelo `obruxo` já está disponível em produção no `GET /v1/models`?

**Resposta:**  
**Sim.** `obruxo` consta como modelo único de entrada no `/v1/models`. Os combos internos (`obruxo-premium`, `obruxo-economic`, `coder-*`, `agentic-*`, `analyser-*`) permanecem ativos no runtime para resolução transparente de rotas, mas ficam omitidos do catálogo público do `/v1/models`.

### Q3. Qual é o JSON completo retornado pelo `/v1/models` para `obruxo`?

**Resposta:**  
Formato retornado pela API OpenAI-compatible do OmniRoute:

```json
{
  "id": "obruxo",
  "object": "model",
  "created": 1787443200,
  "owned_by": "omniroute",
  "context_length": 1000000,
  "max_input_tokens": 872000,
  "max_output_tokens": 128000,
  "input_modalities": ["text", "image"],
  "output_modalities": ["text"],
  "toolCalling": true,
  "vision": true,
  "reasoning": true
}
```

### Q4. Qual protocolo o modelo suporta oficialmente?

**Resposta:**  
Suporta **Chat Completions** (`/v1/chat/completions`) e **Responses API** (`/v1/responses`).  
Para chamadas diretas com SDK ou VS Code, deve-se utilizar o protocolo **Chat Completions**.

### Q5. O `obruxo` pode ser utilizado diretamente pelo Custom Endpoint nativo do VS Code, sem IA-ONE?

**Resposta:**  
**Sim.** Basta configurar no VS Code um custom endpoint apontando para `http://<seu-host>:20130/v1` e definir o modelo como `obruxo` ou `BRUXO`. O OmniRoute responde na especificação padrão OpenAI Chat Completions.

### Q6. Quando uma requisição contém `tools`, o Master Router garante que somente candidatos com tool calling nativo participem?

**Resposta:**  
**Sim.** O Master Router eleva o nível mínimo para `high` ou `xhigh` quando `tools` está presente e o pipeline do OmniRoute filtra o pool, garantindo que alvos sem suporte a ferramentas nativas/emuladas sejam descartados.

### Q7. O OmniRoute garante que chamadas de ferramenta retornem `tool_calls` estruturado, e não texto como `<tool_code>`?

**Resposta:**  
**Sim.** O tradutor de resposta do OmniRoute normaliza as respostas dos provedores nativos/compatíveis para o campo `choices[0].message.tool_calls` no padrão OpenAI.

### Q8. Se um modelo físico devolver pseudo-tool-call textual, o OmniRoute detecta, descarta e tenta outro candidato?

**Resposta:**  
Em provedores que usam emulação de ferramentas (ex: ChatGPT Web), o parser de resposta converte os blocos estruturados em `tool_calls`. Caso ocorra uma falha de validação ou recusa de chamada, o manipulador de erro aciona a lógica de fallback da rota.

### Q9. Estes headers continuam oficialmente suportados?

```http
X-OmniRoute-Execution-Mode
X-OmniRoute-Task-Type
X-OmniRoute-Session-Id
X-Session-Id
```

**Resposta:**  
**Sim.** Todos os headers listados continuam aceitos e processados pela camada SSE/Chat.

### Q10. Quais são os valores válidos de `X-OmniRoute-Execution-Mode`?

**Resposta:**

- `normal` (padrão)
- `subagent`
- `multi-task`
- `background`

### Q11. Quais são os valores válidos de `X-OmniRoute-Task-Type`?

**Resposta:**

- `coding`
- `analysis`
- `review`
- `vision`
- `summarization`
- `background`

### Q12. Sem os headers, como o OmniRoute diferencia exatamente Ask, Plan, Agent, Subagent, Multi-task e Night Shift?

**Resposta:**  
O OmniRoute separa **intenção semântica** de **capacidade de execução**:

- `tools` informa que a rota precisa suportar tool calling; não transforma a tarefa em `agentic` nem impõe `HIGH` sozinho;
- `X-OmniRoute-Execution-Mode: subagent|multi-task` identifica delegação/orquestração e pode levar à categoria `agentic`;
- imagens/anexos → `vision`;
- keywords de código/refatoração (`coding`) → `coder`;
- keywords de análise/planejamento (`analysis`) → `analyser`;
- sem gatilhos especiais → `analyser` (fallback).

### Q13. Como podemos solicitar explicitamente esforço máximo usando somente `model: obruxo`? Existe header ou campo para `mid`, `high`, `xhigh` e `max`?

**Resposta:**  
**Sim.** O OmniRoute suporta override direto via cabeçalho HTTP:

- `X-OmniRoute-Level: mid | high | xhigh | max` (força diretamente a marcha desejada antes do fallback/resolução de combo);
- `X-OmniRoute-Mode: quality` (força o perfil `quality-first` no scoring);
- `X-OmniRoute-Task-Type: coding | analysis | review | vision | summarization | background`.

### Q14. O `billingScore` é aplicado somente depois dos filtros de capacidade, contexto, saúde e qualidade, ou `FREE > PLAN > METERED` pode escolher um modelo inferior em tarefa crítica?

**Resposta:**  
**O `billingScore` entra SOMENTE como fator de desempate interno.**  
A sequência é estrita:

1. Filtro obrigatório de capacidade (tools, visão, janela de contexto);
2. Seleção de categoria e nível de complexidade (`coder-xhigh`, `agentic-high`, etc.);
3. Filtro de saúde (`health`) e quota ativa (`quotaRemaining > 0`);
4. Scoring ponderado (`taskFit` > `billingScore`).

Uma tarefa que exige `agentic-xhigh` jamais será rebaixada para `agentic-mid` só porque este último é `FREE`. O `billingScore` escolhe a opção mais econômica **dentro do nível já exigido**.

---

## 2. Operação e Compatibilidade

### Q1. Quais categorias internas são oficiais? `analyser` é intencional ou o valor canônico será `analysis`?

**Resposta:**  
As quatro categorias internas do Master Router são:

- `coder`
- `agentic`
- `analyser`
- `vision`

`analyser` é o nome interno intencional do combo mestre (ex: `analyser-mid`, `analyser-high`, `analyser-xhigh`). No cabeçalho/telemetria genérica `X-OmniRoute-Task`, a tarefa reportada usa a nomenclatura `analysis`.

### Q2. Subagents fazem requisições independentes usando `model: obruxo`, correto? O OmniRoute apenas roteia cada chamada e não controla os papéis Explorer, Coder, Tester e Reviewer?

**Resposta:**  
**Correto.** O Obruxo/VS Code gerencia a orquestração e os papéis dos subagentes. Cada subagente faz sua chamada HTTP individual enviando `model: "obruxo"`. O OmniRoute analisa e executa a melhor rota para aquela chamada isolada.

### Q3. Em `multi-task`, o controle de lanes, dependências e ordem continua no Obruxo, enquanto o OmniRoute controla apenas concorrência, filas e providers?

**Resposta:**  
**Correto.** A ordenação das tarefas e o fluxo de execução são de responsabilidade do orquestrador cliente (Obruxo). O OmniRoute garante o controle de taxa (RPM/TPM), limites de concorrência (`maxConcurrent`), resiliência e failover de provedores.

### Q4. O Context Handoff depende obrigatoriamente de `X-OmniRoute-Session-Id` ou funciona somente com o histórico em `messages`?

**Resposta:**  
Funciona prioritariamente com o histórico de `messages`. Se o header `X-OmniRoute-Session-Id` ou `X-Session-Id` for fornecido, ele é usado para reforçar a afinidade de sessão (`sessionAffinity`), mas o handoff de contexto injeta o payload diretamente na conversa.

### Q5. Quais response headers são garantidos e estáveis?

**Resposta:**  
Estáveis e garantidos no HTTP Response:

```http
X-OmniRoute-Provider: <nome-do-provedor>
X-OmniRoute-Model: <modelo-físico-real>
X-OmniRoute-Task: <tarefa-detectada>
X-OmniRoute-Latency-Ms: <tempo-em-ms>
```

### Q6. O response informa também categoria detectada, nível calculado, combo interno vencedor, billing tier e tentativa/fallback?

**Resposta:**  
Essas informações são gravadas de forma detalhada nos **logs do servidor** (`tag: BRUXO`, `tag: COMBO`) e no banco de dados de auditoria de chamadas (`request_detail_logs`). Para inspecionar sem executar a chamada, utiliza-se o endpoint de preview (`/api/combos/route-preview` ou `POST /api/combos/preview`).

### Q7. `obruxo-premium` e `obruxo-economic` deixarão de aceitar requisições, continuarão como aliases ou apenas desaparecerão do `/v1/models`?

**Resposta:**  
**Desaparecerão do `/v1/models` como entrada primária e continuarão aceitando requisições como aliases internos de compatibilidade.** Nenhuma integração antiga é quebrada, porém novas configurações devem utilizar unicamente `model: "obruxo"`.

### Q8. Qual é a data ou regra de corte para remover os modelos antigos dos clientes?

**Resposta:**  
Não há data de corte forçada. A política do OmniRoute é manter retrocompatibilidade. A recomendação oficial para novas instalações é configurar o VS Code para usar unicamente `model: "obruxo"`.

### Q9. Exemplos oficiais de request

#### A. Chat / Pergunta simples (Ask)

```json
{
  "model": "obruxo",
  "messages": [{ "role": "user", "content": "O que é uma curva de aprendizado em algoritmos?" }]
}
```

#### B. Coding com Tools (Agent)

```json
{
  "model": "obruxo",
  "messages": [
    { "role": "user", "content": "Corrija a função de validação de CPF no arquivo utils.ts" }
  ],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "read_file",
        "description": "Lê o conteúdo de um arquivo",
        "parameters": { "type": "object", "properties": { "path": { "type": "string" } } }
      }
    }
  ]
}
```

#### C. Subagent

```json
{
  "model": "obruxo",
  "messages": [
    {
      "role": "user",
      "content": "Analise os logs de erro de autenticação e retorne um resumo dos 3 principais problemas."
    }
  ]
}
```

#### D. Multi-task / Análise Complexa (Plan / High Reasoning)

```json
{
  "model": "obruxo",
  "messages": [
    {
      "role": "user",
      "content": "Analise a arquitetura atual, proponha a migração de banco de dados para PostgreSQL e liste todos os riscos de segurança envolvidos."
    }
  ]
}
```

#### E. Visão

```json
{
  "model": "obruxo",
  "messages": [
    {
      "role": "user",
      "content": [
        { "type": "text", "text": "Descreva o erro mostrado nesta captura de tela" },
        { "type": "image_url", "image_url": { "url": "data:image/png;base64,..." } }
      ]
    }
  ]
}
```

### Q10. Existe um endpoint de diagnóstico ou preview que mostre, sem executar a LLM, como uma requisição `model: obruxo` seria classificada e roteada?

**Resposta:**  
**Sim.** O OmniRoute fornece o endpoint de inspecção/preview:

```http
POST /api/combos/preview
Content-Type: application/json

{
  "model": "obruxo",
  "messages": [{ "role": "user", "content": "Escreva uma função TypeScript" }]
}
```

O endpoint retorna a cadeia de modelos (`chain`), janelas de contexto (`contextWindow`), limites de entrada/saída (`maxInput`, `maxOutput`) e a estratégia aplicada, **sem disparar nenhuma chamada para os provedores nem consumir quota**.
