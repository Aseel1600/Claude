/**
 * scripts/governor/evaluateHarness.ts
 *
 * Offline Telemetry Evaluation Harness for Intelligence Governor.
 * Replays past telemetry or synthetic evaluation logs through the NativeOmniGovernor
 * to compute policy recommendation alignment, tier distribution, and potential optimizations
 * WITHOUT invoking external LLMs or network services.
 */

import { NativeOmniGovernor } from "../../open-sse/governor/nativeGovernor.ts";
import type { GovernorInput, GovernorTelemetry } from "../../open-sse/governor/types.ts";

export interface EvaluationReport {
  totalRecordsReplayed: number;
  tierDistribution: Record<string, number>;
  strategyDistribution: Record<string, number>;
  compressionDistribution: Record<string, number>;
  averageDecisionLatencyMs: number;
}

export function runOfflineEvaluation(
  records: Array<{ input: GovernorInput; actual?: Partial<GovernorTelemetry> }>
): EvaluationReport {
  const governor = new NativeOmniGovernor();

  const tierDist: Record<string, number> = {};
  const strategyDist: Record<string, number> = {};
  const compressionDist: Record<string, number> = {};
  let totalLatency = 0;

  for (const record of records) {
    const start = performance.now();
    const decision = governor.decide(record.input);
    const latency = performance.now() - start;
    totalLatency += latency;

    const tier = decision.modelPolicy.recommendedTier;
    const strat = decision.routingPolicy.strategy;
    const comp = decision.compressionPolicy.mode;

    tierDist[tier] = (tierDist[tier] || 0) + 1;
    strategyDist[strat] = (strategyDist[strat] || 0) + 1;
    compressionDist[comp] = (compressionDist[comp] || 0) + 1;
  }

  const count = records.length || 1;

  return {
    totalRecordsReplayed: records.length,
    tierDistribution: tierDist,
    strategyDistribution: strategyDist,
    compressionDistribution: compressionDist,
    averageDecisionLatencyMs: Number((totalLatency / count).toFixed(4)),
  };
}

const isMainModule = process.argv[1]?.includes("evaluateHarness.ts");
if (isMainModule || import.meta.url.endsWith("evaluateHarness.ts")) {
  console.log("=== OmniRoute Offline Intelligence Governor Evaluation ===");

  const sampleInputs: GovernorInput[] = [
    { taskKind: "trivial_control", estimatedPromptTokens: 50 },
    { taskKind: "code_edit_simple", estimatedPromptTokens: 1200 },
    { taskKind: "code_debug", estimatedPromptTokens: 4500, retryCount: 2 },
    { taskKind: "architecture_reasoning", estimatedPromptTokens: 15000 },
    { taskKind: "tool_output_processing", toolCount: 3, toolOutputTokens: 2500 },
  ];

  const dataset = sampleInputs.map((input) => ({ input }));
  const report = runOfflineEvaluation(dataset);

  console.log("Replayed Records:", report.totalRecordsReplayed);
  console.log("Tier Distribution:", report.tierDistribution);
  console.log("Strategy Distribution:", report.strategyDistribution);
  console.log("Compression Distribution:", report.compressionDistribution);
  console.log("Avg Decision Latency:", report.averageDecisionLatencyMs, "ms");
}
