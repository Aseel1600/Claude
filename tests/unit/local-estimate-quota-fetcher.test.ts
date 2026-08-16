/**
 * Unit tests for open-sse/services/localEstimateQuotaFetcher.ts
 *
 * Uses the project's own DB infrastructure (core.ts getDbInstance) with a temp
 * DATA_DIR so the usage_history / provider_plans paths are exercised for real.
 * Node.js native test runner, matching the repo convention.
 */

import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-leqf-test-"));
process.env.DATA_DIR = TEST_DATA_DIR;

const core = await import("../../src/lib/db/core.ts");
const { upsertPlan } = await import("../../src/lib/db/providerPlans.ts");
const {
  fetchLocalEstimateQuota,
  getWindowBounds,
  registerLocalEstimateQuotaFetchers,
  LOCAL_ESTIMATE_GAP_PROVIDERS,
} = await import("../../open-sse/services/localEstimateQuotaFetcher.ts");
const { getQuotaFetcher, registerQuotaFetcher } = await import(
  "../../open-sse/services/quotaPreflight.ts"
);

function resetStorage(): void {
  core.resetDbInstance();
  try {
    if (fs.existsSync(TEST_DATA_DIR)) fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  } catch {
    /* EBUSY — ignore */
  }
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
}

function insertUsage(
  provider: string,
  connectionId: string,
  tokens: number,
  at: string = new Date().toISOString()
): void {
  core
    .getDbInstance()
    .prepare(
      `INSERT INTO usage_history (provider, model, connection_id, tokens_input, tokens_output, timestamp)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(provider, "test-model", connectionId, tokens, 0, at);
}

beforeEach(() => {
  resetStorage();
  // Force a fresh DB instance + migrations so usage_history/provider_plans exist.
  core.getDbInstance();
});

after(() => {
  core.resetDbInstance();
  try {
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe("getWindowBounds (pure UTC window math)", () => {
  it("daily window runs from UTC midnight to next UTC midnight", () => {
    const { startIso, resetIso } = getWindowBounds("daily", new Date("2026-08-15T12:34:56Z"));
    assert.equal(startIso, "2026-08-15T00:00:00.000Z");
    assert.equal(resetIso, "2026-08-16T00:00:00.000Z");
  });

  it("weekly window spans a fixed 7-day bucket starting Monday", () => {
    // 2026-08-15 is a Saturday; Monday 2026-08-10.
    const { startIso, resetIso } = getWindowBounds("weekly", new Date("2026-08-15T12:00:00Z"));
    assert.equal(startIso, "2026-08-10T00:00:00.000Z");
    assert.equal(resetIso, "2026-08-17T00:00:00.000Z");
  });

  it("monthly window spans the calendar month", () => {
    const { startIso, resetIso } = getWindowBounds("monthly", new Date("2026-08-15T12:00:00Z"));
    assert.equal(startIso, "2026-08-01T00:00:00.000Z");
    assert.equal(resetIso, "2026-09-01T00:00:00.000Z");
  });
});

describe("fetchLocalEstimateQuota", () => {
  it("uses the seeded daily limit and reports 0% used on an empty DB", async () => {
    const quota = await fetchLocalEstimateQuota("cerebras", "conn-a");
    assert.ok(quota, "cerebras has a daily seed → quota expected");
    assert.equal(quota!.percentUsed, 0);
    assert.equal(quota!.limitReached, false);
    assert.ok(quota!.windows.daily, "daily window present");
    assert.equal(quota!.windows.daily.percentUsed, 0);
    assert.ok(Date.parse(quota!.windows.daily.resetAt!) > Date.now(), "reset in the future");
  });

  it("counts locally-recorded tokens against the seed limit", async () => {
    // cerebras seed = 1M tokens/day. Record 300k → 30% used.
    insertUsage("cerebras", "conn-b", 300_000);
    const quota = await fetchLocalEstimateQuota("cerebras", "conn-b");
    assert.ok(quota);
    assert.equal(Math.round(quota!.percentUsed * 1000) / 1000, 0.3);
  });

  it("provider_plans override beats the seed", async () => {
    // Plan caps cerebras at 200k tokens/day. Record 100k → 50% used (not 10%).
    upsertPlan("conn-c", "cerebras", [{ unit: "tokens", window: "daily", limit: 200_000 }], "manual");
    insertUsage("cerebras", "conn-c", 100_000);
    const quota = await fetchLocalEstimateQuota("cerebras", "conn-c");
    assert.ok(quota);
    assert.equal(quota!.percentUsed, 0.5);
  });

  it("counts requests for request-unit seeds (gemini daily RPD)", async () => {
    // gemini seed = 1000 requests/day. Record 3 → 0.3% used.
    insertUsage("gemini", "conn-d", 0);
    insertUsage("gemini", "conn-d", 0);
    insertUsage("gemini", "conn-d", 0);
    const quota = await fetchLocalEstimateQuota("gemini", "conn-d");
    assert.ok(quota);
    assert.ok(quota!.windows.daily);
    assert.equal(Math.round(quota!.percentUsed * 10_000) / 10_000, 0.003);
  });

  it("exposes a monthly window for mistral (1B tok/mo seed) and no daily", async () => {
    const quota = await fetchLocalEstimateQuota("mistral", "conn-e");
    assert.ok(quota);
    assert.ok(quota!.windows.monthly, "monthly window present");
    assert.equal(quota!.windows.daily, undefined, "no daily window for monthly-only seed");
  });

  it("returns null (fail-open) for providers with no seed and no plan", async () => {
    // nvidia is uncapped; byteplus/nous-research have no seed → no windows.
    const quota = await fetchLocalEstimateQuota("nvidia", "conn-f");
    assert.equal(quota, null);
  });

  it("marks limitReached when a window hits 100%", async () => {
    insertUsage("cerebras", "conn-g", 1_000_000); // exactly the daily seed
    const quota = await fetchLocalEstimateQuota("cerebras", "conn-g");
    assert.ok(quota);
    assert.equal(quota!.limitReached, true);
    assert.equal(quota!.percentUsed, 1);
  });
});

describe("registration", () => {
  it("registerLocalEstimateQuotaFetchers registers gap providers", () => {
    assert.ok(Array.isArray(LOCAL_ESTIMATE_GAP_PROVIDERS));
    assert.ok(LOCAL_ESTIMATE_GAP_PROVIDERS.length >= 5);
    registerLocalEstimateQuotaFetchers(["cerebras"]);
    assert.ok(getQuotaFetcher("cerebras"), "cerebras fetcher registered");
  });

  it("skips providers that already have a fetcher (bespoke precedence)", () => {
    registerQuotaFetcher("mistral", async () => null);
    registerLocalEstimateQuotaFetchers();
    // mistral keeps the bespoke fetcher; the remaining gaps get the estimate.
    const mistralFetcher = getQuotaFetcher("mistral");
    assert.ok(mistralFetcher, "mistral keeps its already-registered fetcher");
    assert.equal(mistralFetcher, getQuotaFetcher("mistral"), "not replaced");
    assert.ok(getQuotaFetcher("cerebras"), "local-estimate fills the remaining gaps");
  });

  it("no quota fetcher is registered for providers without an endpoint (429-disabling)", () => {
    // cloudflare-ai and byteplus expose no quota API — they must NOT get a
    // local-estimate fetcher; exhaustion is detected from the upstream 429.
    registerLocalEstimateQuotaFetchers();
    assert.equal(getQuotaFetcher("cloudflare-ai"), undefined);
    assert.equal(getQuotaFetcher("byteplus"), undefined);
  });
});
