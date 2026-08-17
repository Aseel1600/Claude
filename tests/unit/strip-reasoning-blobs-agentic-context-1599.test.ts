import test from "node:test";
import assert from "node:assert/strict";

import { applyResponsesInputPolicy } from "../../open-sse/services/responsesInputPolicy.ts";
import { filterToOpenAIFormat } from "../../open-sse/translator/helpers/openaiHelper.ts";
import { omitEncryptedReasoningForLog } from "../../src/lib/logPayloads.ts";

// Responses reasoning replay is target-scoped. Plaintext DeepSeek state and
// provider-generated opaque state are never interchangeable.

test("unknown Responses targets drop reasoning and report incompatibility", () => {
  const body: Record<string, unknown> = {
    input: [
      { type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] },
      { id: "rs_abc123", type: "reasoning", summary: [{ text: "display only" }] },
      { type: "reasoning", encrypted_content: "blob" },
      {
        type: "function_call",
        id: "fc_xyz789",
        name: "search",
        arguments: "{}",
        call_id: "call_1",
      },
    ],
  };

  const result = applyResponsesInputPolicy(body);
  const input = body.input as Array<Record<string, unknown>>;

  assert.equal(result.incompatibleReasoning, true);
  assert.equal(
    input.some((item) => item.type === "reasoning"),
    false
  );
  assert.equal(input.length, 2);
  assert.equal(input[1].id, undefined, "fc_ server id stripped, item kept");
});

test("DeepSeek preserves plaintext Responses reasoning without synthetic IDs", () => {
  const body: Record<string, unknown> = {
    input: [
      {
        id: "rs_plaintext123",
        type: "reasoning",
        content: [{ type: "reasoning_text", text: "inspect first" }],
      },
      { type: "message", role: "user", content: [{ type: "input_text", text: "continue" }] },
    ],
  };

  const result = applyResponsesInputPolicy(body, { provider: "deepseek" });

  assert.equal(result.incompatibleReasoning, false);
  assert.deepEqual(body.input, [
    {
      type: "reasoning",
      content: [{ type: "reasoning_text", text: "inspect first" }],
    },
    { type: "message", role: "user", content: [{ type: "input_text", text: "continue" }] },
  ]);
});

test("DeepSeek rejects plaintext reasoning carrying opaque provider state", () => {
  for (const opaqueField of ["signature", "format"] as const) {
    const body: Record<string, unknown> = {
      input: [
        {
          id: "rs_mixed123",
          type: "reasoning",
          content: [{ type: "reasoning_text", text: "untrusted companion" }],
          [opaqueField]: "provider-state",
        },
        { type: "message", role: "user", content: [{ type: "input_text", text: "continue" }] },
      ],
    };

    const result = applyResponsesInputPolicy(body, { provider: "deepseek" });

    assert.equal(result.incompatibleReasoning, true, opaqueField);
    assert.deepEqual(body.input, [
      { type: "message", role: "user", content: [{ type: "input_text", text: "continue" }] },
    ]);
  }
});

test("known opaque targets preserve a cloned complete provider-generated reasoning item", () => {
  const opaqueReasoning = {
    id: "rs_encrypted123",
    type: "reasoning",
    encrypted_content: "encrypted-blob",
    summary: [{ type: "summary_text", text: "safe summary" }],
    status: "completed",
  };
  const body: Record<string, unknown> = {
    input: [
      opaqueReasoning,
      "rs_stored123",
      { type: "item_reference", id: "resp_stored123" },
      "ws_stored123",
      { type: "web_search_call", id: "ws_stored123", status: "completed" },
      { type: "image_generation_call", id: "ig_stored123", status: "completed" },
      { type: "function_call", id: "fc_stored123", call_id: "call_1" },
    ],
  };

  const result = applyResponsesInputPolicy(body, { provider: "openai" });
  assert.notEqual(
    (body.input as Array<Record<string, unknown>>)[0],
    opaqueReasoning,
    "policy output must not expose the caller's nested item object"
  );

  assert.equal(result.incompatibleReasoning, false);
  assert.deepEqual(body.input, [
    {
      id: "rs_encrypted123",
      type: "reasoning",
      encrypted_content: "encrypted-blob",
      summary: [{ type: "summary_text", text: "safe summary" }],
      status: "completed",
    },
    { type: "web_search_call", status: "completed" },
    { type: "image_generation_call", status: "completed" },
    { type: "function_call", call_id: "call_1" },
  ]);
});

test("explicit custom target opt-in remains an opaque transport override", () => {
  const body: Record<string, unknown> = {
    input: [{ type: "reasoning", encrypted_content: "encrypted-blob" }],
  };

  const result = applyResponsesInputPolicy(body, { preserveEncryptedReasoning: true });

  assert.equal(result.incompatibleReasoning, false);
  assert.deepEqual(body.input, [{ type: "reasoning", encrypted_content: "encrypted-blob" }]);
});

test("preserved opaque reasoning remains redacted from log copies", () => {
  const body = {
    input: [{ type: "reasoning", encrypted_content: "provider-secret-blob" }],
  };

  applyResponsesInputPolicy(body, { provider: "xai" });
  const logged = omitEncryptedReasoningForLog(body) as typeof body;

  assert.equal(body.input[0].encrypted_content, "provider-secret-blob");
  assert.equal(logged.input[0].encrypted_content, "[omitted: encrypted reasoning, 20 chars]");
});

test("summary-only reasoning is omitted for every transport", () => {
  const body: Record<string, unknown> = {
    input: [
      { id: "rs_summary123", type: "reasoning", summary: [{ text: "thinking..." }] },
      { type: "reasoning", encrypted_content: "" },
      { type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] },
    ],
  };

  const result = applyResponsesInputPolicy(body, { provider: "openai" });

  assert.equal(result.incompatibleReasoning, false);
  assert.deepEqual(body.input, [
    { type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] },
  ]);
});

test("filterToOpenAIFormat strips reasoning_content from assistant+tool_calls messages", () => {
  const body = {
    messages: [
      {
        role: "assistant",
        reasoning_content: "long chain of thought that inflates context",
        tool_calls: [{ id: "call_1", type: "function", function: { name: "f", arguments: "{}" } }],
      },
    ],
  };

  const result = filterToOpenAIFormat(body) as { messages: Array<Record<string, unknown>> };
  const msg = result.messages[0];

  assert.equal(msg.reasoning_content, undefined, "reasoning_content must be dropped");
  assert.ok(Array.isArray(msg.tool_calls), "tool_calls preserved");
  assert.equal((msg.tool_calls as unknown[]).length, 1);
  assert.equal(msg.role, "assistant");
});

test("filterToOpenAIFormat keeps assistant+tool_calls untouched when no reasoning_content", () => {
  const body = {
    messages: [
      {
        role: "assistant",
        content: null,
        tool_calls: [{ id: "call_1", type: "function", function: { name: "f", arguments: "{}" } }],
      },
    ],
  };

  const result = filterToOpenAIFormat(body) as { messages: Array<Record<string, unknown>> };
  assert.deepEqual(result.messages[0], body.messages[0]);
});
