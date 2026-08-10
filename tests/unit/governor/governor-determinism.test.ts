import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { NativeOmniGovernor } from "../../../open-sse/governor/nativeGovernor.ts";
import type { GovernorInput } from "../../../open-sse/governor/types.ts";

describe("NativeOmniGovernor Determinism & Classification", () => {
  const governor = new NativeOmniGovernor();

  it("should produce identical decisions for identical inputs", () => {
    const input: GovernorInput = {
      correlationId: "det-test-1",
      taskKind: "code_debug",
      estimatedPromptTokens: 2500,
      contextUtilization: 0.45,
      toolCount: 1,
      retryCount: 1,
      rawPromptText: "fix uncaught Exception in user handler",
    };

    const decisionA = governor.decide(input);
    const decisionB = governor.decide(input);

    assert.deepEqual(decisionA, decisionB);
  });

  it("should correctly classify task kinds based on heuristics", () => {
    assert.equal(
      governor.classifyTask({ rawPromptText: "architecture system design document" }),
      "architecture_reasoning"
    );
    assert.equal(
      governor.classifyTask({ rawPromptText: "TypeError: cannot read properties of null" }),
      "code_debug"
    );
    assert.equal(
      governor.classifyTask({ toolCount: 2, toolOutputTokens: 800 }),
      "tool_output_processing"
    );
    assert.equal(
      governor.classifyTask({ estimatedPromptTokens: 50, toolCount: 0 }),
      "trivial_control"
    );
  });

  it("should adapt model tier and reasoning effort on repeated retries", () => {
    const singleRetryInput: GovernorInput = {
      taskKind: "code_edit_simple",
      retryCount: 0,
    };
    const multiRetryInput: GovernorInput = {
      taskKind: "code_edit_simple",
      retryCount: 2,
    };

    const initialDecision = governor.decide(singleRetryInput);
    const escalatedDecision = governor.decide(multiRetryInput);

    assert.equal(initialDecision.modelPolicy.recommendedTier, "medium");
    assert.equal(escalatedDecision.modelPolicy.recommendedTier, "high");
    assert.equal(initialDecision.reasoningPolicy.effort, "low");
    assert.equal(escalatedDecision.reasoningPolicy.effort, "medium");
  });
});
