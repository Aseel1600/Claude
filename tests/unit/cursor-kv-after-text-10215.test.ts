// #10215: kv_server_message must NOT terminate the turn for non-composer
// models. On grok-4.5-high this checkpoint arrives mid-stream before tool
// calls are decoded — terminating early truncates pending exec_mcp events.
import { test } from "node:test";
import assert from "node:assert/strict";

// We cannot easily import processFrame directly (it is not exported),
// so we test through the observable behavior: the StreamCtx endReason
// after receiving kv_server_message for different model families.

// Instead, verify the isComposerModel gating logic in isolation.
const { isComposerModel } = await import("../../open-sse/executors/cursor/composer.ts");

test("isComposerModel returns true for composer-2.5", () => {
  assert.equal(isComposerModel("composer-2.5"), true);
});

test("isComposerModel returns false for grok-4.5-high", () => {
  assert.equal(isComposerModel("grok-4.5-high"), false);
});

test("isComposerModel returns false for generic models", () => {
  assert.equal(isComposerModel("gpt-4"), false);
  assert.equal(isComposerModel("claude-3.5-sonnet"), false);
});
