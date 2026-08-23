import assert from "node:assert/strict";
import { test } from "node:test";
import { shouldStripCloudCodeThinking } from "../../open-sse/services/cloudCodeThinking.ts";

test("shouldStripCloudCodeThinking correctly normalizes model prefixes and evaluates thinking support", () => {
  assert.equal(shouldStripCloudCodeThinking("antigravity", "antigravity/claude-3-7-sonnet"), true);
  assert.equal(shouldStripCloudCodeThinking("antigravity", "models/antigravity/claude-3-5-haiku"), true);
  assert.equal(shouldStripCloudCodeThinking("antigravity", "gemini-2.5-pro"), false);
});
