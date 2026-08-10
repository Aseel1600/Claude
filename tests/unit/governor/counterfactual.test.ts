import assert from "node:assert/strict";
import test from "node:test";
import { NativeOmniGovernor } from "../../../open-sse/governor/nativeGovernor.ts";
import { resolveCounterfactualPlan, type CounterfactualInput } from "../../../open-sse/governor/counterfactual.ts";

const candidate = { provider: "fixture-provider", model: "fixture-model", tier: "low" as const, available: true, capabilities: ["tools", "streaming"], inputPrice: 1, outputPrice: 2 };
function base(overrides: Partial<CounterfactualInput> = {}): CounterfactualInput { return { taskKind: "trivial_control", estimatedPromptTokens: 50, requestedMaxOutput: 1000, actualInputTokens: 50, actualOutputTokens: 100, currentCost: 0.001, candidates: [candidate], ...overrides }; }

test("counterfactual planner is deterministic and record-only", () => {
  const governor = new NativeOmniGovernor(); const input = base(); const decision = governor.decide(input);
  const a = resolveCounterfactualPlan(input, decision); const b = resolveCounterfactualPlan(input, decision);
  assert.deepEqual(a, b); assert.equal(a.liveActiveControl, false); assert.equal(a.executable, true);
});

test("capability guardrail prevents an actionable plan", () => {
  const input = base({ requiredCapabilities: ["vision"] });
  const plan = resolveCounterfactualPlan(input, new NativeOmniGovernor().decide(input));
  assert.equal(plan.executable, false); assert.equal(plan.guardrailResults.CAPABILITY_COMPATIBLE, "NO");
});

test("unknown pricing or usage never becomes zero savings", () => {
  const input = base({ actualInputTokens: null, actualOutputTokens: null, currentCost: null });
  const plan = resolveCounterfactualPlan(input, new NativeOmniGovernor().decide(input));
  assert.equal(plan.estimatedSavings, null); assert.equal(plan.estimatedCounterfactualCost, null);
});

test("explicit output maximum is never exceeded", () => {
  const input = base({ requestedMaxOutput: 200 });
  const decision = { ...new NativeOmniGovernor().decide(input), maxOutputTokens: 99999 };
  assert.equal(resolveCounterfactualPlan(input, decision).maxOutputTokens, 200);
});

test("unavailable providers are not actionable", () => {
  const input = base({ candidates: [{ ...candidate, available: false }] });
  const plan = resolveCounterfactualPlan(input, new NativeOmniGovernor().decide(input));
  assert.equal(plan.executable, false); assert.equal(plan.estimatedSavings, null);
});
