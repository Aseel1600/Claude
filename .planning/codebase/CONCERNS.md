# Codebase Concerns

**Analysis Date:** 2026-08-14

## Tech Debt

**TypeScript 7 Migration (ESLint any-budget frozen debt):**
- Issue: Large number of `no-explicit-any` violations allowlisted in `config/quality/eslint-suppressions.json`. Suppressions frozen at migration baseline; new violations are treated as errors but pre-existing ones are suppressed.
- Files: `open-sse/executors/` (deepseek-web.ts: 12, github.ts: 14, t3-chat-web.ts: 11, etc.), `open-sse/handlers/search.ts: 33 suppressions`
- Impact: Code in executors and search handler lacks type safety. New developers cannot see the actual type errors (hidden by suppressions). Refactoring these areas is risky without proper typing.
- Fix approach: Incrementally fix violations in the suppression list. The `npm run lint` applies suppressions; fix genuine violations one file at a time and remove from `eslint-suppressions.json`. Priority: high-traffic executors first (github, deepseek-web).

**Database Schema Evolution (145 migrations):**
- Issue: 145 migrations indicate significant schema churn. Risk of migration ordering issues, late schema corrections, or abandoned schema columns.
- Files: `src/lib/db/migrations/*.sql` (includes DROPs, ALTERs, renames like migration 025 renaming `call_logs` to `call_logs_v1_legacy`)
- Impact: Complex migration history increases risk of (a) rollback failures, (b) production schema drift if migrations run out-of-order, (c) orphaned columns/indexes from dropped tables.
- Fix approach: Audit old migrations (< 2026-01) for abandoned columns still being written to. Consider consolidating old schema into a single "baseline" migration in a future release cycle. Use `npm run db:audit` (if available) to detect unused columns.

**Codex Input Cap Values Unconfirmed (#6191):**
- Issue: Multiple TODO comments indicating unconfirmed input token limits for Codex models.
- Files: `open-sse/config/providers/registry/codex/index.ts:152, 161, 172, 183, 192`
- Impact: If caps are wrong, requests may exceed Codex's actual limits → upstream failures, poor routing decisions in combo strategies. Caps are used for cost estimation and request feasibility checks.
- Fix approach: Pull exact limits from Codex provider documentation or API docs. Verify against live requests in staging. Add regression test asserting caps match upstream docs. Reference issue #6191 for context.

**Large File Complexity (Performance & Maintainability Risk):**
- Issue: Several core files exceed 3000 lines, indicating high cyclomatic complexity and mutation risk.
- Files: `open-sse/handlers/chatCore.ts (5162 lines)`, `open-sse/services/combo.ts (3353 lines)`, `open-sse/executors/chatgpt-web.ts (3239 lines)`, `open-sse/handlers/imageGeneration.ts (3144 lines)`
- Impact: High risk of regressions on edits. Difficult to onboard contributors. Testing coverage struggles to keep pace (e.g., chatCore at 72.45% line coverage, below 80.8% baseline).
- Fix approach: Extract cohesive submodules from chatCore (e.g., semantic cache logic → separate handler; idempotency cache → separate module). Combo strategies could be split into individual strategy files. This is a medium-priority refactor — tackle during slower release cycles.

## Known Bugs

**SSE Snapshot Duplication in Responses API (Documented Learning):**
- Symptoms: When parsing Responses API streaming chunks with final snapshots, text may appear duplicated at the end of the stream if snapshot is processed through rolling delta buffers.
- Files: `open-sse/utils/stream.ts`, `open-sse/handlers/responseSanitizer.ts` (streaming PII transform)
- Trigger: Responses API with `done` or `completed` event containing a final snapshot; PII sanitization or semantic cache storage enabled.
- Workaround: Always parse snapshot text directly (standalone), bypassing delta buffers. This is documented in AGENTS.md § PII & Stream Sanitization Learnings.

**Database Handle Cleanup in Tests:**
- Symptoms: Node.js test runner hangs indefinitely after tests that trigger SQLite migrations or establish connections.
- Files: `tests/unit/*` (any test using `resetDbInstance()`)
- Trigger: Test calls `resetDbInstance()` or opens a DB connection without closing in a `test.after(...)` hook.
- Workaround: Always include `test.after(...)` that calls `resetDbInstance()` and/or closes DB handles. Documented in AGENTS.md § PII & Stream Sanitization Learnings.

## Security Considerations

**ReDoS Risk in PII Pattern Matching (Documented Learning):**
- Risk: Regex patterns matching variable-length strings (IPv6, credit cards, SSNs) can cause catastrophic backtracking on malicious/long inputs when processing untrusted request/response payloads.
- Files: `src/lib/piiSanitizer.ts`, `src/lib/guardrails/piiMasker.ts`, `src/lib/streamingPiiTransform.ts`
- Current mitigation: Patterns must use strictly bounded, non-overlapping sequences (e.g., `{1,7}` limits on repetition) to prevent exponential backtracking. This is a documented convention in AGENTS.md.
- Recommendations: (1) Audit all regex in pii*.ts files for unbounded quantifiers (e.g., `.*`, `+`, `*` without explicit limits). (2) Add ReDoS-specific linting (e.g., `safe-regex` or `eslint-plugin-security`). (3) Test with pathologically long inputs (100KB+ strings) in `tests/unit/pii-*.test.ts`.

**Unsanitized HTML in Docs Route (Properly Mitigated):**
- Risk: `src/app/docs/[...slug]/page.tsx:90` uses `dangerouslySetInnerHTML` to render translated markdown.
- Files: `src/app/docs/[...slug]/page.tsx:67` (sanitizeDocsHtml), `src/lib/docsSanitizer.ts`
- Current mitigation: (a) Path traversal prevention via `resolveSafeI18nSectionDir` (validates locale and slug segments). (b) XSS prevention via `sanitizeDocsHtml()` (DOMPurify on parsed markdown). Guards are present and tested.
- Recommendations: Ensure `sanitizeDocsHtml()` remains strict (allowlist-based). Test with injected script tags in i18n markdown files.

**PII Data Mutation Default (Properly Guarded):**
- Risk: PII redaction/sanitization flags (`PII_REDACTION_ENABLED`, `PII_RESPONSE_SANITIZATION`) could accidentally default to `true`, silently corrupting legitimate operator data in self-hosted deployments.
- Files: `src/shared/constants/featureFlagDefinitions.ts:51, 62`, `tests/unit/pii-opt-in-default.test.ts`
- Current mitigation: Hard Rule #20 requires both flags default to `"false"`. Regression guard test (`pii-opt-in-default.test.ts`) asserts definition defaults + runtime behavior. Any change to defaults requires explicit operator approval.
- Recommendations: Maintain regression guard test. Before any flag default change, announce in release notes + require operator sign-off. The opt-in model is intentional — do not "improve" by enabling by default.

## Performance Bottlenecks

**Chat Handler Streaming Complexity (5162 lines, 72.45% coverage):**
- Problem: `open-sse/handlers/chatCore.ts` orchestrates the entire request pipeline — translation, caching, routing, streaming, error handling — in one module.
- Files: `open-sse/handlers/chatCore.ts`, submodules `open-sse/handlers/chatCore/*.ts`
- Cause: Monolithic handler design simplifies top-level flow but concentrates mutation risk and testing burden.
- Improvement path: Extract cohesive submodules (semantic cache, idempotency, streaming pipeline) into separate handlers. Improve coverage via targeted unit tests on isolated modules. Target coverage improvement from 72.45% to 80%+ via incremental extraction.

**Model Catalog Building & Caching (1707 lines):**
- Problem: `src/app/api/v1/models/catalog.ts` rebuilds the entire provider catalog on request, with caching that uses `setImmediate(resolve)` to defer computation (`line 138`).
- Files: `src/app/api/v1/models/catalog.ts:138`
- Cause: Deferring catalog builds to next event loop tick can cause thundering herd on high concurrency (multiple requests queue up, all build in parallel).
- Improvement path: Switch from `setImmediate` to a proper semaphore-based lock. Pre-compute catalog on startup (if feasible) or use a request-deduplicating promise cache (`Promise.race([outstanding, new Promise(...))`).

**Streaming Error Handling Complexity:**
- Problem: `open-sse/utils/stream.ts` (2921 lines) contains intricate SSE parsing, error translation, and PII sanitization. A single malformed upstream response can trigger multiple error handling paths.
- Files: `open-sse/utils/stream.ts`, `open-sse/handlers/responseSanitizer.ts`, `open-sse/handlers/responseTranslator.ts`
- Cause: Multiple translation layers (format → OpenAI → Responses API) each with error recovery logic that can overlap.
- Improvement path: Consolidate error handling into a single error taxonomy. Add performance monitoring (metrics) on error recovery paths. Profile with upstream 4xx/5xx injection tests.

## Fragile Areas

**Streaming SSE Parser (Multiple Transports: stdio, SSE, HTTP):**
- Files: `open-sse/handlers/sseParser.ts`, `open-sse/services/*/streamHandler.ts` implementations
- Why fragile: SSE parsing must handle incomplete chunks, malformed JSON, encoding edge cases, and EOF detection differently per transport (stdio vs HTTP vs Streamable HTTP). Off-by-one errors in chunk buffering can cause message loss.
- Safe modification: (1) Add integration tests with real upstream providers (GitHub, DeepSeek, Pollinations). (2) Fuzz test SSE parser with pathological inputs (truncated JSON, mixed encodings, duplicate event IDs). (3) Never change SSE line parsing logic without running `npm run test:e2e` against staging upstreams.
- Test coverage: SSE parser has pre-existing suppressions (no-restricted-syntax). Coverage of edge cases (EOF, incomplete chunks) is likely incomplete. Recommend focused integration tests before any refactoring.

**Combo Routing Strategy Selection (19 strategies, 3353 lines):**
- Files: `open-sse/services/combo.ts`, strategy implementations
- Why fragile: 19 routing strategies (priority, weighted, round-robin, fusion, pipeline, etc.) share mutable state (request log, provider health). A regression in one strategy's cost/health calculations affects all others.
- Safe modification: (1) Extract each strategy into a separate file with isolated unit tests. (2) Verify Auto-Combo scoring logic against expected weights (14 factors in `docs/routing/AUTO-COMBO.md`). (3) Run `npm run test:vitest` (covers autoCombo) before touching strategy selection. (4) Use feature flags to A/B test strategy changes on subset of traffic.
- Test coverage: autoCombo coverage at 85.42% (above baseline), but individual strategy coverage gaps exist. Before adding a new strategy, require unit tests demonstrating it handles missing provider health data gracefully.

**Connection Cooldown & Circuit Breaker Interaction (3 layers):**
- Files: `open-sse/services/accountFallback.ts (2066 lines)`, `src/shared/utils/circuitBreaker.ts`, `src/sse/services/auth.ts`
- Why fragile: Three distinct failure mechanisms (provider circuit breaker, connection cooldown, model lockout) must stay separate. A connection that hits multiple layers (e.g., circuit breaker AND cooldown) can create state inconsistencies or missed retry windows.
- Safe modification: (1) Never merge cooldown state into circuit breaker — keep scopes separate per AGENTS.md Resilience Runtime State. (2) Read lazily (use `getStatus()` which refreshes expired state) rather than raw state columns. (3) Add integration tests proving a provider that opens circuit breaker correctly recovers per reset timeout without being stuck in cooldown. (4) Document state transitions in comments (CLOSED → OPEN → HALF_OPEN, separate from rateLimitedUntil timeline).
- Test coverage: accountFallback.ts has high coverage (96.78% lines), but circuit breaker interaction under concurrent failures is likely undertested. Recommend chaos tests: rapid failures on same key while another key recovers.

## Scaling Limits

**SQLite Database Concurrency (Single Writer):**
- Current capacity: OmniRoute uses SQLite (WAL mode) with single-writer semantics. Call logs, usage tracking, and quota state are persisted to SQLite.
- Limit: Under high concurrency (1000+ concurrent /v1/chat/completions requests), SQLite's write queue can become a bottleneck. WAL allows multiple readers + one writer, but a bursty write pattern (e.g., usage updates on every request) will serialize.
- Scaling path: (1) Batch usage updates (flush every N seconds or M requests). (2) Consider a queue-based architecture (write usage to an in-memory queue, flush asynchronously). (3) For production deployments, migrate to PostgreSQL. For now, monitor `database_lock_wait_ms` metrics in call logs.

**MCP Tool Registry Growth (105 tools across 31 scopes):**
- Current capacity: MCP server exposes 105 tools (43 base + plugins). Tool execution is synchronous and runs in a single process thread.
- Limit: Adding many long-running tools (e.g., file I/O, external API calls) can cause timeout/hang if a single tool blocks the event loop. Tool execution is not parallelized.
- Scaling path: (1) Profile tool latency (`npm run test:vitest` includes tool timing). (2) For long-running tools, implement async generators (streaming response). (3) Consider worker-thread isolation for blocking tools. (4) Add execution timeouts per tool (e.g., 30s max).

**Memory (Streaming Buffers & Session State):**
- Current capacity: Long-lived SSE streams and session state (memory vectors, combo execution logs) are kept in process memory. No explicit memory bounds.
- Limit: A single multi-hour SSE stream can accumulate unlimited response chunks in a buffer if the client is slow to consume. Session vectors are not evicted.
- Scaling path: (1) Implement max buffer size per stream (e.g., 10MB). Return 413 Payload Too Large if exceeded. (2) Evict old session vectors from memory (LRU, TTL). (3) Use a separate Redis/in-memory store for session state if scaling beyond single node.

**Catalog Query Complexity (339 providers, dynamic capability overlays):**
- Current capacity: Model catalog (`src/app/api/v1/models/catalog.ts`) joins 339 providers × models with dynamic overlays (radar, custom registry, free-model catalog). Catalog build is O(providers × models).
- Limit: At >10k total models across 339 providers, catalog build time will exceed request SLA (target <500ms). Caching mitigates, but cache invalidation is implicit and adds latency.
- Scaling path: (1) Pre-compute and cache catalog at startup. (2) Lazy-load provider subsets on request (e.g., only populate capability overlays for requested provider). (3) Add metrics tracking catalog build time per provider. (4) Consider splitting catalog into provider-specific endpoints (e.g., `/v1/models?provider=openai`).

## Dependencies at Risk

**better-sqlite3 (SQLite driver) vs Bun:sqlite compatibility:**
- Risk: OmniRoute uses `better-sqlite3` as the authoritative driver for Node.js. A best-effort `bun:sqlite` compatibility path exists (see AGENTS.md) but is not officially supported. Future Bun versions may diverge.
- Impact: If Bun gains significant adoption in the wild, the fallback path may become unmaintained. If better-sqlite3 is deprecated, migration is forced.
- Migration plan: Document the precise Bun:sqlite driver adapter (`src/lib/db/driver.ts` or equivalent) and keep it in sync with bun releases. Alternatively, migrate to `libsql` (open-source, driver-agnostic). For now, the Node.js driver is stable; Bun support is optional.

**marked (Markdown parser) in docs rendering:**
- Risk: `src/app/docs/[...slug]/page.ts` uses `marked` for server-side rendering of i18n markdown. No version pinning guard.
- Impact: Major `marked` version upgrades (e.g., v10 → v11) can change HTML output, breaking docs rendering or introducing unexpected tags.
- Migration plan: Pin `marked` to a major version. Test rendering on version upgrade before merging. Use `sanitizeDocsHtml()` as a defense-in-depth: even if `marked` adds unexpected HTML, sanitizer catches it.

**Open-source LLM Provider SDKs (SDK sprawl):**
- Risk: `open-sse/executors/` implements 30+ provider SDKs manually (not via official SDK; hand-rolled HTTP + format translation). If a provider changes API, executor breaks.
- Impact: Rapid provider churn → executor maintenance burden. Missing features (e.g., new tool calling format) → manual implementation debt.
- Migration plan: Prioritize providers with stable APIs (OpenAI, Anthropic) and maintain hand-rolled versions. For high-churn providers (DeepSeek, T3Chat, local models), use official SDKs if available. For experimental providers, accept higher brittleness; mark as "best-effort."

## Missing Critical Features

**Provider Health Dashboard (Metrics only, no visual feedback):**
- Problem: Operator can query provider health via `/api/monitoring/health`, but dashboard does not surface real-time provider status, circuit breaker state, or connection cooldown timeline.
- Blocks: Operators cannot quickly diagnose why traffic is routing away from a provider without logs. Circuit breaker state is internal (not visible in UI).
- Priority: Medium. Implement a status panel in the dashboard (`src/app/(dashboard)/dashboard/providers/...`) showing: (a) Circuit breaker state per provider. (b) Active cooldowns per connection. (c) Last failure timestamp + error.

**Semantic Similarity Search in Memory (Vector store not fully integrated):**
- Problem: Memory system supports Qdrant for semantic search, but integration is incomplete. Search may require fallback to keyword matching.
- Blocks: Memory recall for high-context tasks is less effective if semantic search is unavailable.
- Priority: Medium. Complete Qdrant integration (`src/lib/memory/`); add fallback behavior if Qdrant is unreachable.

**Rate Limit Header Parsing Standardization (RFC 6585 compliance):**
- Problem: Different providers use different rate-limit headers (`RateLimit-Remaining`, `X-RateLimit-Remaining`, `Retry-After`, provider-specific reset times). Parsing is inconsistent across executors.
- Blocks: Quota-aware routing and retry logic cannot reliably estimate reset times.
- Priority: Medium-High. Standardize rate-limit parsing in `open-sse/utils/rateLimitHeaders.ts` (if exists) or create one. Add tests for each provider's header format.

## Test Coverage Gaps

**chatCore Handler (72.45% line coverage, below 80.8% baseline):**
- What's not tested: Cache validation logic (idempotency, semantic cache), streaming error recovery, composite scenarios (cache hit + streaming + PII sanitization).
- Files: `open-sse/handlers/chatCore.ts`, `open-sse/handlers/chatCore/*.ts` submodules
- Risk: High. chatCore is the critical path for all requests. A regression in error handling or cache logic propagates to all clients.
- Priority: High. Extract and unit-test cache submodules separately. Add integration tests for chatCore → upstream provider → response → streaming flow. Target 85%+ coverage.

**Streaming Parser Edge Cases (SSE + HTTP + Responses API):**
- What's not tested: Truncated JSON in middle of chunk, multiple events in one chunk, UTF-8 encoding errors, missing newlines, empty chunks, upstream connection reset mid-stream.
- Files: `open-sse/handlers/sseParser.ts`, `open-sse/utils/stream.ts`
- Risk: Medium. SSE parser is used for all streaming responses; malformed upstream responses can hang the stream or lose messages.
- Priority: High. Fuzz test SSE parser with pathological inputs. Upstream mutation tests (deliberately break upstream responses) in CI.

**Combo Routing Strategies (Individual strategy tests missing):**
- What's not tested: Fusion strategy with unequal latencies, round-robin fairness under bursty traffic, weighted strategy with zero-weight providers, pipeline strategy with cascading failures.
- Files: `open-sse/services/combo.ts`, individual strategy implementations
- Risk: Medium. A broken strategy silently routes traffic incorrectly; operator may not notice until metrics degrade.
- Priority: Medium. Add unit tests per strategy in `tests/unit/combo/` (e.g., `fusion.test.ts`, `weighted.test.ts`). Use mock providers with controllable latency/failure.

**Connection Cooldown Under Concurrent Failures:**
- What's not tested: (a) Two concurrent requests on same bad connection → cooldown increment (should not double-increment). (b) Anti-thundering-herd guard. (c) Terminal states (banned, expired, credits_exhausted) not overwritten by transient cooldown.
- Files: `open-sse/services/accountFallback.ts`, `src/sse/services/auth.ts::markAccountUnavailable`
- Risk: Medium. Cooldown state corruption could leave a working connection permanently cooldown'd or skip a necessary cooldown.
- Priority: Medium. Add chaos tests simulating 100 concurrent requests on same bad key. Verify cooldown behavior.

**PII Sanitization Regex Patterns (ReDoS injection):**
- What's not tested: Long (1MB+) strings with repeating patterns (e.g., repeated "a" to trigger `.*` backtracking). Patterns that could be malicious (e.g., crafted emails designed to match SSN regex).
- Files: `src/lib/piiSanitizer.ts` regex patterns, `src/lib/streamingPiiTransform.ts`
- Risk: Low-Medium. ReDoS can cause CPU spike on malicious requests. Rare if PII sanitization is opt-in (Hard Rule #20), but high-impact if enabled.
- Priority: Medium. Add property-based tests (e.g., `fast-check`) generating long strings. Profile regex execution time. Add ReDoS-specific linting.

---

*Concerns audit: 2026-08-14*
