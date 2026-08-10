import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { GovernorManager } from "../../../open-sse/governor/governorManager.ts";
import type { ActualRequestContext, GovernorInput } from "../../../open-sse/governor/types.ts";
import {
  getFeatureFlagOverride,
  removeFeatureFlagOverride,
  setFeatureFlagOverride,
} from "../../../src/lib/db/featureFlags.ts";

describe("GovernorManager & Shadow Mode Isolation", () => {
  it("should return null recommendation when mode is off", () => {
    // Environment process.env.INTELLIGENCE_GOVERNOR_MODE is unset / off by default
    const input: GovernorInput = { correlationId: "shadow-off-1", taskKind: "trivial_control" };
    const context: ActualRequestContext = { provider: "openai", model: "gpt-4o" };

    const result = GovernorManager.evaluateShadow(input, context);

    assert.equal(result.mode, "off");
    assert.equal(result.recommendation, null);
  });

  it("should evaluate shadow decision without mutating active request context", () => {
    const previousOverride = getFeatureFlagOverride("INTELLIGENCE_GOVERNOR_MODE");
    removeFeatureFlagOverride("INTELLIGENCE_GOVERNOR_MODE");
    process.env.INTELLIGENCE_GOVERNOR_MODE = "shadow";
    try {
      const input: GovernorInput = {
        correlationId: "shadow-on-1",
        taskKind: "architecture_reasoning",
        estimatedPromptTokens: 8000,
      };

      const originalContext: ActualRequestContext = {
        provider: "anthropic",
        model: "claude-3-7-sonnet",
        routingStrategy: "direct",
        promptTokens: 8000,
        outputTokens: 1000,
        totalTokens: 9000,
        latencyMs: 450,
      };

      const contextCopy = JSON.parse(JSON.stringify(originalContext));

      const result = GovernorManager.evaluateShadow(input, originalContext);

      assert.equal(result.mode, "shadow");
      assert.notEqual(result.recommendation, null);
      assert.equal(result.recommendation?.modelPolicy.recommendedTier, "highest");

      // Verify the active request context remains unchanged by shadow evaluation.
      assert.deepEqual(originalContext, contextCopy);
    } finally {
      delete process.env.INTELLIGENCE_GOVERNOR_MODE;
      if (previousOverride === undefined) removeFeatureFlagOverride("INTELLIGENCE_GOVERNOR_MODE");
      else setFeatureFlagOverride("INTELLIGENCE_GOVERNOR_MODE", previousOverride);
    }
  });
});
