# OmniRoute × S3 Intelligence Governor Architecture

## 1. Overview & Architectural Vision

The **Intelligence Governor** establishes a clean, provider-neutral architectural boundary inside OmniRoute. It prepares OmniRoute to interface with a future **S3 Adaptive Intelligence Runtime** without modifying OmniRoute's core routing engine or breaking upstream compatibility.

```
                     INCOMING REQUEST
                            │
                            ▼
          INTELLIGENCE GOVERNOR (Shadow Mode Evaluation)
                            │
              ┌─────────────┼─────────────┐
              ▼             ▼             ▼
            MODEL       REASONING      CONTEXT
            POLICY       POLICY         POLICY
              │             │             │
              └─────────────┼─────────────┘
                            ▼
                  BOUNDED TELEMETRY ENQUEUE
                            │
                            ▼
       AUTHORITATIVE OMNIROUTE ROUTING ENGINE (Unmutated)
                            │
                            ▼
                  PROVIDER ADAPTER / EXECUTION
```

---

## 2. Core Interfaces & Provider Neutrality

The Intelligence Governor operates strictly on provider-neutral abstractions defined in `open-sse/governor/types.ts`:

- `GovernorInput`: Standardized evaluation context (prompt token estimates, task classification, context utilization, tool counts, retry counts, quota state, latency state, cache state).
- `GovernorDecision`: Comprehensive recommendation policies (`modelPolicy`, `routingPolicy`, `reasoningPolicy`, `compressionPolicy`, `contextBudgetPolicy`, `maxOutputTokens`, `escalationPolicy`).
- `GovernorTelemetry`: Metadata record storing correlation IDs, timestamps, mode, known provider/model metrics, and governor recommendations. Unknown execution outcomes remain nullable.
- `IntelligenceGovernor`: The core contract interface implemented by decision engines.

---

## 3. Deterministic NativeOmniGovernor V0

The initial implementation (`NativeOmniGovernor`) is a deterministic, local fast-path decision engine:

- **Zero LLM Calls**: Requires NO external network requests or AI model invocations to produce recommendations.
- **Task Classification**: Deterministically categorizes requests into `trivial_control`, `tool_output_processing`, `code_edit_simple`, `code_debug`, `architecture_reasoning`, or `unknown`.
- **Pure Mathematical Evaluation**: Identical `GovernorInput` yields the same `GovernorDecision`.
- **Measured Local Overhead**: See the synthetic in-process benchmark for warmup, repeated runs, and median throughput. It is not an end-to-end performance claim.

---

## 4. Shadow Mode & Upstream Safety

- **Default Off**: Governed by feature flag `INTELLIGENCE_GOVERNOR_MODE` (`"off"` | `"shadow"`, default `"off"`).
- **Shadow Mode Contract**:
  - `ROUTING_SELECTION_CHANGED = NO`
  - `SHADOW_CAN_MUTATE_ROUTING = false`
- In `shadow` mode, the governor evaluates recommendations and enqueues bounded best-effort telemetry. Active request execution is not changed by governor recommendations, although shadow evaluation can add local CPU, memory, and scheduling overhead.

---

## 5. Telemetry & Privacy Audit

Telemetry is stored in the local SQLite table `governor_telemetry` (`src/lib/db/governorTelemetry.ts`):

- **Strict Metadata-Only Storage**: Absolutely NO API keys, bearer tokens, passwords, prompt content, or model response text are stored.
- **Fail-Safe Design**: Telemetry database write failures are caught silently and NEVER impact an active AI request.

---

## 6. Future S3 Integration Modes

When the S3 Adaptive Intelligence Runtime becomes available, OmniRoute will support three pluggable integration patterns without altering `chatCore`:

### Mode A: Native In-Process FFI

- Node.js native binding (`napi` / C-FFI) invoking S3 shared library (`s3_governor.dll` / `libs3_governor.so`).
- Lowest latency (< 100 µs), direct shared-memory evaluation.

### Mode B: Local Process IPC

- Independent local process spawned alongside OmniRoute, communicating via Unix Domain Sockets or Windows Named Pipes.
- Strong memory isolation; process crashes do not crash the Node.js main thread.

### Mode C: Service / Container Sidecar

- S3 Governor deployed as a standalone container or sidecar service accessible via HTTP REST or gRPC.
- Best suited for distributed Kubernetes or cloud-native deployments.

---

## 7. Verification & Harness Tools

- **Benchmark Suite**: `scripts/governor/benchmark.ts` (10,000 synthetic decisions).
- **Offline Evaluation**: `scripts/governor/evaluateHarness.ts` (replays telemetry records to compare active vs recommended policies).
- **Unit Test Suite**: `tests/unit/governor/*.test.ts` (determinism, isolation, privacy, metric math, overhead).
