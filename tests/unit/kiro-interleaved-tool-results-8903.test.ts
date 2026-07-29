import test from "node:test";
import assert from "node:assert/strict";

const { buildKiroPayload } = await import("../../open-sse/translator/request/openai-to-kiro.ts");

const CREDENTIALS = {
  accessToken: "test-token",
  profileArn: "arn:aws:codewhisperer:us-east-1:000000000000:profile/TEST",
  region: "us-east-1",
};

const PARALLEL_TOOL_CALLS = {
  role: "assistant",
  content: null,
  tool_calls: [
    { id: "call_A", type: "function", function: { name: "list_files", arguments: "{}" } },
    { id: "call_B", type: "function", function: { name: "read_file", arguments: "{}" } },
  ],
};

function build(messages) {
  return buildKiroPayload(
    "claude-sonnet-4.5",
    { model: "claude-sonnet-4.5", messages },
    false,
    CREDENTIALS
  );
}

/**
 * Collect every toolUseId advertised by assistant turns and every toolUseId
 * answered by a toolResult, across history plus currentMessage.
 *
 * Bedrock rejects a transcript where an assistant turn advertises toolUses
 * that are never answered ("Expected toolResult blocks"), so these two sets
 * must match.
 */
function collectToolIds(payload) {
  const history = payload?.conversationState?.history ?? [];
  const advertised = [];
  const answered = [];

  for (const entry of history) {
    const toolUses = entry?.assistantResponseMessage?.toolUses;
    if (Array.isArray(toolUses)) {
      for (const use of toolUses) advertised.push(use.toolUseId ?? use.id);
    }
    const toolResults = entry?.userInputMessage?.userInputMessageContext?.toolResults;
    if (Array.isArray(toolResults)) {
      for (const result of toolResults) answered.push(result.toolUseId);
    }
  }

  const currentResults =
    payload?.conversationState?.currentMessage?.userInputMessage?.userInputMessageContext
      ?.toolResults;
  if (Array.isArray(currentResults)) {
    for (const result of currentResults) answered.push(result.toolUseId);
  }

  return { advertised, answered };
}

// --- Characterization: shapes that already work must keep working ----------

test("kiro #8903: consecutive tool messages answer every parallel tool call", () => {
  const payload = build([
    { role: "user", content: "list files then read one" },
    PARALLEL_TOOL_CALLS,
    { role: "tool", tool_call_id: "call_A", content: "a.txt\nb.txt" },
    { role: "tool", tool_call_id: "call_B", content: "hello" },
    { role: "user", content: "thanks" },
  ]);

  const { advertised, answered } = collectToolIds(payload);
  assert.deepEqual(advertised, ["call_A", "call_B"]);
  assert.deepEqual(answered.sort(), ["call_A", "call_B"]);
});

test("kiro #8903: three parallel tool calls are all answered", () => {
  const payload = build([
    { role: "user", content: "go" },
    {
      role: "assistant",
      content: null,
      tool_calls: [
        { id: "c1", type: "function", function: { name: "f1", arguments: "{}" } },
        { id: "c2", type: "function", function: { name: "f2", arguments: "{}" } },
        { id: "c3", type: "function", function: { name: "f3", arguments: "{}" } },
      ],
    },
    { role: "tool", tool_call_id: "c1", content: "r1" },
    { role: "tool", tool_call_id: "c2", content: "r2" },
    { role: "tool", tool_call_id: "c3", content: "r3" },
    { role: "user", content: "next" },
  ]);

  const { advertised, answered } = collectToolIds(payload);
  assert.deepEqual(advertised.sort(), ["c1", "c2", "c3"]);
  assert.deepEqual(answered.sort(), ["c1", "c2", "c3"]);
});

test("kiro #8903: two sequential rounds of parallel tool calls are all answered", () => {
  const payload = build([
    { role: "user", content: "go" },
    PARALLEL_TOOL_CALLS,
    { role: "tool", tool_call_id: "call_A", content: "r1" },
    { role: "tool", tool_call_id: "call_B", content: "r2" },
    {
      role: "assistant",
      content: null,
      tool_calls: [{ id: "call_C", type: "function", function: { name: "grep", arguments: "{}" } }],
    },
    { role: "tool", tool_call_id: "call_C", content: "r3" },
    { role: "user", content: "done" },
  ]);

  const { advertised, answered } = collectToolIds(payload);
  assert.deepEqual(advertised.sort(), ["call_A", "call_B", "call_C"]);
  assert.deepEqual(answered.sort(), ["call_A", "call_B", "call_C"]);
});

test("kiro #8903: transcript ending on tool results still answers every tool call", () => {
  const payload = build([
    { role: "user", content: "go" },
    PARALLEL_TOOL_CALLS,
    { role: "tool", tool_call_id: "call_A", content: "r1" },
    { role: "tool", tool_call_id: "call_B", content: "r2" },
  ]);

  const { advertised, answered } = collectToolIds(payload);
  assert.deepEqual(advertised, ["call_A", "call_B"]);
  assert.deepEqual(answered.sort(), ["call_A", "call_B"]);
});

test("kiro #8903: structured array tool content is answered for every tool call", () => {
  const payload = build([
    { role: "user", content: "go" },
    PARALLEL_TOOL_CALLS,
    { role: "tool", tool_call_id: "call_A", content: [{ type: "text", text: "r1" }] },
    { role: "tool", tool_call_id: "call_B", content: [{ type: "text", text: "r2" }] },
    { role: "user", content: "done" },
  ]);

  const { advertised, answered } = collectToolIds(payload);
  assert.deepEqual(advertised, ["call_A", "call_B"]);
  assert.deepEqual(answered.sort(), ["call_A", "call_B"]);
});

// --- RED: interleaved assistant text drops the trailing tool result --------

test("kiro #8903: assistant text between tool results does not drop a tool result", () => {
  const payload = build([
    { role: "user", content: "list files then read one" },
    PARALLEL_TOOL_CALLS,
    { role: "tool", tool_call_id: "call_A", content: "a.txt\nb.txt" },
    { role: "assistant", content: "Let me check that file." },
    { role: "tool", tool_call_id: "call_B", content: "hello" },
    { role: "user", content: "thanks" },
  ]);

  const { advertised, answered } = collectToolIds(payload);
  assert.deepEqual(advertised, ["call_A", "call_B"]);
  assert.deepEqual(
    answered.sort(),
    ["call_A", "call_B"],
    "every advertised toolUse must have a matching toolResult; Bedrock rejects the transcript otherwise"
  );
});
