<!-- BEGIN SERPENT-AGENTS -->

# AGENTS.md — Serpent OS / Agent OS

## 🎯 Mission

Solo founder. Consolidate AI agents ecosystem into `huivrotiki/serpentos`.

## 🧭 Map

- `serpentos` (monorepo).
- `OmniRoute` (Cloud Run west3).

## 👤 Roles

- Claude (Opus) = command center.
- Delegates (opencode, OmniRoute, NVIDIA NIM).

## ⚙️ Infra

- GCP: project-f91a723f-af1b-4dd2-ba3, europe-west3.
- Secrets: Doppler `serpent` / config `prd`.

## 🛡️ Rules

- NEVER npm — ALWAYS pnpm.
- NEVER hardcode secrets.
- NEVER push to main directly.

## 🔗 Links

See .claude/rules/ and .agents/skills/ for details.
<!-- END SERPENT-AGENTS -->

# omniroute — Agent Guidelines

## Project

Unified AI proxy/router — route any LLM through one endpoint. Multi-provider support with 290 provider entries (OpenAI, Anthropic, Gemini, DeepSeek, etc).
Live counts (v3.8.49): providers 290 · MCP tools 104 · MCP scopes 30 · A2A skills 6 · DB modules 95 · DB migrations 110.

## Doc Accuracy Discipline

- **If `grep -rn "name" src/ open-sse/ bin/` returns nothing, the name does not exist. Do not document it.**
- Verified by `npm run check:fabricated-docs`.
- Every claim in a `.md` file under `docs/` should be verifiable against the source.

## Stack

- **Runtime**: Next.js 16 (App Router), Node.js `>=22.0.0 <23 || >=24.0.0 <27`, ES Modules (`"type": "module"`)
- **Language**: TypeScript 6.0 (`src/`) + JavaScript (`open-sse/`, `electron/`)
- **Database**: better-sqlite3 (SQLite) — `DATA_DIR` configurable, default `~/.omniroute/`
- **Streaming**: SSE via `open-sse` internal workspace package
- **Styling**: Tailwind CSS v4
- **i18n**: next-intl with 42 locales (`src/i18n/messages/`)

## Build, Lint, Test

- `pnpm run dev` — Start Next.js dev server
- `pnpm run build` — Production build: `next build` → `.build/next/` + assemble `dist/`
- `pnpm run check` — Run lint + test
- Pipeline is a single `next build` pass — intermediates land in `.build/next/`, assembled bundle in `dist/`.
- Tests run via `node --import tsx/esm --test`. Coverage >60%.

## Code Style

- 2 spaces, semicolons required, double quotes, 100 char width.
- TypeScript: `strict: false`, ES2022, bundler resolution.
- ESLint: Never use `eval()`, `new Function()`.
- Error Handling: Use specific error types; return proper HTTP status codes.
- Security: NEVER commit secrets, validate inputs with Zod, use specific error types.

## Architecture

- **Data Layer (`src/lib/db/`)**: 95 domain-specific modules. Core handles better-sqlite3 instance. Never raw SQL in routes.
- **API Route Layer (`src/app/api/v1/`)**: App Router, CORS -> Zod -> Auth -> open-sse delegation.
- **Request Pipeline (`open-sse/`)**: Semantic cache -> Rate limit -> Combo routing -> Translate -> Executor -> Translate -> Response.
- **Executors (`open-sse/executors/`)**: Base executor handles retry/backoff.
- **Combo Routing (`combo.ts`)**: 17 strategies including round-robin, P2C, random, etc.
- **MCP Server**: 104 tools (core, cache, compression, 1proxy, memory, skills, gamification, etc). Transport: stdio, SSE, HTTP.
- **A2A Server**: JSON-RPC 2.0, SSE streaming, Task Manager.
- **Compression**: RTK and Caveman engines. Modular prompt compression. Proactive context management.
- **Memory**: Persistent conversational memory across sessions.
- **Skills**: Extensible skill framework: registry, executor, sandbox.
- **Cloud Agents**: Persisted tasks, mgmt auth required. Includes codex-cloud, devin, jules.
- **Guardrails**: pii-masker, prompt-injection, vision-bridge. Opt-in and fail-open.
- **Evals**: Generic eval framework.
- **Webhooks**: HMAC-signed delivery, exponential backoff.
- **Reasoning Replay**: Hybrid in-memory + SQLite cache for reasoning content. Re-injects on multi-turn.

## Tunnels & Infra

- GCP Region: `europe-west3`
- Tooling uses Cloudflare, ngrok, Tailscale Funnel. `docs/ops/TUNNELS_GUIDE.md` for config.

## Review Focus

- DB ops go through `src/lib/db/`.
- Provider requests flow through `open-sse/handlers/`.
- No memory leaks in SSE streams.
- All API inputs validated with Zod schemas.
- Provider constants validated at module load via Zod.
- NEVER close a contributor's PR without merging. See `.agents/workflows/review-prs.md` for policy.
