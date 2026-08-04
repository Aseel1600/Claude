import { test } from "node:test";
import assert from "node:assert/strict";
import { detectSupportedThinkingEfforts } from "@/lib/providerModels/modelDiscovery";

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

// #9168 — streamed Responses tool arguments with optional nullable fields bypass null normalization
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
