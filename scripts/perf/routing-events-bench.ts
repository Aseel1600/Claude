/**
 * Routing feedback foundation benchmark.
 *
 * Measures the per-request overhead of the routing-events hot path introduced
 * by the adaptive-routing work (open-sse/services/routing/*):
 *
 *   1. dispatchRoutingEvent fan-out to N sinks (the exact cost paid by the
 *      request hot path at the end of handleChatCore)
 *   2. QualityTracker record() — the EWMA math fed by every event
 *   3. MemoryRoutingEventStore insert (bounded ring buffer)
 *   4. calculateScore with the new quality factor
 *
 * Goal: keep the added hot-path cost in the microsecond range so the data
 * plane stays fast. Numbers are reported per-op in microseconds; a regression
 * beyond ~10µs/op for dispatch+quality+store on a 64-bit Mac warrants review.
 *
 * Node only. No network, no credentials, hermetic (the routing module has no
 * DB side effects).
 *
 * Usage:
 *   npm run bench:routing-events
 *   npm run bench:routing-events -- --events 100000
 */
import { performance } from "node:perf_hooks";

import {
  dispatchRoutingEvent,
  MemoryRoutingEventStore,
  registerRoutingEventSink,
  type RoutingEvent,
  type RoutingEventSink,
} from "../../open-sse/services/routing/events.ts";
import { recordQualityEvent, getQualityScore } from "../../open-sse/services/routing/quality.ts";
import {
  calculateFactors,
  calculateScore,
  DEFAULT_WEIGHTS,
  type ProviderCandidate,
} from "../../open-sse/services/autoCombo/scoring.ts";

const N = Number(process.argv[2] === "--events" ? (process.argv[3] ?? 100_000) : 100_000);

function makeEvent(i: number): RoutingEvent {
  return {
    requestId: `bench-${i}`,
    provider: i % 2 === 0 ? "openai" : "anthropic",
    model: "bench-model",
    strategy: "auto",
    latencyMs: 120 + (i % 50),
    ttftMs: 40,
    inputTokens: 500,
    outputTokens: 200,
    cost: 0.01,
    retries: 0,
    fallbackUsed: false,
    outcome: i % 100 === 0 ? "malformed" : "success",
    status: 200,
    finishReason: "stop",
    connectionId: null,
    ts: Date.now(),
  };
}

function bench(name: string, iterations: number, fn: (i: number) => void): void {
  // Warmup
  for (let i = 0; i < Math.min(10_000, iterations); i++) fn(i);
  const start = performance.now();
  for (let i = 0; i < iterations; i++) fn(i);
  const elapsedMs = performance.now() - start;
  const perOpUs = (elapsedMs * 1000) / iterations;
  console.log(
    `${name.padEnd(48)} ${iterations} ops in ${elapsedMs.toFixed(1)}ms → ${perOpUs.toFixed(3)}µs/op`
  );
}

// 1. Dispatch fan-out with the real default sink set (memory + quality).
const store = new MemoryRoutingEventStore(500);
registerRoutingEventSink(store);
const qualitySink: RoutingEventSink = {
  name: "quality",
  record: (e) => recordQualityEvent(e),
};
registerRoutingEventSink(qualitySink);

console.log(`\nRouting events benchmark (${N.toLocaleString()} events, 2 sinks)\n`);

bench("dispatchRoutingEvent (2 sinks)", N, (i) => dispatchRoutingEvent(makeEvent(i)));
bench("recordQualityEvent (EWMA math)", N, (i) => recordQualityEvent(makeEvent(i)));
bench("MemoryRoutingEventStore.insert", N, (i) => store.record(makeEvent(i)));

// 3. Scoring with the quality factor.
const candidate = (quality: number): ProviderCandidate => ({
  provider: "p",
  model: "m",
  quotaRemaining: 100,
  quotaTotal: 100,
  circuitBreakerState: "CLOSED",
  costPer1MTokens: 1,
  p95LatencyMs: 100,
  latencyStdDev: 10,
  errorRate: 0,
  quality,
});
const pool = [candidate(0.9), candidate(0.5), candidate(0.2)];
bench("calculateFactors + calculateScore (quality factor)", N, (i) => {
  const c = pool[i % pool.length];
  const factors = calculateFactors(c, pool, "general", () => 0.5);
  calculateScore(factors, DEFAULT_WEIGHTS);
});

const score = getQualityScore("openai", "bench-model");
console.log(`\nQuality tracker final score for bench-model: ${score.toFixed(3)}\n`);
