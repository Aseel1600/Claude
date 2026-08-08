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

// ── #9160 model discovery: capabilities.effort_tiers ────────────────────────

// #9160: model discovery must ingest capabilities.effort_tiers
test("#9160 model discovery must ingest capabilities.effort_tiers", () => {
  assert.deepEqual(
    detectSupportedThinkingEfforts({
      capabilities: { effort_tiers: ["low", "medium", "high", "xhigh"] },
    }),
    ["low", "medium", "high", "xhigh"]
  );
});

test("#9160 capabilities.effort_tiers with duplicate and synonym", () => {
  assert.deepEqual(
    detectSupportedThinkingEfforts({
      capabilities: { effort_tiers: ["low", "low", "max"] },
    }),
    ["low", "xhigh"]
  );
});
