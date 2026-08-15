import { test } from "node:test";
import assert from "node:assert/strict";

const { buildStreamingResponseHeaders } = await import(
  "@omniroute/open-sse/handlers/chatCore/responseHeaders.ts"
);

/**
 * #10310 regression guard — Codex quota headers must survive the forwarding budget.
 *
 * Root cause: `getForwardingPriority` only classifies headers containing
 * "ratelimit"/"rate-limit" as high-priority. The entire Codex quota vocabulary
 * (`x-codex-primary/secondary-* used/reset`, `x-codex-credits-*`) fell to the
 * lowest priority tier, tied against bulky CDN/security noise. Because
 * `Headers.forEach` iterates in byte-sorted alphabetical order, a realistic
 * multi-header Codex+CDN response exhausted the 768-byte budget on alphabetically-
 * earlier noise before reaching any `x-codex-*` quota header.
 *
 * Fix: promote Codex quota headers to the rate-limit priority class and push
 * known bulky noise (cf-*, x-codex-turn-state, firewall-sampling-options, ...)
 * to a forced-last tier so they never evict quota data.
 */
const CODEX_QUOTA_HEADERS = [
  "x-codex-primary-used-percent",
  "x-codex-primary-reset-after-seconds",
  "x-codex-secondary-used-percent",
  "x-codex-secondary-reset-after-seconds",
  "x-codex-credits-used",
  "x-codex-credits-remaining",
];

const NOISE_HEADERS = [
  "x-codex-turn-state",
  "fireworks-sampling-options",
  "cf-ray",
  "cf-cache-status",
  "content-security-policy",
];

function buildUpstreamHeaders(): Headers {
  return new Headers({
    "x-request-id": "b6f1c2a4-7e3d-4a1b-9c2e-1234567890ab",
    "anthropic-ratelimit-unified-requests-limit": "5000",
    "anthropic-ratelimit-unified-requests-remaining": "4998",
    "anthropic-ratelimit-unified-reset": "2026-08-14T06:00:00Z",
    "anthropic-organization-id": "org-abc123def456ghi789",
    "alt-svc": 'h3=":443"; ma=86400',
    "cf-cache-status": "DYNAMIC",
    "cf-ray": "89abcdef1234ffff-EWR",
    "content-security-policy":
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'",
    "cross-origin-embedder-policy": "require-corp",
    "cross-origin-opener-policy": "same-origin",
    "cross-origin-resource-policy": "same-origin",
    date: "Fri, 14 Aug 2026 06:00:00 GMT",
    "fireworks-sampling-options": "x".repeat(340),
    nel: '{"report_to":"default","max_age":31536000}',
    "permissions-policy": "geolocation=(), microphone=(), camera=()",
    "referrer-policy": "strict-origin-when-cross-origin",
    "report-to":
      '{"group":"default","max_age":31536000,"endpoints":[{"url":"https://a.example.com/r"}]}',
    "server-timing": "cf-q-config;dur=1.0000002656e-05",
    "strict-transport-security": "max-age=31536000; includeSubDomains; preload",
    "timing-allow-origin": "*",
    vary: "Accept-Encoding, Origin",
    "x-codex-turn-state": "y".repeat(300),
    "x-codex-primary-used-percent": "42.5",
    "x-codex-primary-reset-after-seconds": "1800",
    "x-codex-secondary-used-percent": "10.2",
    "x-codex-secondary-reset-after-seconds": "86400",
    "x-codex-credits-used": "1234",
    "x-codex-credits-remaining": "5678",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "x-robots-tag": "noindex",
    "x-xss-protection": "0",
  });
}

function getHeaderValue(headers: Record<string, string>, name: string): string | undefined {
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return entry?.[1];
}

test("#10310: Codex quota/reset/credits headers survive the forwarding budget", () => {
  const result = buildStreamingResponseHeaders(
    buildUpstreamHeaders(),
    { provider: "codex", model: "gpt-5-codex", cacheHit: false, latencyMs: 0, usage: null, costUsd: 0 },
    null
  );

  const missing = CODEX_QUOTA_HEADERS.filter((name) => !(name in result));
  assert.deepEqual(
    missing,
    [],
    `Codex quota headers were dropped by the forwarding budget: ${missing.join(", ")}`
  );
});

test("#10310: bulky non-quota noise is dropped instead of evicting quota headers", () => {
  const result = buildStreamingResponseHeaders(
    buildUpstreamHeaders(),
    { provider: "codex", model: "gpt-5-codex", cacheHit: false, latencyMs: 0, usage: null, costUsd: 0 },
    null
  );

  for (const name of CODEX_QUOTA_HEADERS) {
    assert.ok(name in result, `${name} must be forwarded`);
  }
  // Anthropic rate-limit class must remain intact after reprioritization.
  const anthropicReset = getHeaderValue(result, "anthropic-ratelimit-unified-reset");
  assert.ok(
    anthropicReset && anthropicReset === "2026-08-14T06:00:00Z",
    "anthropic-ratelimit-unified-reset must survive"
  );
  // Known bulky noise may be dropped when the budget is tight.
  const confinedToNoise = NOISE_HEADERS.every(
    (name) => !(Object.keys(result).some((key) => key.toLowerCase() === name.toLowerCase()))
  );
  assert.ok(confinedToNoise, "noise headers should be the ones dropped, not quota");
});