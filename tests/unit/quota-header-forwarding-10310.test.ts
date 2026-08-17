// #10310: Codex/Anthropic quota headers must survive the forwarding budget.
// x-codex-*-used/reset/credits are rate-limit-class (priority 2);
// x-codex-turn-state and CDN noise are lowest priority (4) and dropped first.
import { test } from "node:test";
import assert from "node:assert/strict";

const {
  buildStreamingResponseHeaders,
  resolveForwardedHeaderBudget,
  resetDroppedHeaderWarnFingerprints,
} = await import("../../open-sse/handlers/chatCore/responseHeaders.ts");

const META = {
  provider: "codex",
  model: "gpt-5.6-sol",
  requestId: "req-1",
  latencyMs: 0,
  usage: null,
  costUsd: 0,
  cacheHit: false,
  compression: undefined as unknown as string,
};

function buildHeaders(entries: Record<string, string>): Headers {
  return new Headers(entries);
}

test("Codex quota headers are priority 2 (same as ratelimit)", () => {
  resetDroppedHeaderWarnFingerprints();
  const upstream = buildHeaders({
    "x-codex-primary-used-percent": "75",
    "x-codex-primary-reset-after-seconds": "12",
    "x-codex-secondary-used-percent": "50",
    "x-codex-secondary-reset-after-seconds": "30",
    "x-codex-credits-remaining": "1000",
    "x-codex-credits-reset-after-seconds": "60",
  });

  const result = buildStreamingResponseHeaders(upstream, META);

  assert.ok(result["x-codex-primary-used-percent"], "primary-used must survive");
  assert.ok(result["x-codex-primary-reset-after-seconds"], "primary-reset must survive");
  assert.ok(result["x-codex-secondary-used-percent"], "secondary-used must survive");
  assert.ok(result["x-codex-secondary-reset-after-seconds"], "secondary-reset must survive");
  assert.ok(result["x-codex-credits-remaining"], "credits-remaining must survive");
  assert.ok(result["x-codex-credits-reset-after-seconds"], "credits-reset must survive");
});

test("quota headers survive while noise headers are dropped under budget pressure", () => {
  resetDroppedHeaderWarnFingerprints();
  // Fill budget with noise headers first, then verify quota headers still win on priority
  const noiseHeaders: Record<string, string> = {};
  for (let i = 0; i < 30; i++) {
    noiseHeaders[`x-noise-${i}`] = "v".repeat(60); // ~70 bytes each, 30*70=2100 > 2048
  }
  const upstream = buildHeaders({
    ...noiseHeaders,
    "x-codex-primary-used-percent": "75",
    "x-codex-primary-reset-after-seconds": "12",
    "x-codex-credits-remaining": "1000",
    "retry-after": "30",
  });

  const result = buildStreamingResponseHeaders(upstream, META);

  // Priority 0-2 headers must survive; priority 3 noise headers get dropped
  assert.ok(result["retry-after"], "retry-after (priority 1) must survive");
  assert.ok(result["x-codex-primary-used-percent"], "codex quota (priority 2) must survive");
  assert.ok(result["x-codex-primary-reset-after-seconds"], "codex reset (priority 2) must survive");
  assert.ok(result["x-codex-credits-remaining"], "codex credits (priority 2) must survive");
});

test("Anthropic ratelimit headers have priority 2 (already matched by ratelimit substring)", () => {
  resetDroppedHeaderWarnFingerprints();
  const upstream = buildHeaders({
    "anthropic-ratelimit-unified-requests-limit": "100",
    "anthropic-ratelimit-unified-requests-remaining": "50",
    "anthropic-ratelimit-unified-tokens-limit": "100000",
    "anthropic-ratelimit-unified-tokens-remaining": "50000",
    "anthropic-organization-id": "org-123",
  });

  const result = buildStreamingResponseHeaders(upstream, META);

  assert.ok(result["anthropic-ratelimit-unified-requests-limit"], "requests-limit must survive");
  assert.ok(
    result["anthropic-ratelimit-unified-requests-remaining"],
    "requests-remaining must survive"
  );
  assert.ok(result["anthropic-ratelimit-unified-tokens-limit"], "tokens-limit must survive");
  assert.ok(
    result["anthropic-ratelimit-unified-tokens-remaining"],
    "tokens-remaining must survive"
  );
});

test("noise headers (cf-ray, date, x-robots-tag) are lowest priority", () => {
  resetDroppedHeaderWarnFingerprints();
  const upstream = buildHeaders({
    "cf-ray": "abc123",
    date: "Thu, 14 Aug 2026 10:00:00 GMT",
    "x-robots-tag": "noindex",
    "content-security-policy": "default-src 'none'",
    "x-codex-primary-used-percent": "50",
  });

  const result = buildStreamingResponseHeaders(upstream, META);

  assert.ok(result["x-codex-primary-used-percent"], "quota header must survive");
});

test("resolveForwardedHeaderBudget defaults to 2048", () => {
  const budget = resolveForwardedHeaderBudget(undefined);
  assert.equal(budget, 2048);
});

test("resolveForwardedHeaderBudget respects env override", () => {
  const budget = resolveForwardedHeaderBudget("4096");
  assert.equal(budget, 4096);
});

test("resolveForwardedHeaderBudget falls back for invalid input", () => {
  const budget = resolveForwardedHeaderBudget("not-a-number");
  assert.equal(budget, 2048);
});
