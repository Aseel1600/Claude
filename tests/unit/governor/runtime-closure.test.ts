import test from "node:test";
import assert from "node:assert/strict";
import { getGovernorRuntimeConfig } from "../../../open-sse/governor/runtimeConfig.ts";
import { applyActiveGovernorPlan } from "../../../open-sse/governor/activeV1.ts";
import {
  ActiveCanaryCircuitBreaker,
  assessActiveCanary,
  stableCanarySample,
} from "../../../open-sse/governor/activeCanary.ts";
import type { CounterfactualExecutionPlan } from "../../../open-sse/governor/counterfactual.ts";

function plan(overrides: Partial<CounterfactualExecutionPlan> = {}): CounterfactualExecutionPlan {
  return {
    planVersion: "test",
    governorName: "test",
    governorVersion: "test",
    policyVersion: "v1",
    recommendedModelTier: "medium",
    selectedProvider: "p2",
    selectedModel: "m2",
    resolvedModelTier: "medium",
    routingStrategy: "cost_optimized",
    reasoningEffort: "medium",
    thinkingBudget: null,
    compressionMode: "rtk",
    contextBudget: 1000,
    maxOutputTokens: 100,
    escalationPolicy: { allowedRetries: 0 },
    estimatedCurrentCost: 2,
    estimatedCounterfactualCost: 1,
    costEstimateBasis: "ACTUAL_USAGE",
    estimatedSavings: 1,
    estimatedSavingsPercent: 50,
    tokenReductionOpportunity: 0,
    confidence: "HIGH",
    executable: true,
    unresolvedFields: [],
    guardrailResults: {
      CAPABILITY_COMPATIBLE: "YES",
      CONTEXT_FITS: "YES",
      PROVIDER_AVAILABLE: "UNKNOWN",
      QUOTA_ACCEPTABLE: "UNKNOWN",
      REASONING_SUPPORTED: "YES",
      COMPRESSION_SUPPORTED: "YES",
      USER_MAX_OUTPUT_RESPECTED: "YES",
    },
    reasons: [],
    liveActiveControl: false,
    ...overrides,
  };
}

test("runtime configuration is factual and fail-safe", () => {
  const old = { ...process.env };
  try {
    process.env.GOVERNOR_ACTIVE_ENABLED = "true";
    process.env.GOVERNOR_ACTIVE_CANARY_RATE = "0.25";
    process.env.GOVERNOR_MAX_ESTIMATED_REQUEST_COST = "1.5";
    assert.equal(getGovernorRuntimeConfig().activeEnabled, true);
    assert.equal(getGovernorRuntimeConfig().canaryRate, 0.25);
    assert.equal(getGovernorRuntimeConfig().maxEstimatedRequestCost, 1.5);

    process.env.GOVERNOR_ACTIVE_CANARY_RATE = "bad";
    process.env.GOVERNOR_MAX_ESTIMATED_REQUEST_COST = "-2";
    assert.equal(getGovernorRuntimeConfig().canaryRate, 0);
    assert.equal(getGovernorRuntimeConfig().maxEstimatedRequestCost, null);
  } finally {
    for (const key of Object.keys(process.env)) {
      if (!(key in old)) delete process.env[key];
    }
    Object.assign(process.env, old);
  }
});

test("canary sampling is deterministic and rate bounded", () => {
  assert.equal(stableCanarySample("same-id", 0), false);
  assert.equal(stableCanarySample("same-id", 1), true);
  assert.equal(stableCanarySample("same-id", 0.37), stableCanarySample("same-id", 0.37));
  assert.equal(stableCanarySample("same-id", -1), false);
  assert.equal(stableCanarySample("same-id", 2), false);
});

test("active canary requires high confidence, known non-increasing cost and selection", () => {
  assert.deepEqual(assessActiveCanary(plan(), "id", { enabled: false, rate: 1 }), {
    selected: false,
    eligible: false,
    reason: "kill_switch",
  });
  assert.equal(assessActiveCanary(plan(), "id", { enabled: true, rate: 0 }).selected, false);
  assert.equal(assessActiveCanary(plan(), "id", { enabled: true, rate: 1 }).selected, true);
  assert.equal(
    assessActiveCanary(plan({ confidence: "MEDIUM" }), "id", { enabled: true, rate: 1 }).eligible,
    false
  );
  assert.equal(
    assessActiveCanary(plan({ estimatedCurrentCost: null }), "id", { enabled: true, rate: 1 }).eligible,
    false
  );
  assert.equal(
    assessActiveCanary(
      plan({ estimatedCurrentCost: 1, estimatedCounterfactualCost: 2 }),
      "id",
      { enabled: true, rate: 1 }
    ).eligible,
    false
  );
  assert.equal(
    assessActiveCanary(plan(), "id", { enabled: true, rate: 1, maxEstimatedCost: 0.5 }).eligible,
    false
  );
});

test("runtime-resolvable availability may be unknown, but factual hard guard failure blocks", () => {
  assert.equal(assessActiveCanary(plan(), "id", { enabled: true, rate: 1 }).eligible, true);
  assert.equal(
    assessActiveCanary(
      plan({ guardrailResults: { ...plan().guardrailResults, CONTEXT_FITS: "UNKNOWN" } }),
      "id",
      { enabled: true, rate: 1 }
    ).eligible,
    false
  );
  assert.equal(
    assessActiveCanary(
      plan({ guardrailResults: { ...plan().guardrailResults, PROVIDER_AVAILABLE: "NO" } }),
      "id",
      { enabled: true, rate: 1 }
    ).eligible,
    false
  );
});

test("shared breaker primitive trips deterministically and resets", () => {
  const breaker = new ActiveCanaryCircuitBreaker(2);
  assert.equal(breaker.getState(), "closed");
  breaker.recordFailure();
  assert.equal(breaker.getFailureCount(), 1);
  assert.equal(breaker.isTripped(), false);
  breaker.recordFailure();
  assert.equal(breaker.isTripped(), true);
  assert.equal(breaker.getState(), "open");
  breaker.reset();
  assert.equal(breaker.getFailureCount(), 0);
  assert.equal(breaker.getState(), "closed");
});

test("reasoning and compression controls apply only when enabled", () => {
  const request = {
    provider: "p1",
    model: "m1",
    reasoning: "original",
    compression: "original",
  };
  const result = applyActiveGovernorPlan(request, plan(), "id", {
    enabled: true,
    controlModel: false,
    controlProvider: false,
    controlReasoning: true,
    controlCompression: true,
    controlOutput: false,
  });
  assert.equal(result.applied, true);
  assert.equal(request.provider, "p1");
  assert.equal(request.model, "m1");
  assert.equal(request.reasoning, "medium");
  assert.equal(request.compression, "rtk");
});
