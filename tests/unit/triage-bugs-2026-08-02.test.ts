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

// ── merged from the #9400 branch: its own #9168 regression test ──

test("#9168 streamed optional enum null must not reach the client delta", async () => {
  const { openaiResponsesToOpenAIResponse } = await import(
    "../../open-sse/translator/response/openai-responses.ts"
  );

  const schema = {
    type: "object",
    properties: {
      description: { type: "string" },
      isolation: { type: ["string", "null"], enum: ["worktree", "remote", null] },
    },
    required: ["description"],
  };

  const state: Record<string, unknown> = {
    toolSchemas: new Map([["Agent", schema]]),
  };

  // Step 1: output_item.added announces the tool call
  const added = openaiResponsesToOpenAIResponse({
    type: "response.output_item.added",
    item: { type: "function_call", call_id: "call_agent", name: "Agent" },
  }, state);
  assert.ok(added, "should emit chunk for output_item.added");

  // Step 2: function_call_arguments.delta with optional null — should be buffered, not emitted
  const delta = openaiResponsesToOpenAIResponse({
    type: "response.function_call_arguments.delta",
    delta: '{"description":"audit","isolation":null}',
  }, state);
  // With the fix, delta is buffered and not emitted until output_item.done
  assert.equal(delta, null, "delta should buffer and not emit raw null to client");

  // Step 3: output_item.done emits the normalized arguments without the optional null
  const done = openaiResponsesToOpenAIResponse({
    type: "response.output_item.done",
    item: { type: "function_call", call_id: "call_agent", name: "Agent" },
  }, state);
  assert.ok(done, "should emit chunk for output_item.done");
  assert.equal(
    done?.choices?.[0]?.delta?.tool_calls?.[0]?.function?.arguments,
    '{"description":"audit"}'
  );
});
