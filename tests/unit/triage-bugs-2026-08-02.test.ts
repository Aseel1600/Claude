import test from "node:test";
import assert from "node:assert/strict";

const { getBackgroundTaskReason, setBackgroundDegradationConfig } =
  await import("../../open-sse/services/backgroundTaskDetector.ts");

// Regression: Anthropic top-level `system` field must trigger background detection
test("#9142 Anthropic top-level system prompts must trigger background detection", () => {
  setBackgroundDegradationConfig({ enabled: true });
  assert.equal(
    getBackgroundTaskReason({
      system: "Generate a title for this conversation",
      messages: [{ role: "user", content: "hello" }],
    }),
    "system_prompt_pattern"
  );
});
