import assert from "node:assert/strict";
import test from "node:test";
import { analyzeShadowDataset } from "../../../scripts/governor/analyzeShadowDataset.ts";
import { shouldSampleGovernorTelemetry, getGovernorTelemetryQueueMetrics, updateGovernorTelemetryOutcome } from "../../../src/lib/db/governorTelemetry.ts";
import type { ActualRequestContext, GovernorTelemetry } from "../../../open-sse/governor/types.ts";

test("nullable request outcomes are part of the type contract", () => {
  const context: ActualRequestContext = { provider: "p", model: "m", success: null, latencyMs: null, retryCount: null };
  assert.equal(context.success, null);
});

test("offline analysis separates replay drift from actual disagreement and unknown tiers", () => {
  const observation: GovernorTelemetry = {
    correlationId: "replay-1", timestamp: 1, governorMode: "shadow", actualProvider: "p", actualModel: "gpt-x",
    actualRoutingStrategy: "direct", actualReasoningConfig: "high", actualCompressionConfig: "none",
    actualPromptTokens: null, actualOutputTokens: null, actualTotalTokens: null, latencyMs: null, retryCount: null,
    success: null, recommendation: { modelPolicy: { recommendedTier: "preserve" }, routingPolicy: { strategy: "preserve" }, reasoningPolicy: { effort: "preserve" }, compressionPolicy: { mode: "preserve" }, contextBudgetPolicy: { maxPromptTokens: 1000 }, maxOutputTokens: undefined, escalationPolicy: { allowedRetries: 2 } }, decisionLatencyMs: 1,
  };
  const report = analyzeShadowDataset([{ input: { taskKind: "unknown", contextWindow: 1000 }, observation }]);
  assert.equal(report.REPLAY_ANALYSIS.REPLAY_EXACT_MATCHES, 1);
  assert.equal(report.ACTUAL_VS_RECOMMENDED.disagreements, 1);
  assert.equal(report.SAVINGS_OPPORTUNITIES.cheaperTier, "UNKNOWN");
});

test("sampling is deterministic and excludes sampled requests from queue-drop accounting", () => {
  const id = "stable-correlation-id";
  assert.equal(shouldSampleGovernorTelemetry(id), shouldSampleGovernorTelemetry(id));
  const before = getGovernorTelemetryQueueMetrics();
  updateGovernorTelemetryOutcome("outcome-without-observation", { success: true });
  const after = getGovernorTelemetryQueueMetrics();
  assert.equal(after.queueDropped - before.queueDropped, 0);
});
