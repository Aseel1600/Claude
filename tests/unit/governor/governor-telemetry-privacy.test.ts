import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { GovernorTelemetry } from "../../../open-sse/governor/types.ts";
import { insertGovernorTelemetryRow, queryGovernorTelemetryRows } from "../../../src/lib/db/governorTelemetry.ts";

describe("Governor Telemetry Privacy & Resilience", () => {
  it("should persist telemetry record containing only non-sensitive metadata", () => {
    const record: GovernorTelemetry = {
      correlationId: "priv-test-101",
      timestamp: Date.now(),
      governorMode: "shadow",
      actualProvider: "openai",
      actualModel: "gpt-4o-mini",
      actualRoutingStrategy: "cost_optimized",
      actualPromptTokens: 350,
      actualOutputTokens: 120,
      actualTotalTokens: 470,
      estimatedCost: 0.00015,
      latencyMs: 120,
      retryCount: 0,
      success: true,
      recommendation: {
        modelPolicy: { recommendedTier: "low" },
        routingPolicy: { strategy: "cost_optimized" },
        reasoningPolicy: { effort: "none" },
        compressionPolicy: { mode: "compact" },
        contextBudgetPolicy: { maxPromptTokens: 2000 },
        escalationPolicy: { allowedRetries: 1 },
      },
      decisionLatencyMs: 0.04,
    };

    insertGovernorTelemetryRow(record);
    const rows = queryGovernorTelemetryRows(10);
    const matched = rows.find((r) => r.correlationId === "priv-test-101");

    assert.notEqual(matched, undefined);
    if (matched) {
      assert.equal(matched.actualProvider, "openai");
      assert.equal(matched.actualPromptTokens, 350);
      assert.equal(matched.actualTotalTokens, 470);
      // Verify no API keys, bearer tokens, or prompt body fields exist on row interface
      assert.equal((matched as unknown as Record<string, unknown>).apiKey, undefined);
      assert.equal((matched as unknown as Record<string, unknown>).promptBody, undefined);
    }
  });
});
