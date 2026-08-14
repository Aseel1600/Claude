// #10334 — agentrouter EXCLUSIVE: markAccountUnavailable must honor the
// provider rule's declared lock scope instead of always deriving it from
// hasPerModelQuota(). agentrouter is a passthroughModels provider, so a
// naive account-wide quota exhaustion ("额度不足") would otherwise be treated
// as a per-model 429 and lock only ONE model, leaving combo routing to burn
// one upstream call per remaining model of the same exhausted account. This
// suite pins the connection-scoped cooldown behavior AND its invariants:
// never a terminal status, must also win when the caller is combo (isCombo),
// must not lock the model, and must be EXCLUSIVE to agentrouter — every other
// passthroughModels/compatible provider keeps today's per-model lockout.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-agentrouter-lock-"));
process.env.DATA_DIR = TEST_DATA_DIR;

const core = await import("../../src/lib/db/core.ts");
const providersDb = await import("../../src/lib/db/providers.ts");
const auth = await import("../../src/sse/services/auth.ts");
const accountFallback = await import("../../open-sse/services/accountFallback.ts");

const QUOTA_EXHAUSTED_429 = '{"error":{"message":"账户额度不足，请充值后重试"}}';
const MODEL_ACCESS_DENIED_403 = '{"error":{"message":"无权访问模型 claude-opus-5"}}';

async function resetStorage() {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
}

async function seedConnection(provider: string): Promise<string> {
  const conn = await providersDb.createProviderConnection({
    provider,
    authType: "apikey",
    apiKey: `${provider}-key`,
    isActive: true,
    testStatus: "active",
  });
  return (conn as Record<string, unknown>).id as string;
}

test.after(() => {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

test("agentrouter 429 account quota exhausted -> connection cooldown, never terminal", async () => {
  await resetStorage();
  const connId = await seedConnection("agentrouter");

  const result = await auth.markAccountUnavailable(
    connId,
    429,
    QUOTA_EXHAUSTED_429,
    "agentrouter",
    "claude-opus-5"
  );

  assert.equal(result.shouldFallback, true);
  assert.ok(result.cooldownMs > 0, "connection cooldown must be positive");

  const after = await providersDb.getProviderConnectionById(connId);
  assert.equal(after.testStatus, "unavailable");
  assert.notEqual(after.testStatus, "credits_exhausted");
  assert.ok(after.rateLimitedUntil, "connection must carry a rateLimitedUntil");
  assert.ok(
    new Date(after.rateLimitedUntil).getTime() > Date.now(),
    "rateLimitedUntil must be in the future"
  );
});

test("agentrouter 429 quota exhausted with isCombo: true still cools the connection (not a model lock)", async () => {
  await resetStorage();
  const connId = await seedConnection("agentrouter");

  const result = await auth.markAccountUnavailable(
    connId,
    429,
    QUOTA_EXHAUSTED_429,
    "agentrouter",
    "claude-opus-5",
    null,
    { isCombo: true, persistUnavailableState: false }
  );

  assert.equal(result.shouldFallback, true);
  assert.ok(result.cooldownMs > 0);

  const after = await providersDb.getProviderConnectionById(connId);
  assert.equal(after.testStatus, "unavailable");
  assert.notEqual(after.testStatus, "credits_exhausted");
  assert.ok(after.rateLimitedUntil, "connection must be cooled down even for combo callers");
});

test("agentrouter quota cooldown does NOT lock the model", async () => {
  await resetStorage();
  const connId = await seedConnection("agentrouter");

  await auth.markAccountUnavailable(
    connId,
    429,
    QUOTA_EXHAUSTED_429,
    "agentrouter",
    "claude-opus-5"
  );

  const lockout = accountFallback.getModelLockoutInfo("agentrouter", connId, "claude-opus-5");
  assert.equal(lockout, null, "connection-scoped quota must not also record a model lockout");
});

test("agentrouter 403 model-access-denied -> model lockout, connection stays active", async () => {
  await resetStorage();
  const connId = await seedConnection("agentrouter");

  const result = await auth.markAccountUnavailable(
    connId,
    403,
    MODEL_ACCESS_DENIED_403,
    "agentrouter",
    "claude-opus-5"
  );

  assert.equal(result.shouldFallback, true);

  const after = await providersDb.getProviderConnectionById(connId);
  assert.equal(after.testStatus, "active");
  assert.ok(!after.rateLimitedUntil, "connection must not be rate-limited by a model-scoped rule");

  // #3027's existing per-model-quota-provider branch handles this 403 (it is
  // unmodified by #10334 except that it now reads the rule's declared
  // cooldown via fallbackResult.baseCooldownMs) — the recorded reason stays
  // the pre-existing hardcoded "forbidden", not the rule's "auth_error".
  const lockout = accountFallback.getModelLockoutInfo("agentrouter", connId, "claude-opus-5");
  assert.equal(lockout?.reason, "forbidden");
  // The 6h base cooldown declared by the "agentrouter-model-access-denied"
  // rule (open-sse/config/providerErrorRules.ts) must flow through as
  // fallbackResult.baseCooldownMs instead of the generic
  // COOLDOWN_MS.serviceUnavailable (2s) default — it then gets clamped down
  // to the model-lockout maxCooldownMs setting (default 1_800_000ms / 30min)
  // by recordModelLockoutFailure, same as every other model lockout. What
  // this pins is that the rule's cooldown was consulted at all: a plain 2s
  // default would be immediately visible as a tiny remainingMs, not ~max.
  assert.ok(
    lockout && lockout.remainingMs > 1_700_000,
    `expected the rule cooldown to be clamped to ~maxCooldownMs (1_800_000ms), got ${lockout?.remainingMs}ms`
  );
});

test("exclusivity: ollama-cloud with an equivalent account-wide-looking 429 keeps today's per-model lockout, no connection cooldown", async () => {
  await resetStorage();
  const connId = await seedConnection("ollama-cloud");

  const result = await auth.markAccountUnavailable(
    connId,
    429,
    QUOTA_EXHAUSTED_429,
    "ollama-cloud",
    "claude-opus-5"
  );

  assert.equal(result.shouldFallback, true);

  const after = await providersDb.getProviderConnectionById(connId);
  // ollama-cloud is NOT in the honorsRuleLockScope allowlist: today's
  // per-model-quota behavior for a 429 must be unchanged — connection stays
  // active, no rateLimitedUntil.
  assert.equal(after.testStatus, "active");
  assert.ok(!after.rateLimitedUntil, "non-agentrouter providers must not gain connection cooldown");
});

test("exclusivity: vertex with an equivalent account-wide-looking 429 keeps today's per-model lockout, no connection cooldown", async () => {
  await resetStorage();
  const connId = await seedConnection("vertex");

  const result = await auth.markAccountUnavailable(
    connId,
    429,
    QUOTA_EXHAUSTED_429,
    "vertex",
    "claude-opus-5"
  );

  assert.equal(result.shouldFallback, true);

  const after = await providersDb.getProviderConnectionById(connId);
  assert.equal(after.testStatus, "active");
  assert.ok(!after.rateLimitedUntil, "non-agentrouter providers must not gain connection cooldown");
});
