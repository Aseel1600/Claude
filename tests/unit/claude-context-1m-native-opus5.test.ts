import assert from "node:assert/strict";
import test from "node:test";

import {
  modelHasNativeContext1m,
  modelSupportsContext1mBeta,
} from "../../open-sse/services/claudeCodeCompatible.ts";

test("Opus 5 uses native 1M context instead of the legacy beta tier", () => {
  assert.equal(modelHasNativeContext1m("claude-opus-5"), true);
  assert.equal(modelHasNativeContext1m("claude-opus-5-20260728"), true);
  assert.equal(modelSupportsContext1mBeta("claude-opus-5"), false);
});

test("older Opus models remain eligible for the context-1m beta", () => {
  assert.equal(modelHasNativeContext1m("claude-opus-4-8"), false);
  assert.equal(modelSupportsContext1mBeta("claude-opus-4-8"), true);
});
