import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-opencode-go-ledger-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.DISABLE_SQLITE_AUTO_BACKUP = "true";
process.env.API_KEY_SECRET = "opencode-go-ledger-test-secret";

const core = await import("../../src/lib/db/core.ts");
const usageHistory = await import("../../src/lib/usage/usageHistory.ts");
const { getOpenCodeGoLocalUsage } =
  await import("../../src/lib/usage/openCodeGoWindowLedger.ts");

async function resetStorage() {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
}

test.beforeEach(resetStorage);

test.after(() => {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

test("OpenCode Go ledger calculates official 5h, weekly, monthly, and per-model budgets", async () => {
  const now = Date.parse("2026-08-17T12:00:00.000Z");
  const connectionId = "opencode-go-ledger";

  await usageHistory.saveRequestUsage({
    provider: "opencode-go",
    model: "kimi-k3-max",
    connectionId,
    tokens: { input: 1_000_000, output: 0 },
    timestamp: "2026-08-17T11:00:00.000Z",
  });
  await usageHistory.saveRequestUsage({
    provider: "opencode-go",
    model: "qwen3.8-max",
    connectionId,
    tokens: { input: 1_000_000, output: 0 },
    timestamp: "2026-08-17T10:00:00.000Z",
  });
  await usageHistory.saveRequestUsage({
    provider: "opencode-go",
    model: "hy3-high",
    connectionId,
    tokens: { input: 1_000_000, output: 0 },
    timestamp: "2026-08-15T12:00:00.000Z",
  });
  await usageHistory.saveRequestUsage({
    provider: "opencode-go",
    model: "qwen3.7-plus",
    connectionId,
    tokens: { input: 1_000_000, output: 0 },
    timestamp: "2026-08-08T12:00:00.000Z",
  });

  const result = getOpenCodeGoLocalUsage({ connectionId, now });

  assert.equal(result.quotas.session.used, 5);
  assert.equal(result.quotas.session.total, 12);
  assert.equal(result.quotas.weekly.used, 5.14);
  assert.equal(result.quotas.weekly.total, 30);
  assert.equal(result.quotas.monthly.used, 6.34);
  assert.equal(result.quotas.monthly.total, 60);
  assert.equal(result.requestsPriced, 4);
  assert.deepEqual(result.unknownModels, []);

  const kimi = result.modelMonthly.find((model) => model.model === "kimi-k3");
  assert.equal(kimi?.used, 3);
  assert.equal(kimi?.total, 15);
  assert.equal(kimi?.effectiveRemainingUsd, 7);

  const hy3 = result.modelMonthly.find((model) => model.model === "hy3");
  assert.equal(hy3?.used, 0.14);
  assert.equal(hy3?.total, 60);
});

test("OpenCode Go ledger isolates connections and reports unknown models", async () => {
  const now = Date.parse("2026-08-17T12:00:00.000Z");
  await usageHistory.saveRequestUsage({
    provider: "opencode-go",
    model: "unknown-go-model",
    connectionId: "target",
    tokens: { input: 1_000_000, output: 0 },
    timestamp: "2026-08-17T11:00:00.000Z",
  });
  await usageHistory.saveRequestUsage({
    provider: "opencode-go",
    model: "kimi-k3",
    connectionId: "other",
    tokens: { input: 1_000_000, output: 0 },
    timestamp: "2026-08-17T11:00:00.000Z",
  });

  const result = getOpenCodeGoLocalUsage({ connectionId: "target", now });

  assert.equal(result.quotas.session.used, 0);
  assert.equal(result.requestsPriced, 0);
  assert.deepEqual(result.unknownModels, ["unknown-go-model"]);
});
