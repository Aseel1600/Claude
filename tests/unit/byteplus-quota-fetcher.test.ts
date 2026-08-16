/**
 * Unit tests for open-sse/services/byteplusQuotaFetcher.ts
 * (BytePlus ModelArk usage probe; fail-open to local estimate).
 */

import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";

const {
  fetchByteplusQuota,
  registerByteplusQuotaFetcher,
} = await import("../../open-sse/services/byteplusQuotaFetcher.ts");
const { getQuotaFetcher } = await import("../../open-sse/services/quotaPreflight.ts");

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("fetchByteplusQuota", () => {
  it("returns null without an apiKey (fail-open)", async () => {
    const quota = await fetchByteplusQuota(`bp-${Date.now()}`, {});
    assert.equal(quota, null);
  });

  it("parses an Ark usage payload into a daily window", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          usage: { tokens: { used: 40_000, limit: 100_000, reset_at: "2026-08-16T00:00:00Z" } },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )) as typeof fetch;

    const quota = await fetchByteplusQuota(`bp-${Date.now()}`, { apiKey: "ark-key" });
    assert.ok(quota);
    assert.equal(quota!.percentUsed, 0.4);
    assert.ok(quota!.windows.daily);
    assert.equal(quota!.resetAt, "2026-08-16T00:00:00Z");
  });

  it("returns null on upstream 404 (falls back to local estimate upstream)", async () => {
    globalThis.fetch = (async () => new Response("not found", { status: 404 })) as typeof fetch;
    const quota = await fetchByteplusQuota(`bp-${Date.now()}`, { apiKey: "ark-key" });
    assert.equal(quota, null);
  });

  it("registers a hybrid fetcher for byteplus", () => {
    registerByteplusQuotaFetcher();
    assert.ok(getQuotaFetcher("byteplus"));
  });
});
