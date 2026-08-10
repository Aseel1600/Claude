import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { NativeOmniGovernor } from "../../../open-sse/governor/nativeGovernor.ts";
import type { GovernorInput } from "../../../open-sse/governor/types.ts";

describe("NativeOmniGovernor Overhead & Performance", () => {
  it("should execute decisions in under 1ms per input", () => {
    const governor = new NativeOmniGovernor();
    const input: GovernorInput = {
      correlationId: "perf-test-1",
      taskKind: "code_debug",
      estimatedPromptTokens: 5000,
      contextUtilization: 0.6,
      toolCount: 2,
      rawPromptText: "fix TypeError: undefined is not a function",
    };

    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      governor.decide(input);
    }
    const elapsed = performance.now() - start;
    const avgLatencyMs = elapsed / 100;

    assert.ok(avgLatencyMs < 1.0, `Average decision latency ${avgLatencyMs}ms should be < 1.0ms`);
  });
});
