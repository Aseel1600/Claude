import test from "node:test";
import assert from "node:assert/strict";
import { translateRequest } from "../../open-sse/translator/index.ts";
import { FORMATS } from "../../open-sse/translator/formats.ts";
import {
  lookupReasoning,
  recordReplay,
  requiresReasoningReplay,
} from "../../open-sse/services/reasoningCache.ts";

// Mock reasoning cache for testing
test("repro: multi-turn reasoning replay with big-pickle", async (t) => {
  const model = "opencode/big-pickle";
  const provider = "opencode-zen";

  // Turn 1: Assistant with tool call
  // Turn 2: Tool result
  // Turn 3: Assistant with text (NEEDS REASONING REPLAY)
  const body = {
    messages: [
      { role: "user", content: "Task" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          { id: "call_1", type: "function", function: { name: "test", arguments: "{}" } },
        ],
      },
      { role: "tool", tool_call_id: "call_1", content: "Result" },
      { role: "assistant", content: "Final answer" },
    ],
    requestId: "test-req-123",
  };

  const result = translateRequest(
    FORMATS.OPENAI,
    FORMATS.OPENAI,
    model,
    body,
    true,
    null,
    provider
  );

  const messages = result.messages;

  // Msg 1: Assistant (index 1)
  // Msg 3: Assistant (index 3)

  console.log("Msg 1 reasoning_content:", messages[1].reasoning_content);
  console.log("Msg 3 reasoning_content:", messages[3].reasoning_content);

  // Verification 1: Msg 1 should have placeholder (since cache lookup with index 0 might fail or succeed depending on logic)
  assert.ok(messages[1].reasoning_content, "First assistant message should have reasoning_content");

  // Verification 2: Msg 3 SHOULD have reasoning_content
  // In the broken version, it will be undefined because isReasoningOnlyReplayTarget misses big-pickle
  // AND the cache lookup uses index 0.
  assert.ok(messages[3].reasoning_content, "Last assistant message should have reasoning_content");
});

test("multi-turn reasoning replay from cache", async (t) => {
  const model = "opencode/big-pickle";
  const provider = "opencode-zen";

  const requestId = "test-req-cache-" + Date.now();
  const cacheKey = `request:${requestId}:message:3`;
  const cachedReasoning = "I have a plan to solve this.";

  // Store in cache
  const { recordReplay } = await import("../../open-sse/services/reasoningCache.ts");
  // We need to use the actual cache implementation
  const { getDbInstance } = await import("../../src/lib/db/core.ts");
  const db = getDbInstance();
  db.prepare(
    "INSERT INTO reasoning_cache (tool_call_id, reasoning, provider, model, expires_at, char_count) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(cacheKey, cachedReasoning, provider, model, Date.now() + 10000, cachedReasoning.length);

  const body = {
    messages: [
      { role: "user", content: "Task" },
      {
        role: "assistant",
        content: "I will use a tool",
        tool_calls: [
          { id: "call_2", type: "function", function: { name: "test", arguments: "{}" } },
        ],
      },
      { role: "tool", tool_call_id: "call_2", content: "Result" },
      { role: "assistant", content: "Final answer" },
    ],
    requestId: requestId,
  };

  const result = translateRequest(
    FORMATS.OPENAI,
    FORMATS.OPENAI,
    model,
    body,
    true,
    null,
    provider
  );

  const messages = result.messages;
  console.log("Msg 3 reasoning_content from cache:", messages[3].reasoning_content);
  assert.equal(
    messages[3].reasoning_content,
    cachedReasoning,
    "Should pick reasoning from cache for turn 3"
  );
});
