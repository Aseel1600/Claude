import test from "node:test";
import assert from "node:assert/strict";

const { shouldUseApiKeyConnectionTest } =
  await import("../../src/app/api/providers/[id]/test/webSessionTestDispatch.ts");

test("normal API-key connections keep the API-key test path", () => {
  assert.equal(shouldUseApiKeyConnectionTest("apikey", "openai"), true);
});

test("token-kind cookie-auth web sessions use the API-key test path", () => {
  assert.equal(shouldUseApiKeyConnectionTest("cookie", "deepseek-web"), true);

  assert.equal(shouldUseApiKeyConnectionTest("cookie", "zai-web"), true);
});

test("cookie-kind web sessions do not use the API-key test path", () => {
  assert.equal(shouldUseApiKeyConnectionTest("cookie", "chatgpt-web"), false);

  assert.equal(shouldUseApiKeyConnectionTest("cookie", "claude-web"), false);
});

test("other auth types are not broadened", () => {
  assert.equal(shouldUseApiKeyConnectionTest("oauth", "deepseek-web"), false);

  assert.equal(shouldUseApiKeyConnectionTest(null, "deepseek-web"), false);
});
