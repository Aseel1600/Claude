/**
 * scripts/governor/benchmark.ts
 *
 * Synthetic Decision Benchmark for Intelligence Governor pre-work.
 * Evaluates 10,000 deterministic decisions to measure:
 * - Throughput (decisions/sec)
 * - Latency distribution (p50, p95, p99, max)
 * - Memory stability
 */

import { NativeOmniGovernor } from "../../open-sse/governor/nativeGovernor.ts";
import type { GovernorInput, TaskKind } from "../../open-sse/governor/types.ts";

export interface BenchmarkMetrics {
  totalDecisions: number;
  totalDurationMs: number;
  decisionsPerSecond: number;
  latencyP50Ms: number;
  latencyP95Ms: number;
  latencyP99Ms: number;
  maxLatencyMs: number;
  memoryDeltaMb: number;
  breakdownByTaskKind: Record<string, number>;
  warmupDecisions: number;
  runs: number;
  medianThroughputPerSecond: number;
}

export function runGovernorBenchmark(sampleSize = 10_000, runCount = 3): BenchmarkMetrics {
  const governor = new NativeOmniGovernor();
  const initialMemory = process.memoryUsage().heapUsed;

  const taskKinds: TaskKind[] = [
    "trivial_control",
    "tool_output_processing",
    "code_edit_simple",
    "code_debug",
    "architecture_reasoning",
    "unknown",
  ];

  const syntheticInputs: GovernorInput[] = Array.from({ length: sampleSize }, (_, i) => {
    const kind = taskKinds[i % taskKinds.length];
    return {
      correlationId: `bench-${i}`,
      taskKind: kind,
      estimatedPromptTokens: 100 + (i % 500) * 10,
      contextWindow: 128_000,
      contextUtilization: (i % 100) / 100,
      toolCount: i % 5,
      toolOutputTokens: (i % 3) * 400,
      retryCount: i % 4,
      requestedMaxOutput: 4096,
      rawPromptText:
        kind === "code_debug"
          ? "fix TypeError: cannot read properties of undefined (reading 'map') in stack trace"
          : kind === "architecture_reasoning"
          ? "design a scalable high-availability system architecture with failover"
          : "simple user message text",
    };
  });

  const latencies: number[] = new Array(sampleSize);
  const breakdown: Record<string, number> = {};

  const warmupDecisions = Math.min(1_000, sampleSize);
  for (let i = 0; i < warmupDecisions; i++) governor.decide(syntheticInputs[i]);

  const wallStart = performance.now();

  for (let i = 0; i < sampleSize; i++) {
    const start = performance.now();
    const decision = governor.decide(syntheticInputs[i]);
    const duration = performance.now() - start;
    latencies[i] = duration;

    const tier = decision.modelPolicy.recommendedTier;
    breakdown[tier] = (breakdown[tier] || 0) + 1;
  }

  const wallDuration = performance.now() - wallStart;
  const finalMemory = process.memoryUsage().heapUsed;

  latencies.sort((a, b) => a - b);

  const p50 = latencies[Math.floor(sampleSize * 0.5)];
  const p95 = latencies[Math.floor(sampleSize * 0.95)];
  const p99 = latencies[Math.floor(sampleSize * 0.99)];
  const max = latencies[sampleSize - 1];

  const opsPerSec = Math.round((sampleSize / wallDuration) * 1000);
  const throughputs = [opsPerSec];
  for (let run = 1; run < Math.max(1, runCount); run++) {
    const runStart = performance.now();
    for (const input of syntheticInputs) governor.decide(input);
    throughputs.push(Math.round((sampleSize / (performance.now() - runStart)) * 1000));
  }
  throughputs.sort((a, b) => a - b);
  const memDeltaMb = Number(((finalMemory - initialMemory) / (1024 * 1024)).toFixed(2));

  return {
    totalDecisions: sampleSize,
    totalDurationMs: Number(wallDuration.toFixed(2)),
    decisionsPerSecond: opsPerSec,
    latencyP50Ms: Number(p50.toFixed(4)),
    latencyP95Ms: Number(p95.toFixed(4)),
    latencyP99Ms: Number(p99.toFixed(4)),
    maxLatencyMs: Number(max.toFixed(4)),
    memoryDeltaMb: memDeltaMb,
    breakdownByTaskKind: breakdown,
    warmupDecisions,
    runs: throughputs.length,
    medianThroughputPerSecond: throughputs[Math.floor(throughputs.length / 2)],
  };
}

const isMainModule = process.argv[1]?.includes("benchmark.ts");
if (isMainModule || import.meta.url.endsWith("benchmark.ts")) {
  console.log("=== OmniRoute Intelligence Governor Synthetic Benchmark ===");
  const results = runGovernorBenchmark(10_000, 3);
  console.log(`Total Decisions  : ${results.totalDecisions.toLocaleString()}`);
  console.log(`Total Duration   : ${results.totalDurationMs} ms`);
  console.log(`Throughput       : ${results.decisionsPerSecond.toLocaleString()} decisions/sec`);
  console.log(`Median throughput: ${results.medianThroughputPerSecond.toLocaleString()} decisions/sec (${results.runs} runs, ${results.warmupDecisions} warmup decisions)`);
  console.log(`Latency p50      : ${results.latencyP50Ms} ms`);
  console.log(`Latency p95      : ${results.latencyP95Ms} ms`);
  console.log(`Latency p99      : ${results.latencyP99Ms} ms`);
  console.log(`Max Latency      : ${results.maxLatencyMs} ms`);
  console.log(`Memory Delta     : ${results.memoryDeltaMb} MB`);
  console.log("Recommended Tier Breakdown:", results.breakdownByTaskKind);
}
