---
title: "Adaptive Routing: Routing Events, Quality Feedback & Explainability"
version: 3.8.50
lastUpdated: 2026-08-20
---

# Adaptive Routing: Routing Events, Quality Feedback & Explainability

This document describes the feedback-driven adaptive routing foundation added to
OmniRoute. It is deliberately small: it introduces a typed routing-outcome
channel, an online quality signal that feeds the existing auto-combo scorer, an
optional OpenTelemetry exporter, and an explainability endpoint. It does **not**
replace the existing resilience stack (circuit breaker, connection cooldown,
model lockout, health matrix, autopilot) — it complements it.

## 1. Architectural context

OmniRoute is a data plane with a **request hot path** and a **control/intelligence
plane**. The hot path must stay fast, memory-efficient, asynchronous, resilient and
predictable. Evaluation, quality scoring, experiments and historical analysis belong
to the control plane.

```
AI Agent / IDE
      │
      ▼
┌─────────────────────┐
│    OmniRoute        │   data plane (fast, sync, in-memory)
│  routing / failover │
│  health / guardrail │
│  cache / streaming  │
└──────────┬──────────┘
           │ RoutingEvent (fire-and-forget, ~0.2µs)
           ▼
┌─────────────────────┐
│  Feedback sinks     │   control plane (async, best-effort)
│  quality tracker    │
│  OTel exporter      │
│  explain store      │
└──────────┬──────────┘
           ▼  quality score
      auto-combo scorer
```

### What was already there (audited, not duplicated)

| Concept                             | Existing implementation                                                                            |
| ----------------------------------- | -------------------------------------------------------------------------------------------------- |
| Availability (can we send traffic?) | Circuit breaker (CLOSED/DEGRADED/OPEN/HALF_OPEN, DB-persisted), connection cooldown, model lockout |
| Health reporting                    | `providerHealthMatrix.ts`, `providerHealthAutopilot.ts`                                            |
| Shadow traffic                      | `open-sse/services/combo/shadowRouting.ts`                                                         |
| Guardrails                          | `src/lib/guardrails/` (pre/post hooks)                                                             |
| Exact cache                         | `src/lib/semanticCache.ts` (signature-based)                                                       |
| Evaluators / eval-driven routing    | `src/lib/evals/`, `open-sse/services/evalRouting.ts`                                               |
| Combo decision explainability       | `open-sse/services/combo/decisionTrace.ts`                                                         |
| Dashboard real-time events          | `src/lib/events/eventBus.ts` (UI notification channel, `unknown` payloads, 100-entry history)      |

The routing-event layer is **not** a re-implementation of `eventBus`: that bus is
the dashboard's real-time notification channel (typed _event names_, opaque
payloads, UI consumers). `RoutingEvent` is a typed _outcome_ struct
(latency/tokens/cost/outcome/finish-reason) consumed by the control plane's
feedback sinks (quality tracker, OTel exporter, explain store).

### What was missing (added here)

1. A **typed routing-outcome event + sink abstraction** (`RoutingEvent` /
   `RoutingEventSink`). `decisionTrace` is combo-scoped and in-memory-only;
   `comboMetrics` are cumulative counters; `call_logs` is raw async persistence.
   None is a typed, sink-based outcome channel that a quality tracker, an OTel
   exporter, or a Future-AGI-style evaluator can subscribe to.
2. An **online quality signal** (EWMA) for output quality — the scorer previously
   proxied "quality" only through static task fitness and opt-in eval pass-rates.
3. An **optional, dependency-free OTel exporter** using GenAI semantic conventions.
4. An **explainability endpoint** returning the real routing decisions + quality state.

## 2. Routing Events (feedback foundation)

Files: `open-sse/services/routing/events.ts`, `.../index.ts`

A `RoutingEvent` carries only routing metadata:

```ts
interface RoutingEvent {
  requestId: string;
  provider: string;
  model: string;
  strategy: string; // "auto" | "priority" | "direct" | ...
  latencyMs: number;
  ttftMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cost: number | null;
  retries: number;
  fallbackUsed: boolean;
  outcome: RoutingOutcome; // allowlisted union
  status: number | null;
  finishReason: string | null;
  connectionId: string | null;
  ts: number;
}
```

`RoutingEventSink` is a `Send+Sync`-style trait in TypeScript:

```ts
interface RoutingEventSink {
  readonly name: string;
  record(event: RoutingEvent): void; // must be O(1), no sync I/O
}
```

The hot path calls `emitRoutingEvent(event)` once per completed request
(the streaming-completion callback, the non-streaming success path, and the
malformed-200 failure path in `handleChatCore`). Dispatch is synchronous fan-out
to registered sinks, but each sink only enqueues/updates in-memory state. **No
synchronous database writes, no network I/O on the hot path.**

Default sinks:

- `MemoryRoutingEventStore` — bounded (500) ring buffer, newest-first, for the
  explain endpoint.
- `QualityTracker` consumer — updates the EWMA quality estimate.
- `OtlpHttpsEventSink` — optional, enabled only when `OMNIROUTE_OTEL_ENDPOINT`
  (or `OTEL_EXPORTER_OTLP_ENDPOINT`) is set.

### Measured overhead

`npm run bench:routing-events` on this workstation:

| Operation                          | Cost        |
| ---------------------------------- | ----------- |
| `dispatchRoutingEvent` (2 sinks)   | ~0.09 µs/op |
| `recordQualityEvent` (EWMA)        | ~0.07 µs/op |
| `MemoryRoutingEventStore.insert`   | ~0.03 µs/op |
| `calculateScore` w/ quality factor | ~0.04 µs/op |

Total added hot-path cost is **~0.2 µs per request** — negligible against a
single upstream LLM round-trip.

## 3. Quality Signal (feedback-driven provider state)

Files: `open-sse/services/routing/quality.ts`

Per-(provider, model) EWMA state:

- `successEwma` — EWMA (α=0.2) of outcome success.
- `latencyEwma` / `ttftEwma` — EWMA of latency (α=0.1).
- `samples`, `anomalies` — bounded counters.

Signals folded in:

- HTTP 4xx/5xx and connection-level failures (score → 0)
- 429 rate-limits (transient, score → 0.5, not a hard failure)
- malformed responses and stream interruptions (anomaly penalty)
- `finish_reason = "length"` (truncated output) — anomaly
- zero-output "successes" (`output_tokens = 0`) — anomaly
- latency vs a soft 60 s ceiling (capped 0.2 penalty)

`getQualityScore(provider, model)` returns `[0,1]`; before `MIN_QUALITY_SAMPLES`
(5) events it returns neutral `1.0` so cold models are never penalized.

This feeds the auto-combo scorer as the new `quality` scoring factor:

- `ScoringFactors.quality`, `ScoringWeights.quality` added in
  `open-sse/services/autoCombo/scoring.ts`.
- `DEFAULT_WEIGHTS`: `health` 0.1905 → 0.1605, `quality` 0.03. Sum stays 1.0.
- `buildAutoCandidates` populates `candidate.quality` from the tracker; candidates
  without data default to neutral 1.0.

The closed loop:

```
RoutingEvent → QualityTracker → getQualityScore → auto-combo quality factor
      ↑                                                      │
      └────── request outcome (handleChatCore) ←────────────┘
```

A model that "succeeds" but keeps returning truncated/empty/malformed output
gradually scores lower and is de-preferenced — while the circuit breaker still
handles hard availability failures. Both layers work together; neither replaces
the other.

## 4. OpenTelemetry / GenAI observability

Files: `open-sse/services/routing/otel.ts`

- Dependency-free OTLP/HTTP JSON exporter (uses global `fetch`, no
  `@opentelemetry/*` SDK).
- Spans follow GenAI semantic conventions (`gen_ai.provider.name`,
  `gen_ai.request.model`, `gen_ai.usage.input_tokens/output_tokens`,
  `gen_ai.completion.finish_reason`, `gen_ai.system`) plus OmniRoute routing
  attributes (outcome, status, ttft, retries, fallback).
- `record()` only enqueues into a bounded buffer (O(1)); a background timer
  flushes via `POST {endpoint}/v1/traces` asynchronously. Under overload the
  oldest events are dropped (`dropped` counter) — never backpressure the data
  plane.
- **Disabled unless configured.** `OMNIROUTE_OTEL_ENDPOINT` (or
  `OTEL_EXPORTER_OTLP_ENDPOINT`) must be set; otherwise the sink is not
  registered and zero OTel code runs.

## 5. Explainability

- `GET /v1/explain/routing` returns the recent `RoutingEvent`s (the real
  decisions, newest first) and the per-provider/model quality snapshot.
- Auth mirrors `/v1/combos` (Bearer API key or dashboard session; anonymous on
  single-user local deployments with `REQUIRE_API_KEY=false`).
- Combo-level per-invocation traces remain available via the existing
  `decisionTrace.ts` (header `X-OmniRoute-Combo-Trace`).
- Safety: events carry only routing metadata, never prompts/bodies/credentials.

## 6. Evaluation-plane integration (Future AGI readiness)

OmniRoute treats Future AGI (or any evaluator) as a **potential
intelligence/evaluation backend, not a dependency**. The seams:

- A `RoutingEventSink` can forward events to an evaluator asynchronously.
- The `MemoryRoutingEventStore` + quality snapshot give an evaluator the raw
  decision stream.
- A future `Evaluator` (deterministic, local judge, HTTP, WASM) would consume
  events/traces and return a `QualityScore` that feeds the same
  `getQualityScore`/quality-factor path.
- Existing eval-driven routing (`open-sse/services/evalRouting.ts`) already
  re-orders combo targets by `eval_runs` pass-rates when enabled.

No evaluation runs synchronously on the request path, and the gateway operates
fully with the evaluator absent.

## 7. Final architectural review

1. **What remains on the synchronous hot path?** Routing/scoring, guardrail
   pre-checks, cache lookup, and one `emitRoutingEvent` fan-out (~0.2 µs) to
   in-memory sinks.
2. **What moved to asynchronous processing?** OTel export (timer + fetch),
   `call_logs`/usage persistence, semantic-cache writes, quality is in-memory
   and O(1) (no async needed).
3. **How does a routing outcome become feedback?** `handleChatCore` emits a
   `RoutingEvent` → `QualityTracker` updates EWMA state → `getQualityScore`
   feeds the auto-combo `quality` factor.
4. **How does quality influence future routing?** A low quality score reduces
   the weighted score of that provider/model in `scoreAutoTargets`, so degraded
   models are gradually de-preferenced and recover as their EWMA improves.
5. **How can Future AGI integrate without becoming a dependency?** Via the
   `RoutingEventSink` interface / a future `Evaluator` adapter — no hardcoded
   dependency.
6. **What happens when the evaluator is unavailable?** Routing is unaffected;
   quality falls back to neutral (1.0) for models with no observed signal.
7. **What happens when telemetry is unavailable?** The OTel sink simply isn't
   registered; the rest of the routing layer runs unchanged.
8. **What happens under overload?** The OTel buffer drops oldest events; quality
   and the ring buffer are bounded by construction; no backpressure.
9. **How does provider state recover after degradation?** EWMA re-converges as
   successes accumulate; warmup keeps cold models neutral; the circuit breaker
   independently recovers via HALF_OPEN probes.
10. **Which proposed features were intentionally NOT implemented, and why?**
    - Shadow traffic / experiments — already implemented
      (`combo/shadowRouting.ts`); not re-built.
    - Guardrails — already implemented (`src/lib/guardrails/`); not duplicated.
    - Semantic cache — already implemented (`src/lib/semanticCache.ts`); not
      duplicated.
    - A full experiment-management platform, dataset tooling, prompt-optimization
      platform, vector DB, or mandatory external OTel infrastructure — out of
      scope for a lean data plane.
    - A Rust `RoutingEvent` struct — the data plane is TypeScript; the TS type
      is the adapted equivalent.

## 8. Configuration reference

| Variable                      | Default     | Effect                                                                          |
| ----------------------------- | ----------- | ------------------------------------------------------------------------------- |
| `OMNIROUTE_OTEL_ENDPOINT`     | unset       | When set, enables the OTLP/HTTP traces exporter (e.g. `http://collector:4318`). |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | unset       | Fallback alias for the OTLP endpoint.                                           |
| `OTEL_SERVICE_NAME`           | `omniroute` | `service.name` resource attribute.                                              |

## 9. Tests

- `tests/unit/routing-events.test.ts` — event normalization, status
  classification, bounded ring buffer, sink fan-out + isolation.
- `tests/unit/routing-quality.test.ts` — EWMA warmup, failure/success recovery,
  anomaly penalties, 429 transient handling, snapshot, reset.
- `tests/unit/routing-scoring-quality.test.ts` — weight integrity, neutral
  default, quality factor ranking.
- `tests/unit/routing-otel.test.ts` — enable gating, GenAI span payload, async
  flush, drop-under-overload.
