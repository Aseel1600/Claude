import { test } from "node:test";
import assert from "node:assert/strict";
import { parseProviderQuotaHeaders, applyQuotaHeadersToState } from "../../src/lib/quota/quotaAdapters.ts";
import { getQuotaAnalyticsSummary } from "../../src/lib/quota/quotaAnalytics.ts";
import { getActiveQuotaResetItems, resetExpiredQuotaWindows } from "../../src/lib/quota/quotaResetTimers.ts";
import { recordProviderQuotaUsage, getProviderQuota } from "../../src/lib/quota/providerQuotaState.ts";

test("parseProviderQuotaHeaders: parses OpenAI rate limit headers", () => {
  const headers = new Headers({
    "x-ratelimit-limit-tokens": "100000",
    "x-ratelimit-remaining-tokens": "80000",
    "x-ratelimit-reset-tokens": "60s",
  });
  const parsed = parseProviderQuotaHeaders(headers, "openai");
  assert.ok(parsed);
  assert.equal(parsed?.tokenLimit, 100000);
  assert.equal(parsed?.tokensRemaining, 80000);
  assert.equal(parsed?.tokensUsed, 20000);
  assert.equal(parsed?.windowResetMs, 60000);
});

test("parseProviderQuotaHeaders: parses Anthropic rate limit headers", () => {
  const headers = new Headers({
    "anthropic-ratelimit-input-tokens-limit": "50000",
    "anthropic-ratelimit-input-tokens-remaining": "10000",
    "anthropic-ratelimit-input-tokens-reset": "30s",
  });
  const parsed = parseProviderQuotaHeaders(headers, "anthropic");
  assert.ok(parsed);
  assert.equal(parsed?.tokenLimit, 50000);
  assert.equal(parsed?.tokensRemaining, 10000);
  assert.equal(parsed?.tokensUsed, 40000);
  assert.equal(parsed?.windowResetMs, 30000);
});

test("applyQuotaHeadersToState & getQuotaAnalyticsSummary: records and aggregates quota analytics", () => {
  const connId = "test-conn-p2-01";
  const model = "gpt-4o";
  const headers = {
    "x-ratelimit-limit-tokens": "100000",
    "x-ratelimit-remaining-tokens": "20000",
    "x-ratelimit-reset-tokens": "120s",
  };

  applyQuotaHeadersToState(connId, model, headers, "openai");

  const snapshot = getProviderQuota(connId, model);
  assert.ok(snapshot);
  assert.equal(snapshot?.tokensUsed, 80000);
  assert.equal(snapshot?.tokenLimit, 100000);

  const analytics = getQuotaAnalyticsSummary();
  assert.ok(analytics.totalConnectionsTracked > 0);
  assert.ok(analytics.connections.some((c) => c.connectionId === connId));
});

test("quotaResetTimers: tracks active reset items and purges expired windows", () => {
  const connId = "test-conn-expired";
  const model = "claude-sonnet-4-6";
  const now = Date.now();
  
  // Record already expired window
  recordProviderQuotaUsage(connId, model, 5000, 5000, now - 10000, now - 1000);

  const expiredCount = resetExpiredQuotaWindows();
  assert.ok(expiredCount >= 1);
});
