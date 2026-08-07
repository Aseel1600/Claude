import test from "node:test";
import assert from "node:assert/strict";

const { stripInternalReasoningPlaceholder } =
  await import("../../open-sse/utils/reasoningPlaceholder.ts");

test("stripInternalReasoningPlaceholder ignores non-string upstream content", () => {
  assert.equal(stripInternalReasoningPlaceholder({ type: "text", text: "hello" }), "");
  assert.equal(stripInternalReasoningPlaceholder(["hello"]), "");
  assert.equal(stripInternalReasoningPlaceholder("hello"), "hello");
});
