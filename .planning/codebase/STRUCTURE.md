# Codebase Structure

**Analysis Date:** 2026-08-14

## Directory Layout

```
OmniRoute/
├── src/                           # Next.js 16 application
│   ├── app/                       # Next.js App Router
│   │   ├── api/v1/                # OpenAI-compatible API endpoints (40+ routes)
│   │   │   ├── chat/completions/
│   │   │   ├── embeddings/
│   │   │   ├── images/
│   │   │   ├── audio/
│   │   │   ├── models/
│   │   │   ├── combos/
│   │   │   ├── batches/
│   │   │   ├── agents/
│   │   │   ├── _shared/           # Shared middleware + helpers
│   │   │   └── [...omnirouteCatchAll]/
│   │   ├── (dashboard)/           # User dashboard UI
│   │   ├── a2a/                   # Agent-to-Agent protocol
│   │   ├── api/monitoring/        # Health, status, metrics
│   │   ├── auth/                  # OAuth callbacks
│   │   ├── docs/                  # OpenAPI, provider catalog
│   │   └── [error codes]/         # 400, 401, 403, 408, 429, 500, 502, 503
│   ├── lib/                       # Core business logic (130+ modules)
│   │   ├── db/                    # SQLite domain modules (145 migrations)
│   │   │   ├── core.ts            # DB singleton + transaction handling
│   │   │   ├── migrations/        # Idempotent SQL migrations
│   │   │   ├── apiKeys.ts         # Credential management
│   │   │   ├── combos.ts          # Multi-target routing configs
│   │   │   ├── settings.ts        # Global + per-account settings
│   │   │   ├── circuitBreakers.ts # Provider breaker state
│   │   │   └── [100+ other modules]
│   │   ├── a2a/                   # Agent-to-Agent protocol
│   │   │   ├── skills/            # 5 agent skills
│   │   │   ├── taskExecution.ts
│   │   │   └── protocols.ts
│   │   ├── memory/                # Persistent conversational memory
│   │   │   ├── fts5/              # Full-text search
│   │   │   ├── qdrant/            # Vector embeddings
│   │   │   └── retrieval.ts
│   │   ├── skills/                # Sandboxed skill framework
│   │   │   ├── executor.ts
│   │   │   ├── sandbox.ts
│   │   │   └── registry.ts
│   │   ├── guardrails/            # Security: PII, injection, vision
│   │   │   ├── piiMasker.ts
│   │   │   ├── promptInjectionGuard.ts
│   │   │   └── visionSafety.ts
│   │   ├── oauth/                 # OAuth2 provider integrations
│   │   │   ├── providers/         # 20+ OAuth providers
│   │   │   └── tokenRefresh.ts
│   │   ├── cloudAgent/            # Cloud agent integrations (Codex, Devin, Jules)
│   │   ├── evals/                 # Evaluation framework
│   │   ├── compliance/            # Audit + legal compliance
│   │   ├── cacheLayer.ts          # Redis/in-memory cache abstraction
│   │   ├── webhookDispatcher.ts   # Event webhooks
│   │   └── [100+ other modules]
│   ├── domain/                    # Policy engine
│   │   ├── models/                # Model registry + capabilities
│   │   ├── providers/             # Provider configuration
│   │   ├── fallback/              # Fallback routing logic
│   │   └── cost/                  # Cost calculation rules
│   ├── sse/                       # Server-sent events / streaming
│   │   ├── handlers/              # Request processing
│   │   │   ├── chat.ts
│   │   │   ├── embeddings.ts
│   │   │   └── [2+ other handlers]
│   │   └── services/              # Streaming-specific services
│   ├── shared/                    # Shared utilities (external & internal)
│   │   ├── constants/             # providers.ts, upstreamHeaders.ts, etc.
│   │   ├── utils/                 # cors.ts, requestId.ts, error.ts, etc.
│   │   ├── middleware/            # chatBodyAdmission.ts, etc.
│   │   └── resilience/            # Circuit breaker, rate limit base
│   ├── server/                    # Backend infrastructure
│   │   └── authz/                 # Route guard, authorization checks
│   ├── types/                     # Global TypeScript types
│   ├── models/                    # TypeScript model definitions
│   ├── store/                     # Client-side state (dashboard)
│   ├── hooks/                     # React hooks (dashboard)
│   ├── mitm/                      # Man-in-the-middle proxy (tunnel mode)
│   │   ├── cert/                  # Certificate generation + installation
│   │   └── proxy.ts
│   ├── middleware.ts              # Next.js middleware
│   ├── scripts/                   # Server startup scripts
│   └── i18n/                      # Internationalization
│
├── open-sse/                      # Streaming engine workspace
│   ├── handlers/                  # Request processing (32 modules)
│   │   ├── chatCore.ts            # Main chat handler (5000+ lines)
│   │   ├── chatCore/              # Modular concerns (30+ modules)
│   │   │   ├── requestSetup.ts
│   │   │   ├── semanticCache.ts
│   │   │   ├── idempotency.ts
│   │   │   ├── memorySkillsInjection.ts
│   │   │   ├── guardrailContext.ts
│   │   │   ├── responseHeaders.ts
│   │   │   └── [25+ other modules]
│   │   ├── embeddings.ts
│   │   ├── images.ts
│   │   └── [5+ other handlers]
│   ├── executors/                 # Provider HTTP dispatch (124+ files)
│   │   ├── base.ts                # Base executor pattern (72KB)
│   │   ├── base/                  # Base concerns (headers, reasoning, etc.)
│   │   ├── openai.ts, claude-web.ts, bedrock.ts, ...
│   │   └── [120+ provider-specific executors]
│   ├── translator/                # Format conversion (OpenAI ↔ Claude ↔ Gemini)
│   │   ├── index.ts               # Main translation hub
│   │   ├── request/               # Request normalization
│   │   │   ├── openai/
│   │   │   ├── claude/
│   │   │   ├── gemini/
│   │   │   └── openai-responses/
│   │   ├── response/              # Response synthesis
│   │   ├── helpers/               # schemaCoercion, toolCall, claude, etc.
│   │   └── registry.ts            # Translator lookup
│   ├── services/                  # Business logic (226 modules)
│   │   ├── combo.ts               # Multi-target orchestration
│   │   ├── combo/                 # Combo concerns (15+ modules)
│   │   │   ├── context.ts
│   │   │   ├── comboSetup.ts
│   │   │   ├── sessionStickiness.ts
│   │   │   ├── quotaShareConcurrency.ts
│   │   │   ├── promptCacheAffinity.ts
│   │   │   └── [10+ other modules]
│   │   ├── accountFallback.ts      # Credential selection + resilience (81KB)
│   │   ├── accountFallback/       # Fallback concerns
│   │   ├── autoCombo/             # 14-factor auto-combo scoring (26 modules)
│   │   ├── sessionPool/           # OAuth session pooling
│   │   ├── apiKeyRotator.ts       # Rotating API keys
│   │   ├── accountSemaphore.ts    # Per-connection concurrency
│   │   ├── rateLimitSemaphore.ts  # Global rate limiting
│   │   ├── quotaPreflight.ts      # Quota evaluation
│   │   ├── provider.ts            # Provider capability queries
│   │   ├── [200+ other services]
│   │   └── __tests__/             # Shared service tests
│   ├── transformer/               # Responses API ↔ Chat Completions adapter
│   │   ├── responsesTransformer.ts
│   │   └── toResponses.ts
│   ├── utils/                     # Utilities (98 modules)
│   │   ├── stream.ts              # Stream composition
│   │   ├── error.ts               # Error building + sanitization
│   │   ├── cors.ts                # CORS headers
│   │   ├── headers.ts             # Header normalization
│   │   ├── usageTracking.ts       # Token usage
│   │   ├── requestLogger.ts       # Structured logging
│   │   ├── [90+ other utils]
│   ├── config/                    # Configuration (56 modules)
│   │   ├── constants.ts           # HTTP status, timeout, thresholds
│   │   ├── providerRegistry.ts    # Model registry + capabilities
│   │   ├── providers/             # Per-provider configs
│   │   ├── anthropicHeaders.ts
│   │   ├── [50+ other configs]
│   ├── mcp-server/                # MCP protocol server (105 tools, 31 scopes)
│   │   ├── tools/                 # 43 base tools + modular tools
│   │   │   ├── memory/
│   │   │   ├── skill/
│   │   │   ├── agentSkill/
│   │   │   ├── pool/
│   │   │   ├── notion/
│   │   │   ├── obsidian/
│   │   │   ├── gamification/
│   │   │   ├── plugin/
│   │   │   └── [base tools]
│   │   ├── transports/            # stdio, SSE, HTTP
│   │   ├── schema.ts              # Tool schema validation
│   │   └── server.ts              # Server entry point
│   ├── lib/                       # Shared libraries
│   │   ├── baseExecutor.ts
│   │   └── [other lib modules]
│   ├── shared/                    # Shared in open-sse
│   └── vendor/                    # Vendored dependencies
│
├── electron/                      # Desktop application
│   ├── src/
│   ├── main/
│   └── preload/
│
├── tests/                         # Test files (all tests here, NEVER in src/)
│   ├── unit/                      # Unit tests (Node.js test runner)
│   │   ├── services/
│   │   ├── executors/
│   │   ├── translators/
│   │   └── [organized by feature]
│   ├── integration/               # Integration tests (multi-module DB state)
│   ├── e2e/                       # End-to-end (Playwright, UI workflows)
│   └── protocols/                 # MCP + A2A protocol tests
│
├── scripts/                       # Maintenance & build scripts (NEVER at repo root)
│   ├── build/                     # Build helpers
│   ├── check/                     # Quality gates (lint, type, test, cycle detection)
│   ├── dev/                       # Development helpers
│   ├── docs/                      # Documentation generators
│   ├── release/                   # Release workflow
│   ├── ci/                        # CI helpers
│   ├── quality/                   # Quality checks
│   ├── ad-hoc/                    # One-off experimental scripts
│   ├── perf/                      # Performance benchmarks
│   ├── ops/                       # Operations (Docker, deployment)
│   └── [15+ other categories]
│
├── docs/                          # Project documentation
│   ├── architecture/              # ARCHITECTURE.md, RESILIENCE_GUIDE.md, etc.
│   ├── frameworks/                # MCP-SERVER.md, A2A-SERVER.md, etc.
│   ├── routing/                   # AUTO-COMBO.md, REASONING_REPLAY.md
│   ├── security/                  # GUARDRAILS.md, PUBLIC_CREDS.md, etc.
│   ├── reference/                 # API_REFERENCE.md, PROVIDER_REFERENCE.md
│   ├── ops/                       # Operations guides
│   ├── guides/                    # ELECTRON_GUIDE.md, etc.
│   └── diagrams/                  # Mermaid + SVG diagrams
│
├── public/                        # Static assets
├── config/                        # Configuration files
│   ├── quality/                   # ESLint suppressions, etc.
│   └── [other config]
│
├── skills/                        # Skill marketplace
│   └── [skill definitions]
│
├── .planning/                     # GSD planning artifacts (gitignored)
│   ├── codebase/                  # Codebase map (ARCHITECTURE.md, STRUCTURE.md, etc.)
│   └── graphs/                    # Code knowledge graphs
│
├── bin/                           # CLI entry point
│   ├── omniroute.ts               # CLI main
│   └── [CLI sub-commands]
│
├── .github/                       # GitHub workflows + CI/CD
│   └── workflows/
│
├── changelog.d/                   # Changelog fragments (tool-managed)
├── AGENTS.md                      # Project rules (MANDATORY reference)
├── CLAUDE.md                      # Claude Code specifics
├── package.json                   # Root dependencies
├── next.config.mjs                # Next.js configuration
├── tsconfig.json                  # TypeScript configuration
├── eslint.config.mjs              # ESLint rules
└── .env.example                   # Environment template
```

## Directory Purposes

**src/app/api/v1/:**
- Purpose: OpenAI-compatible HTTP endpoints
- Contains: 40+ route handlers following Next.js App Router pattern
- Key files: `route.ts` per endpoint, `_shared/` for shared middleware
- Pattern: Each endpoint has POST handler; some have OPTIONS for CORS preflight

**open-sse/handlers/:**
- Purpose: Request processing logic (cache, rate limit, guardrails, routing)
- Contains: 32 modules; `chatCore.ts` is the central orchestrator
- Key files: `chatCore.ts` (5000+ lines split into 30+ concerns), `embeddings.ts`, `images.ts`
- Pattern: Each handler delegates to `open-sse/services/` and `open-sse/translator/`

**open-sse/executors/:**
- Purpose: Provider-specific HTTP dispatch
- Contains: 124+ executor files (one per provider or provider family)
- Key files: `base.ts` (72KB base class), provider-specific files
- Pattern: Extends `BaseExecutor`, overrides request prep + error classification

**open-sse/translator/:**
- Purpose: Format conversion between OpenAI, Claude, Gemini, Responses
- Contains: Request + response translation pipelines
- Key files: `index.ts` (main hub), `request/` and `response/` subdirs per format
- Pattern: Hub-and-spoke — all formats normalize to internal schema, then to target format

**open-sse/services/:**
- Purpose: Business logic — combo routing, resilience, quota, auth, caching
- Contains: 226 modules covering 15+ cross-cutting concerns
- Key files: `combo.ts` (orchestration), `accountFallback.ts` (resilience), `autoCombo/` (scoring)
- Pattern: Services are stateless functions + in-memory caches; state in DB or transient cache

**src/lib/db/:**
- Purpose: SQLite persistence
- Contains: 130+ domain modules, 145 migrations
- Key files: `core.ts` (DB singleton), per-domain modules like `apiKeys.ts`, `combos.ts`
- Pattern: Each module exports CRUD functions; no raw SQL in routes

**open-sse/mcp-server/:**
- Purpose: MCP protocol server (105 tools, 31 scopes)
- Contains: Tool definitions, transports (stdio, SSE, HTTP)
- Key files: `tools/` (tool implementations), `transports/` (protocol handling)
- Pattern: Tool registered with Zod input schema + async handler

**src/lib/a2a/:**
- Purpose: Agent-to-Agent protocol (JSON-RPC 2.0)
- Contains: 5 agent skills, task execution
- Key files: `skills/`, `taskExecution.ts`, `protocols.ts`
- Pattern: Skill receives task context, returns structured result

## Key File Locations

**Entry Points:**
- `src/app/api/v1/chat/completions/route.ts`: Chat completion endpoint (POST)
- `src/app/api/v1/embeddings/route.ts`: Embeddings endpoint
- `src/app/api/v1/images/generations/route.ts`: Image generation endpoint
- `src/app/api/v1/audio/transcriptions/route.ts`: Audio transcription endpoint
- `bin/omniroute.ts`: CLI entry point
- `open-sse/mcp-server/server.ts`: MCP server bootstrap

**Configuration:**
- `open-sse/config/providerRegistry.ts`: Model + provider registry
- `open-sse/config/constants.ts`: Timeouts, thresholds, HTTP status codes
- `src/lib/db/core.ts`: Database singleton + connection setup
- `src/shared/constants/providers.ts`: Provider ID definitions
- `next.config.mjs`: Next.js build configuration
- `tsconfig.json`: TypeScript configuration

**Core Logic:**
- `open-sse/handlers/chatCore.ts`: Main request orchestrator (5000+ lines)
- `open-sse/services/combo.ts`: Multi-target routing (1000+ lines)
- `open-sse/services/accountFallback.ts`: Credential selection + resilience (81KB)
- `open-sse/executors/base.ts`: Base executor pattern (72KB)
- `open-sse/translator/index.ts`: Format translation hub (1000+ lines)
- `src/lib/guardrails/piiMasker.ts`: PII redaction logic
- `src/lib/guardrails/promptInjectionGuard.ts`: Prompt injection detection

**Testing:**
- `tests/unit/`: Unit tests (Node.js native test runner)
- `tests/integration/`: Integration tests (DB state, multi-module)
- `tests/e2e/`: End-to-end tests (Playwright, UI workflows)
- `tests/protocols/`: MCP + A2A protocol tests

## Naming Conventions

**Files:**
- **camelCase with meaningful suffix**: `chatCore.ts`, `accountFallback.ts`, `promptInjectionGuard.ts`
- **Directory-based organization**: Group related files in subdirs (e.g., `chatCore/` for concerns, `combo/` for strategy)
- **Modular concerns**: Break large files at 1500-2000 lines into `fileName/` + `fileName/concern.ts` pattern
- **Tests**: `*.test.ts` or `*.spec.ts` suffix; always in `tests/` directory

**Directories:**
- **kebab-case for route paths**: `/api/v1/chat/completions` (not `/chat-completions/`)
- **camelCase for business logic dirs**: `open-sse/handlers/`, `src/lib/db/`
- **UPPERCASE for global config**: `public/`, `scripts/`, `docs/`
- **Grouped by concern**: `open-sse/services/combo/`, `open-sse/handlers/chatCore/`

**Functions:**
- **camelCase verbs**: `handleChat`, `translateRequest`, `getExecutor`, `checkFallbackError`
- **Booleans prefixed with is/should/has**: `isModelScope`, `shouldUseFusion`, `hasThinkingConfig`
- **Async prefixed with get/fetch/resolve**: `getExecutor`, `fetchCodexQuota`, `resolveComboConfig`

**Types/Constants:**
- **PascalCase for types**: `ProviderConfig`, `ComboContext`, `ComboDiagnostics`
- **UPPER_SNAKE for constants**: `HTTP_STATUS`, `FETCH_TIMEOUT_MS`, `COMBO_FAILURE_THRESHOLD`
- **Descriptive enum names**: `ComboStrategy`, `ErrorClassification`, `ModelLockoutReason`

## Where to Add New Code

**New LLM Provider Support:**
1. **Provider executor**: Create `open-sse/executors/yourprovider.ts` extending `BaseExecutor`
   - Override: `async execute()`, error classification logic
   - Export as default: `export default class YourProviderExecutor extends BaseExecutor { }`
2. **Optional translator**: If format is non-OpenAI, create `open-sse/translator/request/yourformat/*.ts` + `response/yourformat/*.ts`
3. **Provider config**: Add entry to `open-sse/config/providerRegistry.ts` with model list
4. **Tests**: Add unit tests in `tests/unit/executors/yourprovider.test.ts`

**New API Endpoint (Chat-like):**
1. **Route handler**: Create `src/app/api/v1/yourfeature/route.ts`
   - Pattern: CORS preflight → Zod body validation → optional auth → delegate to `open-sse/handlers/`
   - Export: `export async function OPTIONS()` + `export async function POST(request)`
2. **Handler**: If new, create `open-sse/handlers/yourfeature.ts`
   - Signature: `export async function handleYourFeature({body, credentials, ...})`
   - Depends on: `open-sse/services/combo`, `open-sse/translator/`, `open-sse/executors/`
3. **Tests**: Add in `tests/unit/endpoints/yourfeature.test.ts`

**New MCP Tool:**
1. **Tool module**: Create `open-sse/mcp-server/tools/yourmodule/yourTool.ts`
   - Define: Input schema (Zod), handler function (async)
   - Export: `export const yourTool = { name, description, inputSchema, handler }`
2. **Registration**: Add to tool registry in tool set creation (tool wiring)
3. **Scope assignment**: Assign scope(s) in registry (e.g., `SCOPE_BASE`, `SCOPE_ADMIN`)
4. **Tests**: Add in `tests/unit/mcp-server/tools/yourmodule.test.ts`

**New Database Module:**
1. **Domain module**: Create `src/lib/db/yourmodule.ts`
   - Import: `getDbInstance()` from `./core.ts`
   - Export: CRUD functions (`insert`, `getBy*`, `update`, `delete`)
   - Use: Transactions for multi-step operations
2. **Migration** (if new table): Create in `src/lib/db/migrations/001_yourmodule.sql` (idempotent)
3. **Re-export**: Add to `src/lib/localDb.ts` export list
4. **Tests**: Add in `tests/unit/db/yourmodule.test.ts`

**New Combo Strategy:**
1. **Strategy function**: Create in `open-sse/services/combo/yourStrategy.ts`
   - Signature: `export function resolveYourStrategyOrder(candidates: ProviderCandidate[], context: ComboContext): ProviderCandidate[]`
   - Return: Ordered list of candidates to try
2. **Registration**: Add to strategy enum + registry in `open-sse/services/comboConfig.ts`
3. **Tests**: Add in `tests/unit/services/combo/yourStrategy.test.ts`

**New Guardrail:**
1. **Guardrail module**: Create `src/lib/guardrails/yourGuardrail.ts`
   - Export: `export function buildYourGuardrailContext(body, credentials, ...): GuardrailContext`
   - Or: `export function applyYourGuardrail(body, request, settings): Promise<Body | GuardrailResponse>`
2. **Wiring**: Add call site in request handler or response processor
3. **Feature flag**: If opt-in, add boolean flag in `src/shared/constants/featureFlagDefinitions.ts`
4. **Tests**: Add in `tests/unit/guardrails/yourGuardrail.test.ts`

**Utilities & Helpers:**
- **Shared helpers**: `src/shared/utils/yourHelper.ts` (used across src/, open-sse/)
- **Stream utils**: `open-sse/utils/yourStreamHelper.ts` (SSE/response composition)
- **Service helpers**: `open-sse/services/yourHelper.ts` (business logic)
- **Test fixtures**: `tests/unit/fixtures/yourFixture.ts` (data builders, mocks)

**Configuration & Constants:**
- **Provider-specific**: `open-sse/config/providers/yourprovider.ts`
- **Global constants**: `open-sse/config/constants.ts` or `src/shared/constants/`
- **Feature flags**: `src/shared/constants/featureFlagDefinitions.ts`
- **Type definitions**: `src/types/` or domain-specific `*.ts` in context

## Special Directories

**scripts/:**
- Purpose: Build, test, check, and utility scripts (NEVER in repo root)
- Generated: No (all hand-maintained)
- Committed: Yes (production use)
- Subdirs: `build/`, `check/`, `dev/`, `docs/`, `release/`, `ci/`, `quality/`, `ad-hoc/`, `perf/`, `ops/`, etc.
- Rule: One-off or experimental scripts go in `scripts/ad-hoc/`; production scripts in appropriate category

**tests/:**
- Purpose: ALL tests (unit, integration, e2e, protocol)
- Generated: No (hand-written + test fixtures)
- Committed: Yes (blocking CI)
- Structure: `tests/unit/`, `tests/integration/`, `tests/e2e/`, `tests/protocols/`
- Rule: NEVER create test files in `src/` root or elsewhere; always `tests/`

**.planning/codebase/:**
- Purpose: Codebase map documents (ARCHITECTURE.md, STRUCTURE.md, CONVENTIONS.md, TESTING.md, CONCERNS.md)
- Generated: Yes (by `/gsd-map-codebase` agent)
- Committed: No (gitignored)
- Use: Input to `/gsd-plan-phase` and `/gsd-execute-phase` for planning context

**_tasks/:**
- Purpose: Separate git repo for planning artifacts (plans, specs, research, hand-offs)
- Generated: Yes (by superpowers skills)
- Committed: Yes (to `_tasks/` remote, not main repo)
- Rule: NEVER tracked in main repo; always under `.gitignore` anchor `/_*/`

**public/:**
- Purpose: Static assets served directly (images, fonts, favicon)
- Generated: No (design assets)
- Committed: Yes
- Served: At root (e.g., `/favicon.ico`)

**docs/:**
- Purpose: Project documentation (architecture, frameworks, security, ops, guides)
- Generated: Partially (provider reference auto-generated)
- Committed: Yes
- Accuracy rule: Only describe verified behavior (run commands, check source before documenting)

**config/:**
- Purpose: Build + ESLint configuration
- Generated: No (hand-maintained)
- Committed: Yes
- Subdir: `config/quality/` contains ESLint suppressions (`eslint-suppressions.json`)

---

*Structure analysis: 2026-08-14*
