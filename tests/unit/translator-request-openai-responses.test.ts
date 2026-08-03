import test from "node:test";
import assert from "node:assert/strict";

// Regression coverage for the Responses -> OpenAI tool-result pairing invariant
// (every tool result must reference a call still present in the request). This
// direction is already covered: `openaiResponsesToOpenAIRequest` builds
// `allToolCallIds` from every emitted `function_call` and drops any `role:"tool"`
// message whose `tool_call_id` has no match (see the post-filter after tool
// conversion in openai-responses.ts, hardened under #2893 to also catch
// empty/missing call ids). These tests just pin that behavior down explicitly so a
// future edit to that filter trips a red here.
const { openaiResponsesToOpenAIRequest } =
  await import("../../open-sse/translator/request/openai-responses.ts");

type ChatMsg = { role: string; tool_call_id?: string; content?: unknown };

test("Responses -> OpenAI: orphaned function_call_output is stripped", () => {
  const result = openaiResponsesToOpenAIRequest(
    "gpt-4o",
    {
      input: [
        { type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] },
        { type: "function_call_output", call_id: "orphan_call", output: "stale result" },
      ],
    },
    false,
    {}
  ) as { messages: ChatMsg[] };

  assert.equal(
    result.messages.some((m) => m.role === "tool" && m.tool_call_id === "orphan_call"),
    false
  );
});

test("Responses -> OpenAI: matched function_call_output is preserved", () => {
  const result = openaiResponsesToOpenAIRequest(
    "gpt-4o",
    {
      input: [
        { type: "function_call", call_id: "call_ok", name: "read_file", arguments: "{}" },
        { type: "function_call_output", call_id: "call_ok", output: "contents" },
      ],
    },
    false,
    {}
  ) as { messages: ChatMsg[] };

  const toolMsgs = result.messages.filter((m) => m.role === "tool");
  assert.equal(toolMsgs.length, 1);
  assert.equal(toolMsgs[0].tool_call_id, "call_ok");
});

test("Responses -> OpenAI: zero-function-call truncation strips every stale output", () => {
  const result = openaiResponsesToOpenAIRequest(
    "gpt-4o",
    {
      input: [
        { type: "function_call_output", call_id: "call_a", output: "stale a" },
        { type: "function_call_output", call_id: "call_b", output: "stale b" },
        { type: "message", role: "user", content: [{ type: "input_text", text: "continue" }] },
      ],
    },
    false,
    {}
  ) as { messages: ChatMsg[] };

  assert.equal(
    result.messages.some((m) => m.role === "tool"),
    false
  );
  assert.equal(
    result.messages.some((m) => m.role === "user"),
    true
  );
});

test("Responses -> OpenAI: mixed matched + orphan keeps only the matched output", () => {
  const result = openaiResponsesToOpenAIRequest(
    "gpt-4o",
    {
      input: [
        { type: "function_call", call_id: "call_valid", name: "fn", arguments: "{}" },
        { type: "function_call_output", call_id: "call_valid", output: "ok" },
        { type: "function_call_output", call_id: "call_orphan", output: "stale" },
      ],
    },
    false,
    {}
  ) as { messages: ChatMsg[] };

  const toolMsgs = result.messages.filter((m) => m.role === "tool");
  assert.equal(toolMsgs.length, 1);
  assert.equal(toolMsgs[0].tool_call_id, "call_valid");
});

// Regression for the big-pickle/opencode-zen 400: "messages[N].tool_calls: empty
// array. Expected an array with minimum length 1". Every assistant turn is seeded
// with `tool_calls: []` internally so `function_call`/`custom_tool_call` items can
// push onto it, but a reasoning-only or text-only turn never pushes anything —
// the empty array must be stripped before the message is emitted, not left in place.
test("Responses -> OpenAI: assistant turn with no function calls omits tool_calls entirely", () => {
  const result = openaiResponsesToOpenAIRequest(
    "gpt-4o",
    {
      input: [
        { type: "reasoning", summary: [{ type: "summary_text", text: "thinking..." }] },
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "hello" }],
        },
      ],
    },
    false,
    {}
  ) as { messages: Array<ChatMsg & { tool_calls?: unknown }> };

  const assistantMsgs = result.messages.filter((m) => m.role === "assistant");
  assert.equal(assistantMsgs.length, 1);
  assert.equal("tool_calls" in assistantMsgs[0], false);
});

test("Responses -> OpenAI: assistant turn with an actual function call keeps tool_calls", () => {
  const result = openaiResponsesToOpenAIRequest(
    "gpt-4o",
    {
      input: [{ type: "function_call", call_id: "call_1", name: "fn", arguments: "{}" }],
    },
    false,
    {}
  ) as { messages: Array<ChatMsg & { tool_calls?: unknown[] }> };

  const assistantMsgs = result.messages.filter((m) => m.role === "assistant");
  assert.equal(assistantMsgs.length, 1);
  assert.equal(Array.isArray(assistantMsgs[0].tool_calls), true);
  assert.equal((assistantMsgs[0].tool_calls as unknown[]).length, 1);
});
