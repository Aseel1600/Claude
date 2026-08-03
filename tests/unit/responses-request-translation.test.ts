import test from "node:test";
import assert from "node:assert/strict";

const { openaiResponsesToOpenAIRequest } =
  await import("../../open-sse/translator/request/openai-responses.ts");

test("openaiResponsesToOpenAIRequest: should convert reasoning item to reasoning_content", () => {
  const body = {
    input: [
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "Hello" }],
      },
      {
        type: "reasoning",
        summary: [{ type: "summary_text", text: "Thinking about hello" }],
      },
      {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "Hi there!" }],
      },
    ],
  };

  const result = openaiResponsesToOpenAIRequest("big-pickle", body, true, {
    provider: "opencode-zen",
  });
  const messages = result.messages;

  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, "user");
  assert.equal(messages[1].role, "assistant");
  assert.equal(messages[1].reasoning_content, "Thinking about hello");
  assert.deepEqual(messages[1].content, [{ type: "text", text: "Hi there!" }]);
});

test("openaiResponsesToOpenAIRequest: should group reasoning, text and tool calls", () => {
  const body = {
    input: [
      {
        type: "reasoning",
        summary: [{ type: "summary_text", text: "I should call a tool" }],
      },
      {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "Calling tool..." }],
      },
      {
        type: "function_call",
        call_id: "call_1",
        name: "test_tool",
        arguments: "{}",
      },
    ],
  };

  const result = openaiResponsesToOpenAIRequest("big-pickle", body, true, {
    provider: "opencode-zen",
  });
  const messages = result.messages;

  assert.equal(messages.length, 1);
  assert.equal(messages[0].role, "assistant");
  assert.equal(messages[0].reasoning_content, "I should call a tool");
  assert.deepEqual(messages[0].content, [{ type: "text", text: "Calling tool..." }]);
  assert.ok(Array.isArray(messages[0].tool_calls));
  assert.equal(messages[0].tool_calls.length, 1);
  assert.equal(messages[0].tool_calls[0].function.name, "test_tool");
});

test("openaiResponsesToOpenAIRequest: should handle orphan reasoning at start", () => {
  const body = {
    input: [
      {
        type: "reasoning",
        summary: [{ type: "summary_text", text: "Thinking..." }],
      },
    ],
  };

  const result = openaiResponsesToOpenAIRequest("big-pickle", body, true, {
    provider: "opencode-zen",
  });
  const messages = result.messages;

  assert.equal(messages.length, 1);
  assert.equal(messages[0].role, "assistant");
  assert.equal(messages[0].reasoning_content, "Thinking...");
  assert.equal(messages[0].content, null);
});
