import test from "node:test";
import assert from "node:assert/strict";
import { openaiResponsesToOpenAIRequest } from "../../open-sse/translator/request/openai-responses.ts";

function asRecord(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

for (const variant of ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"]) {
  test(`#8997 ${variant} nested reasoning.effort max survives promotion`, () => {
    const translated = asRecord(
      openaiResponsesToOpenAIRequest(
        variant,
        { model: variant, input: "hello", reasoning: { effort: "max" } },
        false,
        {}
      )
    );
    assert.equal(translated.reasoning_effort, "max");
  });

  test(`#8997 ${variant} flat reasoning_effort max survives promotion`, () => {
    const translated = asRecord(
      openaiResponsesToOpenAIRequest(
        variant,
        { model: variant, input: "hello", reasoning_effort: "max" },
        false,
        {}
      )
    );
    assert.equal(translated.reasoning_effort, "max");
  });
}

test("non-GPT-5.6 models still get max downgraded to xhigh", () => {
  const translated = asRecord(
    openaiResponsesToOpenAIRequest(
      "gpt-4o",
      { model: "gpt-4o", input: "hello", reasoning: { effort: "max" } },
      false,
      {}
    )
  );
  assert.equal(translated.reasoning_effort, "xhigh");
});

// ─────────────────────────────────────────────────────────────────────
// PR #9142 — Anthropic top-level `system` prompts must trigger background detection
// ─────────────────────────────────────────────────────────────────────
const { getBackgroundTaskReason, setBackgroundDegradationConfig } =
  await import("../../open-sse/services/backgroundTaskDetector.ts");

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
