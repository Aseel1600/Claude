/**
 * Unit tests for open-sse/services/cloudflareAiQuotaFetcher.ts
 * (Workers AI daily-limits probe; fail-open to local estimate).
 */

import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-cfq-test-"));

const {
  fetchCloudflareAiQuota,
  registerCloudflareAiQuotaFetcher,
} = await import("../../open-sse/services/cloudflareAiQuotaFetcher.ts");
const { getQuotaFetcher } = await import("../../open-sse/services/quotaPreflight.ts");

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("fetchCloudflareAiQuota", () => {
  it("returns null without credentials (fail-open)", async () => {
    const quota = await fetchCloudflareAiQuota(`cf-${Date.now()}`, {});
    assert.equal(quota, null);
  });

  it("parses Workers AI neuron limits into a daily window", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          success: true,
          result: { neuronsUsed: 2_500, neuronsLimit: 10_000, nextResetAt: "2026-08-16T00:00:00Z" },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )) as typeof fetch;

    const quota = await fetchCloudflareAiQuota(`cf-${Date.now()}`, {
      providerSpecificData: { cloudflareApiToken: "tok", cloudflareAccountId: "acct" },
    });
    assert.ok(quota);
    assert.equal(quota!.percentUsed, 0.25);
    assert.equal(quota!.limitReached, false);
    assert.ok(quota!.windows.daily);
    assert.equal(quota!.windows.daily.percentUsed, 0.25);
    assert.equal(quota!.resetAt, "2026-08-16T00:00:00Z");
  });

  it("returns null on upstream 404 (falls back to local estimate upstream)", async () => {
    globalThis.fetch = (async () => new Response("not found", { status: 404 })) as typeof fetch;
    const quota = await fetchCloudflareAiQuota(`cf-${Date.now()}`, {
      providerSpecificData: { cloudflareApiToken: "tok", cloudflareAccountId: "acct" },
    });
    assert.equal(quota, null);
  });

  it("registers a hybrid fetcher for cloudflare-ai", () => {
    registerCloudflareAiQuotaFetcher();
    assert.ok(getQuotaFetcher("cloudflare-ai"));
  });
});
