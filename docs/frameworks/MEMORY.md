---
title: "Memory System"
version: 4.0.0
lastUpdated: 2026-08-12
---

# Memory System

> **Source of truth:** `src/lib/memory/` and `src/app/api/memory/`
> **Last updated:** 2026-08-12 — **v4.0.0 four-layer hard cutover** (L0 raw session, L1 typed long-term, L2 navigation, L3 chat singleton; SQLite `memory.db` standalone; no Qdrant; no external vector store).

The four-layer Memory System replaces the v3.x single-table conversational memory with a strictly-typed pipeline. **This is a breaking replacement of the v3.x memory architecture** — there is no migration shim. Old rows from the `memories` / `memory_fts` / `vec_memories` / `memory_vec_meta` tables are **wiped on boot** (the operator confirmed the production install was empty before rollout; a one-shot export script under `scripts/memory/export-v3-memory.mjs` is available for installs that need to back up legacy rows first).

> **Fork-only publication.** This four-layer architecture is a fork-specific design — it is **not** an upstream contribution. The upstream OmniRoute memory subsystem (`src/lib/memory/`) keeps the v3.x single-table design. License attribution for the v3.x-derived storage helpers remains in the project `THIRD-PARTY-NOTICES` file and is managed by the license attribution agent (no per-doc attribution added here).

## Why four layers

A single flat memory table mixes three concerns: full-fidelity transcripts (huge, useful for replay), distilled long-term facts (small, useful for retrieval), and "where am I in the conversation" navigation (stateful, per-request). The four-layer split lets each layer pick the right storage shape and lifecycle:

| Layer  | Purpose                                                                | Cardinality                                                     | Storage                                                                                        | Lifecycle                                                       |
| ------ | ---------------------------------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| **L0** | Raw session transcript — the full visible text per turn, kept verbatim | Per turn, all turns                                             | SQLite `memory.db` (standalone, no shared DB), no FTS index beyond session boundary, no vector | Bounded session retention + explicit reset                      |
| **L1** | Distilled long-term facts — 7 typed categories of derived knowledge    | Per-fact, deduped per API key                                   | SQLite `memory.db` with FTS5 + optional sqlite-vec hybrid RRF k=60                             | Background distillation; per-type retention; per-API-key opt-in |
| **L2** | Navigation — a small map of pointers, summaries, and guide sections    | ≤15 entries per conversation                                    | SQLite `memory.db`                                                                             | Updated per distillation pass; bounded; pruned when stale       |
| **L3** | Singleton working memory — chat vs code branch + scratchpad            | 1 per conversation (mutually exclusive `chat` or `code` branch) | SQLite `memory.db`                                                                             | Replaced/regenerated; cleared on `regenerate`                   |

The 7 L1 types are: `preference`, `fact`, `decision`, `pattern`, `profile`, `context`, `correction`. (See [L1 Types](#l1-types) below.)

> **No external vector store.** Unlike v3.x, this architecture does not load sqlite-vec as a hard dependency and does not support Qdrant, Redis, an SDK vector cache, or any AI SDK. The optional sqlite-vec path is loaded only when an embedding source is selected (default: pure FTS5, no vec).

## Storage: standalone `memory.db`

Memory state lives in a **dedicated SQLite database file**, not in the main OmniRoute DB. The path is `<DATA_DIR>/memory.db` (configurable; see `MEMORY_DB_PATH`). The database is opened in WAL mode (single writer, many readers; the same Node connection pool used by the main DB).

- **No backup.** `memory.db` is not backed up by OmniRoute's snapshot tooling. Operators must arrange their own off-host backup if they need it.
- **Reset means delete.** The reset path (`POST /api/memory/reset`, `scripts/memory/reset.sh`, dashboard button) closes all handles, deletes `memory.db`, and lets the next request re-create the schema. There is no in-place migration, no soft-reset flag, no "preserve L1 but wipe L0" toggle — every reset is a hard wipe of all four layers.
- **No shared DB.** `memory.db` is opened exclusively by `src/lib/memory/db.ts`; no other domain module touches it. Migrations live in `src/lib/db/migrations/` under a `memory_*` prefix and run on first open.
- **No Redis.** Capture and injection paths do not consult or write any Redis or external cache. There is no `ai`-SDK or `@ai-sdk/*` dependency in the memory subsystem.

```
DATA_DIR/
├── omniroute.db          # main app DB (unchanged)
├── memory.db             # standalone memory DB (L0/L1/L2/L3 + FTS5 + optional vec)
├── memory.db-wal         # WAL journal (auto-managed)
└── memory.db-shm         # shared memory file (auto-managed)
```

## Capture & injection (opt-in, per API key)

Memory capture and injection are **off by default** and **scoped per API key**. Two independent toggles exist on the API key record:

- `memory.capture` — when `true`, conversation turns are written to L0 and (when distillation is enabled) summarised into L1.
- `memory.inject` — when `true`, the chat pipeline reads L3 + L2 navigation + guide and prepends them to outgoing requests.

Both default to `false`. Per-key overrides do not affect global settings; the global switch is a separate `MEMORY_GLOBAL_ENABLED` env var (default `false`) that, when true, **defaults new keys to capture+inject** but never overrides an explicit per-key `false`.

### PII flags

PII redaction flags are **unchanged** — still `PII_REDACTION_ENABLED` (request-side) and `PII_RESPONSE_SANITIZATION` (response-side), both default `false` per Hard Rule #20. Memory capture does **not** re-enable PII mutation by default; the existing `src/lib/guardrails/piiMasker.ts` and `src/lib/streamingPiiTransform.ts` paths are unchanged. Operators who want memory capture to redact PII before writing to L0 must enable `PII_REDACTION_ENABLED` separately.

### No-memory header (per-request opt-out)

A client can opt a single request out with the `x-omniroute-no-memory` header (`true`/`1`/`yes`). The check is performed in `open-sse/handlers/chatCore/headers.ts::isNoMemoryRequested` — when set, both `memory.capture` and `memory.inject` are skipped for that request, and the request does not update L3. This header is **always honoured**, regardless of per-key or global defaults.

### Internal marker (no-memory propagation)

When a request is determined to be a sub-call within the memory subsystem itself (e.g. a background distillation pass calling an LLM, or a self-generated tool call that shouldn't recursively inject memory), the chat pipeline stamps an **internal marker** on the outbound upstream call. The marker is consumed by `chatCore.ts` and prevents a second capture pass from running on the distillation output. The marker is **not** visible to operators; it is set in `open-sse/handlers/chatCore/internalMarker.ts` and is independent of the `x-omniroute-no-memory` header (the header is operator-facing; the marker is internal).

## Distillation (background)

L1 facts and L2 navigation are produced by a **background distillation loop** that scans L0 turns and writes new L1/L2 rows. The loop runs out-of-band; the chat pipeline never waits for it.

```
loop tick (every MEMORY_DISTILLATION_INTERVAL seconds, default 300):
  for each active apiKey with memory.capture=true:
    pick the next undistilled L0 batch (window: MEMORY_DISTILLATION_BATCH_TURNS, default 20 turns)
    call the distillation model (MEMORY_DISTILL_MODEL, see selector chain below)
    parse the model output → L1 facts (typed) + L2 navigation pointers
    upsert into L1 (dedup on (apiKeyId, type, key)), L2 (cap at 15 per conversation)
    mark L0 turns as distilled (timestamp only; rows stay for retention window)
```

The distillation selector chain is:

1. `MEMORY_DISTILL_MODEL` env var (`provider/model`).
2. If unset, the **first provider in `listEmbeddingProviders()` with `hasKey === true`** that has chat capability — same pattern as the v3.x embedding resolver.
3. Otherwise, the configured default chat model from `getDefaultChatProvider()`.

Distillation is **disabled by default** (`MEMORY_DISTILLATION_ENABLED=false`). When disabled, L0 turns are still written (when capture is on), but no L1/L2 entries are produced. L3 still updates per turn (working state). The DLQ (`/api/memory/distillation/dlq`) collects failed distillation batches with the raw model output, last error, and timestamp; retries are manual (`POST /api/memory/regenerate` triggers a re-distillation of a single L0 batch).

## Injection: L3 + L2 nav + guide system

When `memory.inject=true` and the request is not a no-memory request, the chat pipeline reads, in order:

1. **L3 singleton** — the working memory for the conversation: the current branch (`chat` or `code`), the active guide id, and the scratchpad text. Replaced in-place per turn. Bounded to one entry per `(apiKeyId, conversationId)`.
2. **L2 navigation** — up to 15 entries per conversation; the selector picks the top-K by recency × activation score. These tell the LLM "what region of the conversation is currently active."
3. **L1 guide system** — when L2 includes a `guide` pointer, the corresponding L1 `guide` row (a curated multi-section text block) is fetched and prepended as a system-message section. The guide row is itself an L1 type — distinct from `preference`/`fact`/etc.
4. **L1 user cache-safe content** — small L1 facts (≤ ~64 chars after token-budget walk) that are user-authored and cache-safe to prepend are injected as a compact system block. Facts marked as `cache-unsafe` (volatile timing, transient state) are excluded.
5. **L0 raw on demand** — the chat pipeline never auto-injects L0 turns. Tools that need raw history call `POST /api/memory/l0` with a turn window (`?from=<turnId>&to=<turnId>`) and merge the result into their own context.

### Caps and timeout

- **L1 injection budget:** default `MEMORY_INJECT_MAX_TOKENS` (2000 tokens), clamped to `[1, 8000]`. The token budget walk picks L1 entries by `(activation × recency)` and stops when the running total exceeds the budget.
- **L2 navigation cap:** ≤15 entries per conversation (hard limit; older entries are pruned at the next distillation pass).
- **L3 timeout:** `MEMORY_L3_TIMEOUT_MS` (default 5000ms) — if the L3 read exceeds this, the pipeline proceeds without L3.
- **Total injection timeout:** `MEMORY_INJECT_TIMEOUT_MS` (default 7500ms) — if the combined L3+L2+L1 read takes longer, the pipeline falls back to no-injection (the upstream request still goes through, just without memory).

The injection always happens **before** compression (per v3.x behaviour). When a request also enables `COMPRESSION_PIPELINE_BREAKER_ENABLED`, the breaker does **not** consider memory payload as the "input" to compress — compression runs on the user-supplied content only.

## Architecture

```
Client → /v1/chat/completions
  → chatCore.ts
    → resolveMemoryOwnerId(apiKeyInfo)
    → isNoMemoryRequested(headers)           # x-omniroute-no-memory + internal marker
    → if not no-memory and memory.inject:
        → readL3(apiKeyId, conversationId)            # ≤5s timeout
        → readL2Nav(apiKeyId, conversationId)         # ≤15 entries
        → readL1Guide(apiKeyId, activeGuideId)        # if L2 nav points to one
        → readL1UserCacheSafe(apiKeyId, maxTokens)
        → assemble inject payload (system message)
        → injectMemory(body, payload, provider)
    → upstream provider call
    → on response (non-blocking, setImmediate):
        → if memory.capture and not no-memory and not internal-marker:
            → writeL0Turn(apiKeyId, conversationId, role, text)
            → if MEMORY_DISTILLATION_ENABLED and within batch window:
                → queueL0BatchForDistillation(apiKeyId, conversationId, batch)
        → updateL3(apiKeyId, conversationId, branch, scratchpad)
```

## REST API

All memory routes require management auth (`requireManagementAuth`) **except** `/api/memory/l0` (read-only, available with `memory.inject` scope or management auth) and `/api/memory/distillation/dlq` (management only).

### Four-layer CRUD

| Method   | Path                  | Description                                                                                                                                                          |
| -------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`    | `/api/memory/l0`      | Read raw L0 turns — `?apiKeyId=`, `?conversationId=`, `?from=<turnId>&to=<turnId>`, `?limit=` (default 100, max 1000). Returns `{ turns: [...], total, truncated }`. |
| `GET`    | `/api/memory/l1`      | List L1 facts — `?apiKeyId=`, `?type=`, `?key=`, `?limit=`, `?offset=`. Type filter accepts one of the 7 L1 types.                                                   |
| `POST`   | `/api/memory/l1`      | Upsert an L1 fact — body: `{apiKeyId, type, key, content, metadata?}`. Dedups on `(apiKeyId, type, key)`.                                                            |
| `DELETE` | `/api/memory/l1/{id}` | Delete one L1 fact.                                                                                                                                                  |
| `GET`    | `/api/memory/l2`      | List L2 navigation entries — `?apiKeyId=`, `?conversationId=`. Capped at 15 per conversation.                                                                        |
| `PUT`    | `/api/memory/l2`      | Replace the L2 navigation set for a conversation — body: `{apiKeyId, conversationId, entries: [{pointer, activation, label?}]}`. Cap enforced server-side.           |
| `GET`    | `/api/memory/l3`      | Read the L3 singleton — `?apiKeyId=`, `?conversationId=`. Returns `{branch, guideId?, scratchpad, updatedAt}`.                                                       |
| `PUT`    | `/api/memory/l3`      | Replace the L3 singleton — body: `{apiKeyId, conversationId, branch: "chat" \| "code", guideId?, scratchpad?}`. Validates `branch ∈ {"chat","code"}`.                |

### Maintenance

| Method | Path                             | Description                                                                                                                                                                                                      |
| ------ | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST` | `/api/memory/regenerate`         | Force re-distillation of a specific L0 batch — body: `{apiKeyId, conversationId, batchId}`. Empties the matching L1/L2/L3 contributions for that batch and re-runs distillation. Returns the new L1/L2 snapshot. |
| `GET`  | `/api/memory/distillation-model` | Inspect the current distillation selector chain — returns `{ enabled, model, source, candidates: [...] }`.                                                                                                       |
| `PUT`  | `/api/memory/distillation-model` | Override the distillation model — body: `{ model: "provider/model" }`. Validates against `listEmbeddingProviders()` (must be configured) or accepts `null` to fall back to the selector chain.                   |
| `GET`  | `/api/memory/distillation/dlq`   | List failed distillation batches — `?apiKeyId=`, `?conversationId=`, `?since=`, `?limit=` (default 50, max 500). Returns `{ batches: [{batchId, error, model, rawOutput, createdAt}], total }`.                  |

All error responses route through `buildErrorBody()` / `sanitizeErrorMessage()` from `open-sse/utils/error.ts` per Hard Rule #12 — no raw `err.stack` or `err.message` in the body.

> **Removed (v3.x routes, no replacement):** `/api/memory` (root CRUD), `/api/memory/{id}` (single-entry CRUD), `/api/memory/health`, `/api/memory/engine-status`, `/api/memory/reindex`, `/api/memory/retrieve-preview`, `/api/memory/summarize`, `/api/memory/embedding-providers`, `/api/settings/memory`, `/api/settings/qdrant/*`. These routes are gone; clients calling them receive `404 Not Found`. There is **no compat shim** — operators must migrate to the four-layer endpoints above.

> **Removed (memory-specific Qdrant routes):** the entire `/api/settings/qdrant/*` family was Qdrant-specific and has no replacement. Health checks against any external vector store (when one is configured) are exposed through `/api/monitoring/health` instead.

## MCP Tools (`open-sse/mcp-server/tools/memoryTools.ts`)

The v3.x MCP tools (`omniroute_memory_search`, `omniroute_memory_add`, `omniroute_memory_clear`) are replaced by four layer-scoped tools:

| Tool                  | Layer | Args                                                                                            | Returns                |
| --------------------- | ----- | ----------------------------------------------------------------------------------------------- | ---------------------- |
| `omniroute_memory_l0` | L0    | `{apiKeyId, conversationId, from?, to?, limit?}`                                                | Raw turn window        |
| `omniroute_memory_l1` | L1    | `{apiKeyId, type?, key?, limit?}` / upsert: `{apiKeyId, type, key, content, metadata?}`         | List or upsert result  |
| `omniroute_memory_l2` | L2    | `{apiKeyId, conversationId}` / put: `{apiKeyId, conversationId, entries}`                       | List or replace result |
| `omniroute_memory_l3` | L3    | `{apiKeyId, conversationId}` / put: `{apiKeyId, conversationId, branch, guideId?, scratchpad?}` | Read or replace        |

The five-layer `metadata.totalSkills = 42` count in the Agent Card is unchanged — these four tools are scoped to the `memory` MCP scope (see `OMNIROUTE_MCP_SCOPES`).

## A2A Skills

The A2A skill set is **preserved with the `memory` capability removed from each skill**. The five built-in skills (`smart-routing`, `quota-management`, `provider-discovery`, `cost-analysis`, `health-report`) keep their existing handlers but no longer inject memory into their internal LLM calls. See [A2A-SERVER.md](./A2A-SERVER.md) § "Built-in skills" — the row count (6 skills) and `metadata.totalSkills = 42` are unchanged.

## CLI commands

The v3.x `omniroute memory ...` commands are replaced by layer-scoped commands:

```
omniroute memory l0 list  --api-key <id> [--conversation <id>] [--limit 100]
omniroute memory l1 list  --api-key <id> [--type fact|preference|...]
omniroute memory l1 upsert --api-key <id> --type <t> --key <k> --content <c>
omniroute memory l2 show  --api-key <id> --conversation <id>
omniroute memory l3 show  --api-key <id> --conversation <id>
omniroute memory regenerate --api-key <id> --conversation <id> --batch <batchId>
omniroute memory distillation dlq [--since <iso>] [--limit 50]
omniroute memory reset   # HARD delete of <DATA_DIR>/memory.db (no prompt)
```

## L1 Types

Seven L1 types, all stored in `memory.db` under the `l1_facts` table:

| Type         | Used for                               | Example                                                  |
| ------------ | -------------------------------------- | -------------------------------------------------------- |
| `preference` | User-stated likes/dislikes/habits      | "User prefers Python for backend work"                   |
| `fact`       | Stable biographical/contextual fact    | "User works at Acme Corp"                                |
| `decision`   | A conclusion the user committed to     | "Decided to use Postgres over MySQL"                     |
| `pattern`    | Recurring behaviour                    | "User usually commits before pushing"                    |
| `profile`    | Aggregated role/skills summary         | "Backend engineer, 5y Python + Go"                       |
| `context`    | Project-scoped, namespaced fact        | "Repo: my-app — uses FastAPI + uv"                       |
| `correction` | User-stated override of a prior memory | "Correction: the API key is in `.env.local`, not `.env`" |

The eighth type — `guide` — is special: it is an L1 row but is fetched via L2 navigation, not the generic L1 user cache-safe path. The `guide` content is multi-section and is injected as a structured system-message block.

## Capturing into L0

L0 capture is **verbatim**: the assistant's visible response text and the user's message text are written as-is, with role tags and timestamps. There is no regex extraction step in the L0 path (the v3.x `extraction.ts` module is gone). Distillation (the only L1 source) is LLM-driven and runs in the background loop above.

When PII redaction is enabled (`PII_REDACTION_ENABLED=true`), the L0 write happens **after** the request-side redaction pass — L0 never contains raw PII when the flag is on. When the flag is off (the default), L0 contains the verbatim text; operators who need redaction must opt in.

## Reset semantics

| Reset path                     | Effect                                                                                                                       |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `omniroute memory reset` (CLI) | Closes all handles, deletes `<DATA_DIR>/memory.db`, recreates schema on next access.                                         |
| `POST /api/memory/regenerate`  | Re-distills one L0 batch; clears its prior L1/L2 contributions; L3 branch retained unless the batch covered the latest turn. |
| `DELETE /api/memory/l1/{id}`   | Deletes one L1 row. Does not affect L0 or L2.                                                                                |
| `PUT /api/memory/l2`           | Replaces the L2 set for one conversation. L1/L0/L3 untouched.                                                                |
| `PUT /api/memory/l3`           | Replaces L3 for one conversation.                                                                                            |

There is no `compact` or `summarize` endpoint. L1/L2 growth is bounded by the L2 cap (≤15/conversation) and by L1 retention; L0 growth is bounded by `MEMORY_L0_RETENTION_DAYS` (default 30).

## Performance

| Layer                   | Read path                                                                          | p50 (local)     | Notes                                                               |
| ----------------------- | ---------------------------------------------------------------------------------- | --------------- | ------------------------------------------------------------------- |
| L0                      | `SELECT … FROM l0_turns WHERE conversation_id = ? ORDER BY turn_id LIMIT ?`        | < 5ms           | Indexed on `(conversation_id, turn_id)`                             |
| L1 FTS5                 | `MATCH ?` on `l1_fts`                                                              | < 10ms          | Default for L1 retrieval; no vector path unless enabled             |
| L1 hybrid RRF           | FTS5 + sqlite-vec, RRF k=60                                                        | 15-40ms         | Only when an embedding source is configured                         |
| L2                      | `SELECT … FROM l2_nav WHERE conversation_id = ? ORDER BY activation DESC LIMIT 15` | < 3ms           | Cap is enforced by `LIMIT 15`                                       |
| L3                      | `SELECT … FROM l3_working WHERE (api_key_id, conversation_id) = ?`                 | < 2ms           | Singleton index                                                     |
| Background distillation | Per-batch LLM call                                                                 | model-dependent | Concurrency capped by `MEMORY_DISTILLATION_CONCURRENCY` (default 2) |

## See Also

- [SKILLS.md](./SKILLS.md) — `skillsEnabled` continues to inject tool definitions independently of memory.
- [MCP-SERVER.md](./MCP-SERVER.md) — MCP transport, scopes, and the four memory tools above.
- [API_REFERENCE.md](../reference/API_REFERENCE.md) — broader API surface, including the new four-layer routes.
- [A2A-SERVER.md](./A2A-SERVER.md) — built-in skills (memory capability removed; surface otherwise unchanged).
- [Environment](../reference/ENVIRONMENT.md#18-memory-engine) — environment variables for the memory subsystem.
- Source modules:
  - `src/lib/memory/db.ts` — standalone `memory.db` open + WAL + reset
  - `src/lib/memory/l0.ts`, `l1.ts`, `l2.ts`, `l3.ts` — layer CRUD
  - `src/lib/memory/inject.ts` — L3+L2+L1 injection pipeline
  - `src/lib/memory/distill/` — selector chain + batch runner + DLQ
  - `src/lib/memory/noMemory.ts` — header + internal-marker check
  - `src/lib/memory/vectorStore.ts` — opt-in sqlite-vec hybrid (RRF k=60); loaded only when an embedding source is configured
  - `src/lib/db/migrations/` — `memory_*` prefix migrations
  - `src/app/api/memory/{l0,l1,l2,l3,regenerate,distillation-model,distillation/dlq}/route.ts`
  - `open-sse/handlers/chatCore.ts` — capture/injection wiring
  - `open-sse/handlers/chatCore/headers.ts::isNoMemoryRequested`
  - `open-sse/handlers/chatCore/internalMarker.ts`
  - `open-sse/mcp-server/tools/memoryTools.ts` — four layer-scoped tools

---

## Choosing an Embedding Source (v4.0)

L1 retrieval defaults to **FTS5 only** — no embedding model, no vector path, no download. Operators who want hybrid (FTS5 + sqlite-vec + RRF k=60) must configure an embedding source. The selector chain mirrors v3.x but the default has changed:

| Source               | Latency         | Cost                 | Quality                       | Setup              |
| -------------------- | --------------- | -------------------- | ----------------------------- | ------------------ |
| **(none — default)** | FTS5 only, <5ms | Free                 | Good for exact/lexical recall | None               |
| `transformers`       | ~50-150ms (CPU) | Free                 | Good                          | `npm install` only |
| `static`             | <1ms            | Free                 | N/A (cache hit)               | None               |
| `remote`             | ~100-300ms      | $0.02-0.10/1M tokens | Excellent                     | API key            |

When `(none)` is selected, hybrid RRF degrades to pure FTS5 (the `vec_memories` table is not created). The k=60 RRF constant is unchanged.

## RRF Tuning (k=60)

The RRF formula is unchanged from v3.x. Hybrid retrieval is opt-in and only kicks in when both an embedding source and the `MEMORY_ENABLE_VECTOR` flag (default `false`) are set. Operators should leave vector retrieval off unless they have a specific recall need; FTS5 alone covers the L1 user cache-safe path.

## Reset & Export (one-shot)

Operators with pre-v4.0 memory state can run **before** booting v4.0:

```bash
node scripts/memory/export-v3-memory.mjs > ./memory-v3-export.json
```

This emits a JSON dump of the legacy `memories` table for offline review. v4.0 then wipes the tables on first boot. There is **no in-place migration** — the export script is the only bridge.

The hard reset (`omniroute memory reset` or `POST /api/memory/l3` with no other side effects when followed by deleting `memory.db`) is the only forward migration path.
