/**
 * #8 (OmniCopilot) — the usage command answered `text/plain`, which a UI cannot
 * parse safely. The structured form (`?format=json`) returns the same
 * `ApiKeyUsageLimitStatus` + `UsageSnapshot` the text is rendered from.
 *
 * These tests pin the contract the extension depends on: JSON when asked,
 * text by default, the 403 as a structured reason rather than a bare string,
 * and an error body that never carries a stack trace.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { handleInternalUsageCommandHttpRequest } from "../../src/lib/usage/internalUsageCommand";

const NOW = Date.parse("2026-08-19T12:00:00.000Z");

const LIMIT_STATUS = {
  enabled: true,
  dailyLimitUsd: 5,
  weeklyLimitUsd: 20,
  dailySpentUsd: 1.25,
  weeklySpentUsd: 8,
  dailyWindowStartIso: "2026-08-19T03:00:00.000Z",
  dailyResetAtIso: "2026-08-20T03:00:00.000Z",
  weeklyWindowStartIso: "2026-08-16T03:00:00.000Z",
  weeklyResetAtIso: "2026-08-23T03:00:00.000Z",
  dailyExceeded: false,
  weeklyExceeded: false,
};

function allowedDeps(overrides: Record<string, unknown> = {}) {
  return {
    now: () => NOW,
    isValidApiKey: async (apiKey: string) => apiKey === "sk-allowed",
    getApiKeyMetadata: async () => ({
      id: "key-allowed",
      name: "panel key",
      allowUsageCommand: true,
      usageLimitEnabled: true,
    }),
    getProviderConnections: async () => [
      { id: "conn-claude", provider: "claude", isActive: true },
    ],
    getAllProviderLimitsCache: () => ({
      "conn-claude": {
        plan: "Claude Max",
        quotas: {
          weekly: { used: 25, total: 100, remaining: 75, resetAt: "2026-08-25T03:00:00.000Z" },
        },
        message: null,
        fetchedAt: new Date(NOW).toISOString(),
      },
    }),
    getProviderConnectionById: async () => null,
    getProviderLimitsCache: () => null,
    getQuotaPolicy: async () => ({ defaultThresholdPercent: 0, providerWindowDefaults: {} }),
    getApiKeyUsageLimitStatus: async () => LIMIT_STATUS,
    ...overrides,
  };
}

test("om-usage ?format=json returns the structured personal + provider quota", async () => {
  const response = await handleInternalUsageCommandHttpRequest(
    new Request("http://localhost/api/usage/om-usage?format=json", {
      headers: { Authorization: "Bearer sk-allowed" },
    }),
    allowedDeps()
  );

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /application\/json/);
  const body = (await response.json()) as {
    allowed: boolean;
    personal: { dailySpentUsd: number } | null;
    provider: { provider: string; connectionId: string } | null;
  };
  assert.equal(body.allowed, true);
  assert.equal(body.personal?.dailySpentUsd, 1.25);
  assert.equal(body.provider?.provider, "claude");
  assert.equal(body.provider?.connectionId, "conn-claude");
});

test("om-usage without ?format stays text/plain (the historical contract)", async () => {
  const response = await handleInternalUsageCommandHttpRequest(
    new Request("http://localhost/api/usage/om-usage", {
      headers: { Authorization: "Bearer sk-allowed" },
    }),
    allowedDeps()
  );

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /text\/plain/);
  const text = await response.text();
  assert.match(text, /Personal quota/);
  assert.match(text, /Provider quota/);
});

test("om-usage ?format=json reports a disallowed key as structured allowed:false", async () => {
  // A usage panel must tell "this key may not ask" apart from "no data yet",
  // which a bare 403 text body cannot express.
  const response = await handleInternalUsageCommandHttpRequest(
    new Request("http://localhost/api/usage/om-usage?format=json", {
      headers: { Authorization: "Bearer sk-allowed" },
    }),
    allowedDeps({
      getApiKeyMetadata: async () => ({ id: "key-off", allowUsageCommand: false }),
    })
  );

  assert.equal(response.status, 403);
  const body = (await response.json()) as { allowed: boolean };
  assert.equal(body.allowed, false);
});

test("om-usage ?format=json rejects an invalid key and never leaks a stack trace", async () => {
  const response = await handleInternalUsageCommandHttpRequest(
    new Request("http://localhost/api/usage/om-usage?format=json", {
      headers: { Authorization: "Bearer sk-wrong" },
    }),
    allowedDeps()
  );

  assert.equal(response.status, 401);
  const body = (await response.json()) as { allowed: boolean; error?: { message?: string } };
  assert.equal(body.allowed, false);
  assert.ok(
    !body.error?.message?.includes("at /"),
    "error bodies must not carry stack frames (ERROR_SANITIZATION)"
  );
});
