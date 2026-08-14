<!-- refreshed: 2026-08-14 -->
# Architecture

**Analysis Date:** 2026-08-14

## System Overview

OmniRoute is a unified AI proxy/router with 7 architectural layers that process client requests through format translation, intelligent routing, and upstream execution:

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│                         API Routes (Entry Points)                             │
│                         src/app/api/v1/*/route.ts                             │
│  ┌─CORS → Zod Validation → Auth → Policy → Prompt Injection Guard─────────┐  │
└──┼─────────────────────────────────────────────────────────────────────────┼──┘
   │
   ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                    Request Handling Layer                                     │
│         open-sse/handlers/{chatCore,embeddings,images}.ts                    │
│  ┌─Memory Injection → Request Setup → Tool Normalization────────────────┐   │
│  │─Cache Check → Rate Limit → Semantic Cache → Idempotency──────────┐  │   │
│  │─Client Buffers → Guardrails → Lifecycle Checks────────────────┐  │  │   │
└──┼────────────────────────────────────────────────────────────────┼──┼──┼───┘
   │                                                                │  │  │
   ▼                                                                │  │  │
┌──────────────────────────────────────────────────────────────────┼──┼──────┐
│                    Routing & Resilience Layer                    │  │      │
│      open-sse/services/{combo,accountFallback}.ts                │  │      │
│  ┌─Combo Strategy Selection → Target Candidate Building──────┐  │  │      │
│  │─Quota Evaluation → Credential Gate → Session Affinity──┐  │  │  │      │
│  │─Circuit Breaker Check → Account Semaphore → Model Lock─┤  │  │  │      │
└──┼──────────────────────────────────────────────────────────┼──┼──┼───────┘
   │  (19 combo strategies: priority/weighted/round-robin/    │  │  │
   │   cost-optimized/fusion/auto/... See AUTO-COMBO.md)      │  │  │
   │                                                            │  │  │
   ▼                                                            │  │  │
┌──────────────────────────────────────────────────────────────┼──┼────────┐
│                   Format Translation Layer                    │  │        │
│    open-sse/translator/{index,request,response}/*.ts         │  │        │
│  ┌─Request Normalization → Format Conversion────────────┐   │  │        │
│  │─Tool Translation → Schema Coercion → Reasoning Setup ├───┼──┼────┐   │
│  │─Response Translation → Result Synthesis             │   │  │    │   │
└──┼─────────────────────────────────────────────────────┼───┼──┼────┼───┘
   │  (OpenAI ↔ Claude ↔ Gemini ↔ Responses formats)     │   │  │    │
   │                                                      │   │  │    │
   ▼                                                      │   │  │    │
┌────────────────────────────────────────────────────────┼───┼──┼────┼────┐
│              Provider Execution Layer                   │   │  │    │    │
│       open-sse/executors/base.ts + provider-specific   │   │  │    │    │
│  ┌─Request Transformation → Credential Inject────────┐ │   │  │    │    │
│  │─HTTP Dispatch w/ Retry/Backoff → Stream Setup─────┤─┼───┼──┼────┼──┐ │
│  │─Error Classification → Fallback Signaling       │ │ │   │  │    │  │ │
└──┼───────────────────────────────────────────────────┼─┼───┼──┼────┼──┼─┘
   │  (124+ provider executors: OpenAI, Claude,        │ │   │  │    │  │
   │   Anthropic, Gemini, local, etc)                  │ │   │  │    │  │
   │                                                    │ │   │  │    │  │
   ▼                                                    │ │   │  │    │  │
┌───────────────────────────────────────────────────────┼─┼───┼──┼────┼──┼──┐
│              Upstream HTTP & Resilience               │ │   │  │    │  │  │
│    fetch() w/ Retry Policy → Connection Cooldown     │ │   │  │    │  │  │
│    Provider Circuit Breaker → Model Lockout          │ │   │  │    │  │  │
│    Account Semaphore → Rate Limit Tracking           │ │   │  │    │  │  │
└───────────────────────────────────────────────────────┼─┼───┼──┼────┼──┼──┘
   │                                                    │ │   │  │    │  │
   ├──(Success Path)───────────────────────────────────┘ │   │  │    │  │
   │                                                      │   │  │    │  │
   ▼                                                      │   │  │    │  │
┌─────────────────────────────────────────────────────────┼───┼──┼────┼──┼──┐
│           Response & Stream Processing                  │   │  │    │  │  │
│  Response Format Detection → Transform Stream Setup     │   │  │    │  │  │
│  SSE/JSON Output → Semantic Cache Store → Usage Track  │   │  │    │  │  │
└─────────────────────────────────────────────────────────┼───┼──┼────┼──┼──┘
   │                                                      │   │  │    │  │
   │   (Failure Path: checkFallbackError) ◄──────────────┘   │  │    │  │
   │   (Retries per combo strategy)      ◄──────────────────┘  │    │  │
   │   (Fall back to next target)        ◄──────────────────────┘    │  │
   │   (Final error response)            ◄──────────────────────────┘  │
   │                                                                    │
   ▼                                                                    │
┌──────────────────────────────────────────────────────────────────────┼──┐
│           Persistence & Support Services                              │  │
│  Database (src/lib/db/): SQLite 145+ migrations, 30+ domain modules  │  │
│  Memory (src/lib/memory/): FTS5 + Qdrant vector search               │  │
│  Cache (open-sse/services/): Semantic, idempotency, combo context    │  │
│  Webhooks (src/lib/webhookDispatcher.ts): Request/response events    │  │
│  MCP Server (open-sse/mcp-server/): 105 tools, 31 scopes             │  │
│  A2A (src/lib/a2a/): JSON-RPC 2.0 agent protocol, 5 skills          │  │
│  Skills (src/lib/skills/): Extensible sandboxed skill framework      │  │
│  Cloud Agents (src/lib/cloudAgent/): Integration with external AI    │  │
└──────────────────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| **API Routes** | HTTP entry points, CORS, validation, auth, delegation | `src/app/api/v1/*/route.ts` |
| **Request Handlers** | Cache/rate-limit checks, guardrails, memory injection, lifecycle | `open-sse/handlers/chatCore.ts` |
| **Combo Router** | Multi-target selection, strategy execution, target orchestration | `open-sse/services/combo.ts` |
| **Account Fallback** | Credential selection, circuit breaker, connection cooldown, model lockout | `open-sse/services/accountFallback.ts` |
| **Request Translator** | OpenAI/Claude/Gemini/Responses format interop | `open-sse/translator/index.ts` |
| **Provider Executors** | HTTP dispatch, credential injection, error classification | `open-sse/executors/base.ts` |
| **Stream Processor** | SSE/JSON output, chunking, error finalization | `open-sse/utils/stream.ts` |
| **Database** | Persistence of credentials, combos, settings, migrations | `src/lib/db/core.ts` |
| **Domain Policy** | Cost rules, fallback logic, quota enforcement | `src/domain/` |
| **Guardrails** | PII masking, prompt injection, vision safety | `src/lib/guardrails/` |
| **MCP Server** | 105 tools across 31 scopes (stdio/SSE/HTTP) | `open-sse/mcp-server/` |
| **A2A Server** | JSON-RPC 2.0 agent protocol, 5 skills | `src/lib/a2a/` |

## Pattern Overview

**Overall:** Streaming-first request pipeline with pluggable executors and multi-target failover.

**Key Characteristics:**
- **Stateless HTTP handlers** per route; state stored in SQLite or transient cache
- **Promise-based async flow** with no blocking I/O; all persistence via async DB calls
- **Per-request logging context** (traceId) for correlation across layers
- **Lazy resilience recovery** — circuit breaker and connection cooldown checked on read, not background task
- **Hot-path optimization** — route shape validation minimal; deep validation in handler; formatted requests cached
- **Error classification pattern** — each layer catches and classifies failures (account error vs. provider error vs. upstream error) before deciding retry/fallback

## Layers

**API Routes (Entry):**
- Purpose: HTTP binding, OPTIONS/POST handling, headers normalization, body parsing
- Location: `src/app/api/v1/*/route.ts` (40+ routes)
- Contains: Route handlers following Next.js App Router pattern
- Depends on: Zod (validation), `open-sse/handlers/*` (delegation)
- Used by: HTTP clients (OpenAI-compatible endpoints)

**Request Handlers (Processing):**
- Purpose: Manage request lifecycle — cache checks, rate limits, guardrails, memory injection, model lifecycle
- Location: `open-sse/handlers/` (32 modules)
- Contains: `chatCore.ts` (main), `embeddings.ts`, `images.ts`, and 30+ context modules for isolated concerns
- Depends on: `open-sse/services/` (combo, cache, rate limit), `open-sse/translator/`, guardrails, DB
- Used by: API routes, combo service (per-target wrapper)

**Routing & Resilience (Orchestration):**
- Purpose: Multi-target selection, execution strategy, circuit breaker, account semaphore, model lockout
- Location: `open-sse/services/{combo.ts, accountFallback.ts, ...}`
- Contains: 19 combo strategies (priority/weighted/round-robin/fusion/cost/context-optimized/etc.), quota evaluation, credential gate
- Depends on: Credentials DB, circuit breaker state, model lockout DB, quota cache
- Used by: `handleChat`, combo endpoints, MCP tools

**Format Translation (Interop):**
- Purpose: Convert between OpenAI, Claude, Gemini, Responses, and other API formats
- Location: `open-sse/translator/{index.ts, request/*, response/*}`
- Contains: Request normalization, tool translation, schema coercion, response synthesis
- Depends on: Format registry, model capabilities DB, provider config
- Used by: Request handlers (before executor), response processors (after upstream)

**Provider Execution (HTTP Dispatch):**
- Purpose: Provider-specific HTTP dispatch, credential injection, error classification, retry policy
- Location: `open-sse/executors/base.ts` (72KB base class), 124+ provider-specific executors
- Contains: Base executor pattern, OAuth token refresh, API key rotation, fingerprinting, header management
- Depends on: HTTP client (`fetch`), executor registry, provider config
- Used by: Combo service per target (wrapped in `handleSingleModel`)

**Stream & Response (Output):**
- Purpose: SSE/JSON stream assembly, chunking, semantic cache storage, response cleanup
- Location: `open-sse/utils/{stream.ts, sseHeartbeat.ts}`, `open-sse/transformer/`
- Contains: TransformStream builders, event serialization, keepalive frames, error finalization
- Depends on: Stream controller, response format, usage tracking
- Used by: Response assembly phase in handlers

**Persistence & Support:**
- **Database**: `src/lib/db/{core.ts, [130 modules]}` — SQLite, 145 migrations, domain modules for credentials/combos/settings
- **Memory**: `src/lib/memory/` — FTS5 full-text search + Qdrant vector for semantic recall
- **Cache**: `open-sse/services/{semanticCache.ts, idempotencyCache.ts, comboContextCache.ts}`
- **MCP**: `open-sse/mcp-server/{tools/*, transports/*}` — 105 tools, 31 scopes, 3 transports
- **A2A**: `src/lib/a2a/` — JSON-RPC 2.0 agent protocol, 5 skills
- **Webhooks**: `src/lib/webhookDispatcher.ts` — request/response lifecycle events

## Data Flow

### Primary Request Path

1. **HTTP Entry** (`src/app/api/v1/chat/completions/route.ts:81-300`)
   - Parse request body once (no body re-reads)
   - Validate Content-Type (application/json)
   - Extract headers (compression, streaming hints)
   - Initialize translators (singleton, Promise-based)

2. **Admission & Validation** (`src/app/api/v1/chat/completions/route.ts:100-200`)
   - Chat admission queue (max wait: CHAT_ADMISSION_QUEUE_MAX_MS)
   - Zod shape validation (minimal; deep validation downstream)
   - Prompt injection guard check
   - Extract API key, policy enforcement

3. **Handler Delegation** (`src/app/api/v1/chat/completions/route.ts:200+`)
   - Call `handleChat()` from `src/sse/handlers/chat.ts`
   - Pass: body, credentials, API key info, correlation ID, session affinity
   - Chain response through compression echo, SSE keepalive, early stream keepalive

4. **Request Processing** (`open-sse/handlers/chatCore.ts:426-850`)
   - Extract model info, create trace ID
   - Inject system prompt, custom system prompt
   - Run plugin onRequest hook
   - Resolve request format (OpenAI vs. Responses vs. Claude)
   - Check semantic cache (full match)
   - Check idempotency cache
   - Normalize messages, resolve lifecycle (model deprecation policy)
   - Validate tool calling support
   - Resolve memory & skills context
   - Apply client usage buffers
   - Build guardrail context

5. **Routing Decision** (`open-sse/handlers/chatCore.ts:850-1000`)
   - Parse combo name (if multi-target)
   - Resolve combo strategy (19 options)
   - Build combo context (targets, quota info, credential gates)
   - If single-target: proceed to translation
   - If multi-target: invoke `handleCombo()` (orchestrates per-target `handleSingleModel()`)

6. **Format Translation** (`open-sse/handlers/chatCore.ts:1000-1200`)
   - Call `translateRequest()` (returns translated body + metadata)
   - Resolve target format per provider/model
   - Normalize OpenAI↔Claude↔Gemini↔Responses
   - Translate tools (tool schema coercion, optional enum omission)
   - Strip unsupported params per provider
   - Apply reasoning/thinking budget

7. **Executor Resolution & Dispatch** (`open-sse/handlers/chatCore.ts:1200-1400`)
   - Call `getExecutor(provider, model)` (returns appropriate executor class)
   - Instantiate with credentials
   - Call `executor.execute({translatedBody, ...})`
   - Executor handles: credential injection, header merging, OAuth token refresh, retry policy
   - Executor dispatches: `fetch()` to upstream with retry loop (backoff on 5xx/408)

8. **Error Classification & Fallback** (`open-sse/handlers/chatCore.ts:1400-1500`)
   - Catch upstream error
   - Call `checkFallbackError()` (classify: account error / provider error / context overflow / quota / etc.)
   - Decide: retry same target, fall back to next combo target, or final error
   - If fallback eligible: record model lockout, mark connection cooldown, loop to step 5 (next target)
   - If no fallback: build error response

9. **Response Processing** (`open-sse/handlers/chatCore.ts:1500-1700`)
   - Detect response format (streaming vs. JSON)
   - If streaming: set up SSE stream, apply keepalive, semantic cache store
   - If JSON: extract usage, convert to client format, apply Responses semantics
   - Store semantic cache (if hit eligible)
   - Emit request.completed event
   - Return response with correct headers (CORS, content-type, usage)

### Combo Routing Flow (Multi-Target)

1. **Combo Setup** (`open-sse/services/combo.ts:100-300`)
   - Resolve combo config from DB
   - Build target candidates (providers + models)
   - Evaluate quota per candidate
   - Check credential gate (available accounts)
   - Apply session affinity (sticky connection)
   - Order by strategy (priority/cost/round-robin/etc.)

2. **Per-Target Execution** (`open-sse/services/combo.ts:300-600`)
   - For each target in order:
     - Check circuit breaker (CLOSED/OPEN/HALF_OPEN)
     - Check model lockout (per target)
     - Try to acquire account semaphore slot
     - Call `handleSingleModel()` (wraps `handleChatCore()`)
     - Catch response/error

3. **Fallback Decision** (`open-sse/services/combo.ts:600-800`)
   - Classify error: recoverable vs. terminal
   - If recoverable: mark connection cooldown, increment failure count, try next target
   - If terminal (account banned / expired / invalid key): skip, try next
   - If quota hit per target: skip, try next
   - If all targets exhausted: return combo error with diagnostics

4. **Fusion Strategy Exception** (`open-sse/services/fusion.ts`)
   - Fan out to a panel of models in parallel
   - Judge model synthesizes one final answer
   - Return judge response

### Cache Paths

- **Semantic Cache Hit** (`open-sse/handlers/chatCore/semanticCache.ts`): Compare request hash + key embeddings, return cached response directly
- **Idempotency Hit** (`open-sse/handlers/chatCore/idempotency.ts`): Match idempotency key, return cached response
- **Combo Context Cache** (`open-sse/handlers/chatCore/comboContextCache.ts`): Avoid re-fetching combo metadata per request batch

## Key Abstractions

**Executor Pattern:**
- Purpose: Encapsulate provider-specific HTTP behavior
- Examples: `open-sse/executors/{openai.ts, claude-web.ts, bedrock.ts, antigravity.ts}`
- Pattern: Extends `BaseExecutor`, overrides: request prep, error classification, response parsing
- Interface: `execute({translatedBody, credentials, ...}): Promise<Response>`

**TransformStream (SSE Output):**
- Purpose: Compose streaming response pipelines
- Examples: `open-sse/utils/createSSETransformStreamWithLogger()`, heartbeat, semanticCacheStore
- Pattern: Chainable `.pipe()` operators; each wraps input readable stream
- Usage: `response.body.pipe(sseTransform).pipe(heartbeatTransform).pipe(cacheStoreTransform)`

**Account Semaphore:**
- Purpose: Limit concurrent requests per connection
- Pattern: Acquire slot before executor dispatch; release on error or response complete
- Tuneable: Per-account concurrency cap in DB
- Usage: Prevents thundering herd against OAuth-backed providers

**Circuit Breaker (Lazy Recovery):**
- Purpose: Disable whole provider on repeated failures
- States: CLOSED (normal) → OPEN (blocked) → HALF_OPEN (test probe)
- Recovery: Lazy — checked on read; if timeout elapsed, refresh to HALF_OPEN
- Usage: Prevents slow provider from cascading to all combo targets

**Model Lockout:**
- Purpose: Disable one model per connection when only that model fails
- Pattern: Per-model failure count + timestamp in accountFallback context
- Usage: Allows same connection to serve other models while one is unavailable

**Combo Strategy Registries:**
- Purpose: Select per-request routing algorithm (19 strategies)
- Examples: `priority` (use first candidate), `cost-optimized` (lowest $/token), `fusion` (parallel judge)
- Tuneable: Strategy name + params in DB combo record
- Usage: `resolveComboConfig()` returns strategy enum; combo loop respects it

**Provider Executor Registry:**
- Purpose: Map provider ID → executor class
- Pattern: Lazy loading; cached after first instantiation
- Usage: `getExecutor(provider, model)` returns executor instance

## Entry Points

**HTTP Routes:**
- Location: `src/app/api/v1/chat/completions`, `embeddings`, `images`, `audio/transcriptions`, etc.
- Triggers: HTTP POST (or OPTIONS for CORS)
- Responsibilities: Parse request, apply CORS, delegate to handler

**MCP Tools:**
- Location: `open-sse/mcp-server/tools/` (105 tools across 31 scopes)
- Triggers: Tool invocation from client (Claude, Copilot, etc.)
- Responsibilities: Tool input validation, DB/API access, result formatting

**A2A Skills:**
- Location: `src/lib/a2a/skills/` (smart-routing, quota-management, provider-discovery, etc.)
- Triggers: Task execution from agent runtime
- Responsibilities: Task planning, execution, result synthesis

**Webhooks:**
- Location: `src/lib/webhookDispatcher.ts`
- Triggers: Request start, response complete, error events
- Responsibilities: Dispatch to configured endpoints

## Architectural Constraints

- **Threading:** Single-threaded event loop (Node.js). No worker threads for main request path. Account semaphore + circuit breaker use in-process atomics (no distributed coordination).
- **Global state:** 
  - Circuit breaker state: `src/shared/utils/circuitBreaker.ts` (in-memory + DB fallback)
  - Combo failure tracker: `open-sse/services/combo/failureTracker.ts` (in-memory, reset per request)
  - Connection cooldown: `open-sse/services/accountFallback.ts` (in-memory + DB)
  - Model lockout: `open-sse/services/accountFallback.ts` (in-memory + DB)
- **Circular imports:** None detected in core pipeline (`src/app/api → open-sse/handlers → open-sse/services`). Domain modules (`src/domain`) have weak circular coupling (mitigated by lazy imports).
- **Database transactions:** SQLite WAL mode; migrations idempotent and transactional. Concurrent writes to shared connections may cause lock contention (unobserved in practice at <1000 req/s).

## Anti-Patterns

### Swallowing Errors in Streams

**What happens:** A stream error (e.g., network failure mid-response) is caught but not propagated. Client sees incomplete SSE frame.
**Why it's wrong:** Client hangs waiting for response completion; dashboards show "pending" forever.
**Do this instead:** Always emit error frame before stream close. Use `streamFailure.finalize()` from `open-sse/utils/streamFailureFinalization.ts` to emit standardized error on abort.

### Re-validating Already-Parsed Bodies

**What happens:** Request body is parsed in route, then re-validated deeply in handler. Two separate Zod schema runs.
**Why it's wrong:** Duplicates CPU work on hot path; slow requests.
**Do this instead:** Route does minimal shape check (non-null object, model is string). Handler owns the deep validation (`messages`, `tools`, `parameters`). See `src/app/api/v1/chat/completions/route.ts:55-72` (intentionally permissive schema).

### String-Interpolating API Paths

**What happens:** Custom API path built via string interpolation: `const url = \`${baseUrl}/${customPath}\`.
**Why it's wrong:** Path traversal risk; user-supplied path can escape to parent directories.
**Do this instead:** Sanitize path with `sanitizePath()` from `open-sse/executors/base.ts:126-133` — validate starts with `/`, no `..`, no null bytes, reasonable length.

### Blocking Executor Instantiation

**What happens:** Executor class instantiated inside a loop with full initialization (credential refresh, OAuth fetch).
**Why it's wrong:** Blocks combo loop; if one target has slow OAuth, whole combo stalls.
**Do this instead:** Executor initialization is async and happens inside `executor.execute()`, outside the critical path. Combo loop only decides targets; executors handle their own setup.

## Error Handling

**Strategy:** Classify errors into account/provider/context categories. Try fallback within combo if available; else return typed error response.

**Patterns:**
- **Try/catch at handler boundary**: Each handler catches sync + async errors, logs with traceId, returns typed error response
- **Error classification before fallback**: `checkFallbackError()` analyzes HTTP status + error message to decide retry/fallback/terminal
- **Account errors (401/403 w/ specific keywords)**: Mark connection cooldown, skip next time, try another credential
- **Provider errors (5xx/502/503/504)**: Increment provider circuit breaker, may open if threshold exceeded
- **Context overflow (context length exceeded)**: Mark model lockout, try another model
- **Terminal errors (banned / expired / invalid)**: Set account status to unavailable; manual fix required
- **SSE stream errors**: Emit error frame with message, close stream cleanly
- **Timeout errors**: Classify as network (connection level) vs. application (request level); retry with backoff

## Cross-Cutting Concerns

**Logging:** Request logger with pino context. Per-request traceId for correlation. Stage trace (stageTrace) marks checkpoint timing. Executor request logging optional (gated by OMNIROUTE_DEBUG).

**Validation:** Zod schemas guard HTTP body shape (route level, minimal) and message/tool structure (handler level, deep). Provider registry validates model names on startup.

**Authentication:** Optional API key validation (`isValidApiKey()` from auth module). JWT extraction + policy enforcement (rate limits, quota). Provider credentials resolved via DB module (`src/sse/services/auth.ts`).

**Memory & Skills Injection:** Request handler injects memory context (similar messages) and available skills (callable tools) into system prompt or tool list before translation.

**Guardrails:** PII masking (opt-in), prompt injection guard, vision safety checks. Applied to request body before handler or to response after upstream.

---

*Architecture analysis: 2026-08-14*
