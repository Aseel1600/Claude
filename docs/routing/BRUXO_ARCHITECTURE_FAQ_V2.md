---
title: "BRUXO Architecture & Operabilidade — FAQ v2.0"
version: 2.0
lastUpdated: 2026-08-23
---

# BRUXO Architecture & Operabilidade — FAQ v2.0

> **Documento Técnico de Referência**  
> **Versão:** 2.0 (Alinhado com Master Router, Billing Classification e Modelo Único)  
> **Data:** 2026-08-22  
> **Alvo:** Integração Obruxo ↔ OmniRoute (`omniroute-prod`)

---

## 1. Perguntas Bloqueadoras

### Q1. O identificador canônico e case-sensitive é exatamente `obruxo`?

**Resposta:**  
O roteador mestre aceita tanto `BRUXO` quanto `obruxo`. A comparação no servidor é feita com normalização minúscula (`model.trim().toLowerCase()`), portanto `BRUXO`, `obruxo`, `Bruxo` e `OBRUXO` resolvem exatamente a mesma regra.

### Q2. O modelo `obruxo` é o único modelo de entrada exposto no `/v1/models`?

**Resposta:**  
**Sim.** `obruxo` é o modelo único de entrada no `/v1/models`. Os combos internos especializados (`coder-*`, `agentic-*`, `analyser-*`) e os aliases antigos (`obruxo-premium`, `obruxo-economic`) permanecem ativos no runtime para resolução transparente de rotas e compatibilidade, mas ficam omitidos do catálogo público de modelos.

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

_Nota de limites_: `max_input_tokens (872.000) + max_output_tokens (128.000) = context_length (1.000.000)`.

### Q4. Qual protocolo o modelo suporta oficialmente?

**Resposta:**  
Suporta **Chat Completions** (`/v1/chat/completions`) e **Responses API** (`/v1/responses`).  
Para chamadas diretas via SDK ou Custom Endpoint do VS Code, deve-se utilizar o protocolo padrão OpenAI Chat Completions.

### Q5. O `obruxo` pode ser utilizado diretamente pelo Custom Endpoint nativo do VS Code, sem IA-ONE?

**Resposta:**  
**Sim.** Basta configurar no VS Code um custom endpoint apontando para `http://<seu-host>:20130/v1` e definir o modelo como `obruxo` ou `BRUXO`. O OmniRoute responde na especificação OpenAI Chat Completions.

### Q6. Quando uma requisição contém `tools`, o Master Router garante que somente candidatos com tool calling nativo participem?

**Resposta:**  
**Sim.** `tools` é tratado como requisito de capacidade e o pipeline descarta alvos sem suporte a ferramentas. A presença de `tools` não muda sozinha a categoria semântica nem promove o nível: uma leitura simples pode continuar em `analyser-mid`, enquanto código, revisão ou delegação seguem seus próprios tipos e níveis.

### Q7. O OmniRoute garante que chamadas de ferramenta retornem `tool_calls` estruturado, e não texto como `<tool_code>`?

**Resposta:**  
**Sim.** O tradutor de resposta do OmniRoute normaliza as respostas dos provedores para o campo `choices[0].message.tool_calls` no padrão OpenAI.

### Q8. Se um modelo físico devolver pseudo-tool-call textual sem JSON válido, o OmniRoute detecta, descarta e tenta outro candidato?

**Resposta:**  
Em provedores que usam emulação de ferramentas (ex: ChatGPT Web), o parser converte blocos estruturados. Caso o modelo devolva texto puro com marcações sintáticas como `<tool_code>` sem um JSON válido, a camada de parsing rejeita o formato, marca a tentativa como falha e aciona o fallback do combo para o **próximo candidato elegível**.

### Q9. Estes headers continuam oficialmente suportados?

```http
X-OmniRoute-Execution-Mode
X-OmniRoute-Task-Type
X-OmniRoute-Session-Id
X-Session-Id
```

**Resposta:**  
**Sim.** Todos os headers listados são aceitos e processados pela camada SSE/Chat.

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

### Q12. Como o OmniRoute diferencia a categoria da tarefa vs o modo operacional sem depender de inferência visual?

**Resposta:**

- **Categoria de Tarefa (`coder`, `agentic`, `analyser`, `vision`)**: É inferida pelas palavras-chave/intenção do prompt, anexos e modo de delegação. `tools` é uma capacidade transversal, não uma categoria primária.
- **Modo Operacional (`normal`, `subagent`, `multi-task`, `background`)**: É declarado pelo Obruxo através do cabeçalho `X-OmniRoute-Execution-Mode`.

### Q13. Como solicitar explicitamente esforço máximo usando somente `model: obruxo`? Existe header para marcha explícita?

**Resposta:**  
**Sim.** O OmniRoute suporta overrides diretos via cabeçalho HTTP:

- `X-OmniRoute-Level: mid | high | xhigh | max` (força a marcha de esforço desejada antes do fallback/resolução de combo);
- `X-OmniRoute-Mode: quality` (força o perfil de pesos `quality-first` no scoring);
- `X-OmniRoute-Task-Type: coding | analysis | review | vision | summarization | background`.

### Q14. O `billingScore` é aplicado somente depois dos filtros de capacidade, contexto, saúde e qualidade, ou `FREE > PLAN > METERED` pode escolher um modelo inferior em tarefa crítica?

**Resposta:**  
**O `billingScore` entra SOMENTE como fator de desempate interno.**  
A sequência de decisão é estrita:

1. Filtro obrigatório de capacidade (suporte a tools, visão, janela de contexto);
2. Seleção de categoria e nível de complexidade (`coder-xhigh`, `agentic-high`, etc.);
3. Filtro de saúde (`circuit breaker CLOSED`) e quota ativa (`quotaRemaining > 0`);
4. Scoring ponderado (`taskFit` com peso maior que `billingScore`).

Uma tarefa que exige `agentic-xhigh` nunca é rebaixada para `agentic-mid` apenas por este ser `FREE`. O `billingScore` seleciona a alternativa de menor custo marginal **dentro do nível exigido pela tarefa**.

---

## 2. Operação e Compatibilidade

### Q1. Quais categorias internas são oficiais? `analyser` é intencional ou o valor canônico é `analysis`?

**Resposta:**  
As quatro categorias internas oficiais do Master Router são:

- `coder`
- `agentic`
- `analyser`
- `vision`

`analyser` é o nome interno intencional do combo mestre (ex: `analyser-mid`, `analyser-high`, `analyser-xhigh`). No cabeçalho/telemetria genérica `X-OmniRoute-Task`, a tarefa reportada usa a nomenclatura `analysis`.

### Q2. Subagents fazem requisições independentes usando `model: obruxo`, correto? O OmniRoute apenas roteia cada chamada e não controla os papéis Explorer, Coder, Tester e Reviewer?

**Resposta:**  
**Correto.** O Obruxo gerencia a orquestração e os papéis dos subagentes. Cada subagente dispara sua própria requisição HTTP enviando `model: "obruxo"` e o header `X-OmniRoute-Execution-Mode: subagent`. O OmniRoute apenas roteia e executa a chamada isoladamente.

### Q3. Em `multi-task`, o controle de dependências e ordem continua no Obruxo, enquanto o OmniRoute controla concorrência, filas e providers?

**Resposta:**  
**Correto.** A ordem de execução e encadeamento são de responsabilidade do Obruxo. O OmniRoute controla taxa (RPM/TPM), limites de concorrência (`maxConcurrent`), resiliência e balanceamento entre contas/provedores.

### Q4. O Context Handoff depende obrigatoriamente de `X-OmniRoute-Session-Id` ou funciona somente com o histórico em `messages`?

**Resposta:**  
Funciona com o histórico de `messages`. Quando o header `X-OmniRoute-Session-Id` é enviado, ele é utilizado para manter afinidade de sessão (`sessionAffinity`) no mesmo provedor/conta, enquanto o payload de handoff é injetado no topo da conversa.

### Q5. Quais response headers são garantidos e estáveis?

**Resposta:**  
Estáveis e garantidos no HTTP Response:

```http
X-OmniRoute-Provider: <nome-do-provedor>
X-OmniRoute-Model: <modelo-físico-real>
X-OmniRoute-Task: <tarefa-detectada>
X-OmniRoute-Latency-Ms: <tempo-em-ms>
```

### Q6. O response informa também categoria detectada, nível calculado, combo interno vencedor e fallback?

**Resposta:**  
Sim. Essas informações são gravadas de forma estruturada nos **logs do servidor** (`tag: BRUXO`) e na tabela de auditoria (`request_detail_logs`). Para inspecionar uma requisição sem disparar a LLM, utiliza-se o endpoint de preview (`POST /api/combos/preview`).

### Q7. `obruxo-premium` e `obruxo-economic` deixarão de aceitar requisições ou continuarão como aliases?

**Resposta:**  
**Continuarão funcionando como aliases internos de compatibilidade**, mas serão omitidos da listagem do `/v1/models`. Nenhuma integração legada será quebrada.

### Q8. Qual é a regra para novos clientes?

**Resposta:**  
Novas configurações e extensões devem utilizar unicamente `model: "obruxo"`.

### Q9. Exemplos oficiais de requisição

#### A. Chat / Pergunta simples (Ask)

```http
POST /v1/chat/completions
Content-Type: application/json
Authorization: Bearer <API_KEY>

{
  "model": "obruxo",
  "messages": [
    { "role": "user", "content": "O que é uma curva de aprendizado em algoritmos?" }
  ]
}
```

#### B. Coding com Tools (Agent)

```http
POST /v1/chat/completions
Content-Type: application/json
Authorization: Bearer <API_KEY>

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

```http
POST /v1/chat/completions
Content-Type: application/json
Authorization: Bearer <API_KEY>
X-OmniRoute-Execution-Mode: subagent
X-OmniRoute-Session-Id: ses_abc123

{
  "model": "obruxo",
  "messages": [
    { "role": "user", "content": "Analise os logs de erro de autenticação e retorne um resumo dos 3 principais problemas." }
  ]
}
```

#### D. Multi-task

```http
POST /v1/chat/completions
Content-Type: application/json
Authorization: Bearer <API_KEY>
X-OmniRoute-Execution-Mode: multi-task
X-OmniRoute-Session-Id: ses_abc123

{
  "model": "obruxo",
  "messages": [
    { "role": "user", "content": "Audite o arquivo de permissões buscando potenciais brechas de segurança." }
  ]
}
```

#### E. Análise Complexa com Marcha Explícita (Plan / Max Level)

```http
POST /v1/chat/completions
Content-Type: application/json
Authorization: Bearer <API_KEY>
X-OmniRoute-Level: max

{
  "model": "obruxo",
  "messages": [
    { "role": "user", "content": "Analise a arquitetura atual, proponha a migração do banco para PostgreSQL e liste os riscos envolvidos." }
  ]
}
```

#### F. Visão

```http
POST /v1/chat/completions
Content-Type: application/json
Authorization: Bearer <API_KEY>

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

### Q10. Existe um endpoint de diagnóstico ou preview que mostre como uma requisição `model: obruxo` seria classificada sem executar a LLM?

**Resposta:**  
**Sim.** O OmniRoute oferece o endpoint de inspecção/preview:

```http
POST /api/combos/preview
Content-Type: application/json

{
  "model": "obruxo",
  "messages": [{ "role": "user", "content": "Escreva uma função TypeScript" }]
}
```

O endpoint retorna a cadeia de modelos (`chain`), janelas de contexto (`contextWindow`), limites de entrada/saída (`maxInput`, `maxOutput`) e a estratégia aplicada, **sem consumir quota nem disparar requisições para provedores**.
