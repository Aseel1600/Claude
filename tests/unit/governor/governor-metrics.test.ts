import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { calculateSuccessfulTaskMetrics } from "../../../open-sse/governor/metrics.ts";
import type { GovernorTelemetry } from "../../../open-sse/governor/types.ts";

describe("Governor Successful-Task Metrics Calculator", () => {
  it("should return zero metrics without error when records are empty or have zero successes", () => {
    const emptyMetrics = calculateSuccessfulTaskMetrics([]);
    assert.equal(emptyMetrics.totalEvaluations, 0);
    assert.equal(emptyMetrics.successfulTasks, 0);
    assert.equal(emptyMetrics.tokensPerSuccess, 0);
    assert.equal(emptyMetrics.costPerSuccess, 0);

    const failedRecords: GovernorTelemetry[] = [
      {
        correlationId: "f1",
        timestamp: Date.now(),
        governorMode: "shadow",
        actualProvider: "p1",
        actualModel: "m1",
        actualPromptTokens: 1000,
        actualOutputTokens: 200,
        actualTotalTokens: 1200,
        latencyMs: 500,
        retryCount: 1,
        success: false,
        recommendation: {} as never,
        decisionLatencyMs: 0.1,
      },
    ];

    const failedMetrics = calculateSuccessfulTaskMetrics(failedRecords);
    assert.equal(failedMetrics.totalEvaluations, 1);
    assert.equal(failedMetrics.successfulTasks, 0);
    assert.equal(failedMetrics.tokensPerSuccess, 0);
  });

  it("should accurately calculate success metrics for mixed datasets", () => {
    const records: GovernorTelemetry[] = [
      {
        correlationId: "s1",
        timestamp: Date.now(),
        governorMode: "shadow",
        actualProvider: "p1",
        actualModel: "m1",
        actualPromptTokens: 1000,
        actualOutputTokens: 500,
        actualTotalTokens: 1500,
        estimatedCost: 0.015,
        latencyMs: 1000,
        retryCount: 0,
        success: true,
        recommendation: {} as never,
        decisionLatencyMs: 0.05,
      },
      {
        correlationId: "s2",
        timestamp: Date.now(),
        governorMode: "shadow",
        actualProvider: "p1",
        actualModel: "m2",
        actualPromptTokens: 2000,
        actualOutputTokens: 1000,
        actualTotalTokens: 3000,
        estimatedCost: 0.045,
        latencyMs: 2000,
        retryCount: 1,
        success: true,
        recommendation: {} as never,
        decisionLatencyMs: 0.05,
      },
      {
        correlationId: "f1",
        timestamp: Date.now(),
        governorMode: "shadow",
        actualProvider: "p1",
        actualModel: "m1",
        actualPromptTokens: 5000,
        actualOutputTokens: 0,
        actualTotalTokens: 5000,
        estimatedCost: 0.05,
        latencyMs: 3000,
        retryCount: 3,
        success: false,
        recommendation: {} as never,
        decisionLatencyMs: 0.05,
      },
    ];

    const metrics = calculateSuccessfulTaskMetrics(records);

    assert.equal(metrics.totalEvaluations, 3);
    assert.equal(metrics.successfulTasks, 2);
    // Successful tokens: (1500 + 3000) / 2 = 2250
    assert.equal(metrics.tokensPerSuccess, 2250);
    // Successful cost: (0.015 + 0.045) / 2 = 0.03
    assert.equal(metrics.costPerSuccess, 0.03);
    // Successful latency: (1000 + 2000) / 2 = 1500
    assert.equal(metrics.timePerSuccessMs, 1500);
    // Successful retries: (0 + 1) / 2 = 0.5
    assert.equal(metrics.retriesPerSuccess, 0.5);
  });
});
