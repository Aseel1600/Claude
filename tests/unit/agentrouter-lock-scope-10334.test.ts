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

async function seedConnection(
  provider: string,
  overrides: Record<string, unknown> = {}
): Promise<string> {
  const conn = await providersDb.createProviderConnection({
    provider,
    authType: "apikey",
    apiKey: `${provider}-key`,
    isActive: true,
    testStatus: "active",
    ...overrides,
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

  // Positive assertion, not just the negative: the model lockout must have
  // actually been recorded. Without this, a future refactor that stops
  // locking anything for these providers would pass this test silently.
  const lockout = accountFallback.getModelLockoutInfo("ollama-cloud", connId, "claude-opus-5");
  assert.ok(lockout, "expected the pre-existing per-model lockout to be recorded");
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

  // Positive assertion, not just the negative — see the ollama-cloud case above.
  const lockout = accountFallback.getModelLockoutInfo("vertex", connId, "claude-opus-5");
  assert.ok(lockout, "expected the pre-existing per-model lockout to be recorded");
});

// ─── Fix round 1 (#10334 review) ───────────────────────────────────────────

// Important finding: the "never terminal" invariant is not structurally
// guaranteed by `ruleScope === "connection"` alone — it depends on the
// provider rule table only ever pairing scope "connection" with a genuinely
// transient reason. isAgentrouterConnectionQuotaScope() is the actual guard;
// pin its predicate directly with synthetic fallbackResult shapes, since no
// rule in the current table produces a permanent/credits-exhausted result
// with scope "connection" (exercising it end-to-end would require editing
// the production rule table just for a test).
test("isAgentrouterConnectionQuotaScope: rejects a permanent rule result even with scope connection", () => {
  const permanentConnectionScopeResult = {
    ruleScope: "connection" as const,
    reason: "auth_error",
    permanent: true,
  };
  assert.equal(
    auth.isAgentrouterConnectionQuotaScope("agentrouter", permanentConnectionScopeResult),
    false,
    "a future permanent-state rule with scope connection must NOT take the transient-cooldown branch"
  );
});

test("isAgentrouterConnectionQuotaScope: rejects a credits-exhausted rule result even with scope connection", () => {
  const creditsExhaustedConnectionScopeResult = {
    ruleScope: "connection" as const,
    reason: "quota_exhausted",
    creditsExhausted: true,
  };
  assert.equal(
    auth.isAgentrouterConnectionQuotaScope("agentrouter", creditsExhaustedConnectionScopeResult),
    false,
    "a future credits-exhausted rule with scope connection must NOT take the transient-cooldown branch"
  );
});

test("isAgentrouterConnectionQuotaScope: accepts the real quota-exhausted/connection shape", () => {
  const quotaConnectionScopeResult = {
    ruleScope: "connection" as const,
    reason: "quota_exhausted",
  };
  assert.equal(
    auth.isAgentrouterConnectionQuotaScope("agentrouter", quotaConnectionScopeResult),
    true,
    "today's only connection-scope rule result (quota_exhausted, no permanent/creditsExhausted) must pass"
  );
});

test("isAgentrouterConnectionQuotaScope: rejects non-agentrouter providers regardless of shape", () => {
  const quotaConnectionScopeResult = {
    ruleScope: "connection" as const,
    reason: "quota_exhausted",
  };
  assert.equal(
    auth.isAgentrouterConnectionQuotaScope("ollama-cloud", quotaConnectionScopeResult),
    false,
    "honorsRuleLockScope must still gate every provider outside the agentrouter allowlist"
  );
});

// Minor finding: guard the branch's POSITION in markAccountUnavailable. If a
// future refactor moved the branch above the terminal-status guard (~line
// 2023) or the anti-thundering-herd guard (~line 2038), a credits_exhausted
// connection would be silently overwritten, or a live cooldown would be
// shortened — and the 6 tests above would stay green because none of them
// seed a connection with pre-existing terminal/cooldown state.
test("position guard: a connection already credits_exhausted stays terminal through an agentrouter quota 429", async () => {
  await resetStorage();
  const connId = await seedConnection("agentrouter", { testStatus: "credits_exhausted" });

  const result = await auth.markAccountUnavailable(
    connId,
    429,
    QUOTA_EXHAUSTED_429,
    "agentrouter",
    "claude-opus-5"
  );

  assert.equal(result.shouldFallback, true);
  assert.equal(result.cooldownMs, 0, "terminal-status short-circuit returns cooldownMs 0");

  const after = await providersDb.getProviderConnectionById(connId);
  assert.equal(
    after.testStatus,
    "credits_exhausted",
    "the connection-scope branch must never overwrite a pre-existing terminal status"
  );
});

test("position guard: an existing live cooldown is not shortened by the connection-scope branch", async () => {
  await resetStorage();
  const futureCooldown = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const connId = await seedConnection("agentrouter", {
    testStatus: "unavailable",
    rateLimitedUntil: futureCooldown,
  });

  const result = await auth.markAccountUnavailable(
    connId,
    429,
    QUOTA_EXHAUSTED_429,
    "agentrouter",
    "claude-opus-5"
  );

  assert.equal(result.shouldFallback, true);

  const after = await providersDb.getProviderConnectionById(connId);
  assert.equal(
    after.rateLimitedUntil,
    futureCooldown,
    "the anti-thundering-herd guard must win: an existing live cooldown must not be reset/shortened"
  );
});

// Minor finding: disableCooling=true skips the connection-scope branch (the
// `!disableCooling` condition), so the #10334 bug survives for connections
// with that opt-out — they fall into the ~30min per-model lockout instead of
// the shorter connection cooldown. Documented in the block comment above the
// branch; pin the behavior so a future change to the guard is deliberate.
test("disableCooling=true skips the connection-scope branch and falls back to per-model lockout", async () => {
  await resetStorage();
  const connId = await seedConnection("agentrouter", {
    providerSpecificData: { disableCooling: true },
  });

  const result = await auth.markAccountUnavailable(
    connId,
    429,
    QUOTA_EXHAUSTED_429,
    "agentrouter",
    "claude-opus-5"
  );

  assert.equal(result.shouldFallback, true);

  const after = await providersDb.getProviderConnectionById(connId);
  // Connection is NOT cooled down — disableCooling's documented CONNECTION-
  // level opt-out (#2997) is honored.
  assert.equal(after.testStatus, "active");
  assert.ok(!after.rateLimitedUntil, "disableCooling must keep the connection selectable");

  // But the model IS locked out instead (the #10334 bug's exact symptom for
  // disableCooling connections — a deliberate, documented trade-off).
  const lockout = accountFallback.getModelLockoutInfo("agentrouter", connId, "claude-opus-5");
  assert.ok(
    lockout,
    "expected a per-model lockout when disableCooling bypasses the connection branch"
  );
});
