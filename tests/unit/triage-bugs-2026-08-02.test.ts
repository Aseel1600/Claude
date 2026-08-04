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

const { geminiToClaudeResponse } =
  await import("../../open-sse/translator/response/gemini-to-claude.ts");

// #9177: Gemini-to-Claude must preserve request-mapped TitleCase tool names
test("#9177 Gemini-to-Claude must preserve request-mapped TitleCase tool names", () => {
  const state = {
    toolNameMap: new Map([["write", "Write"]]),
    contentBlockIndex: 0,
    openTextBlockIdx: null,
  };
  const events = geminiToClaudeResponse({
    response: {
      responseId: "resp-1",
      modelVersion: "gemini-test",
      candidates: [{
        content: { parts: [{ functionCall: { id: "call-1", name: "write", args: {} } }] },
        finishReason: "STOP",
      }],
    },
  }, state);
  const start = events.find((event) => event.type === "content_block_start");
  assert.equal(start?.content_block?.name, "Write");
});
