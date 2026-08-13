import test from "node:test";
import assert from "node:assert/strict";

/**
 * agentrouter.org quota model:
 *  - "额度不足" (quota insufficient) is ACCOUNT-wide and temporary → lock the
 *    connection (scope "connection") so combo routing moves to another
 *    account/provider instead of hammering the same key.
 *  - "无权访问模型" (no access to this model) is permanent PER MODEL → lock only
 *    the model (scope "model"); the connection keeps serving other models.
 * Status matching accepts both the raw upstream 403 AND the restated 429
 * (upstreamStatusRestatement.ts rewrites 403→429 before classification).
 */

const { providerRuleRegistry, getProviderErrorRuleMatch } = await import(
  "../../open-sse/config/providerErrorRules.ts"
);
const { classifyError, checkFallbackError } = await import(
  "../../open-sse/services/accountFallback.ts"
);
const { RateLimitReason } = await import("../../open-sse/config/constants.ts");

test("A1: agentrouter is registered in providerRuleRegistry", () => {
  const rules = providerRuleRegistry.get("agentrouter");
  assert.ok(rules && rules.length > 0);
});

test("A2: quota body → quota_exhausted scope connection (restated 429)", () => {
  const match = getProviderErrorRuleMatch("agentrouter", 429, {}, {
    error: { message: "用户额度不足，请充值" },
  });
  assert.ok(match, "quota body must match");
  assert.equal(match.reason, "quota_exhausted");
  assert.equal(match.scope, "connection");
});

test("A3: quota body also matches the raw (pre-restatement) 403", () => {
  const match = getProviderErrorRuleMatch("agentrouter", 403, {}, "用户额度不足");
  assert.ok(match);
  assert.equal(match.reason, "quota_exhausted");
});

test("A4: 无权访问模型 → auth_error scope model (model lockout, not connection)", () => {
  const match = getProviderErrorRuleMatch("agentrouter", 403, {}, {
    error: { message: "无权访问模型 claude-sonnet-4" },
  });
  assert.ok(match);
  assert.equal(match.reason, "auth_error");
  assert.equal(match.scope, "model");
});

test("A5: classifyError integration — quota text wins over the 403→AUTH_ERROR status fallback", () => {
  const reason = classifyError(403, "用户额度不足", {
    provider: "agentrouter",
    headers: {},
    body: { error: { message: "用户额度不足" } },
  });
  assert.equal(reason, RateLimitReason.QUOTA_EXHAUSTED);
});

test("A6: guard — restated quota error is retryable, never terminal", () => {
  const result = checkFallbackError(429, "用户额度不足", 0, null, "agentrouter", null);
  assert.equal(result.shouldFallback, true);
  assert.ok(!result.permanent, "quota misstatus must never be permanent");
  assert.ok(!result.creditsExhausted, "must not trip CREDITS_EXHAUSTED_SIGNALS");
  assert.ok(result.cooldownMs > 0, "must carry a real cooldown");
});

test("A7: guard — raw 403 quota (hook bypassed) is still not account-deactivation", () => {
  const result = checkFallbackError(403, "用户额度不足", 0, null, "agentrouter", null);
  assert.equal(result.shouldFallback, true);
  assert.ok(!result.permanent);
});

test("A8: plain agentrouter 403 (no quota text) keeps the default apikey auth path", () => {
  const match = getProviderErrorRuleMatch("agentrouter", 403, {}, "Invalid API key");
  assert.equal(match, null);
});
