import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-team-management-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.API_KEY_SECRET = process.env.API_KEY_SECRET || "team-management-test-secret";

const core = await import("../../src/lib/db/core.ts");
const apiKeys = await import("../../src/lib/db/apiKeys.ts");
const teams = await import("../../src/lib/db/teams.ts");
const usageHistory = await import("../../src/lib/usage/usageHistory.ts");
const aggregateHistory = await import("../../src/lib/usage/aggregateHistory.ts");
const localDb = await import("../../src/lib/localDb.ts");
const teamBudgets = await import("../../src/lib/usage/teamUsageLimits.ts");

async function resetStorage() {
  core.resetDbInstance();
  apiKeys.resetApiKeyState();
  usageHistory.clearPendingRequests();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
}

test.beforeEach(resetStorage);
test.after(() => {
  core.resetDbInstance();
  apiKeys.resetApiKeyState();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

test("migration 153 creates team cost-center schema and immutable usage attribution", () => {
  const db = core.getDbInstance();
  const tables = new Set(
    (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{
        name: string;
      }>
    ).map((row) => row.name)
  );
  assert.ok(tables.has("teams"));
  assert.ok(tables.has("api_key_billing_team_history"));
  assert.ok(tables.has("daily_team_usage_summary"));
  const usageColumns = new Set(
    (db.prepare("PRAGMA table_info(usage_history)").all() as Array<{ name: string }>).map(
      (row) => row.name
    )
  );
  assert.ok(usageColumns.has("billing_team_id"));
});

test("an API key has one active billing team while ACL groups remain independent", async () => {
  const key = await apiKeys.createApiKey("agent-a", "machine-team-01");
  const alpha = teams.createTeam({ name: "Alpha" });
  const beta = teams.createTeam({ name: "Beta" });

  teams.assignApiKeyBillingTeam(key.id, alpha.id, "2026-08-14T10:00:00.000Z");
  teams.assignApiKeyBillingTeam(key.id, beta.id, "2026-08-14T11:00:00.000Z");

  assert.equal(teams.getActiveBillingTeamForApiKey(key.id)?.id, beta.id);
  assert.deepEqual(
    teams.listApiKeyBillingHistory(key.id).map((row) => [row.teamId, row.validFrom, row.validTo]),
    [
      [alpha.id, "2026-08-14T10:00:00.000Z", "2026-08-14T11:00:00.000Z"],
      [beta.id, "2026-08-14T11:00:00.000Z", null],
    ]
  );
  assert.deepEqual(teams.listTeamMembers(alpha.id), []);
  assert.equal(teams.listTeamMembers(beta.id)[0]?.apiKeyId, key.id);
});

test("unassigning through the wrong team cannot close another team's active binding", async () => {
  const key = await apiKeys.createApiKey("agent-scope", "machine-team-scope");
  const alpha = teams.createTeam({ name: "Scope Alpha" });
  const beta = teams.createTeam({ name: "Scope Beta" });
  teams.assignApiKeyBillingTeam(key.id, beta.id, "2026-08-14T10:00:00.000Z");

  assert.equal(
    teams.unassignApiKeyBillingTeam(key.id, "2026-08-14T11:00:00.000Z", alpha.id),
    false
  );
  assert.equal(teams.getActiveBillingTeamForApiKey(key.id)?.id, beta.id);
});

test("usage snapshots the billing team and a later transfer does not rewrite history", async () => {
  const key = await apiKeys.createApiKey("agent-b", "machine-team-02");
  const alpha = teams.createTeam({ name: "Alpha usage" });
  const beta = teams.createTeam({ name: "Beta usage" });
  teams.assignApiKeyBillingTeam(key.id, alpha.id, "2026-08-14T11:00:00.000Z");

  await usageHistory.saveRequestUsage({
    provider: "openai",
    model: "gpt-test",
    apiKeyId: key.id,
    apiKeyName: key.name,
    tokens: { input: 10, output: 5 },
    timestamp: "2026-08-14T12:00:00.000Z",
  });
  teams.assignApiKeyBillingTeam(key.id, beta.id, "2026-08-14T12:30:00.000Z");
  await usageHistory.saveRequestUsage({
    provider: "openai",
    model: "gpt-test",
    apiKeyId: key.id,
    apiKeyName: key.name,
    tokens: { input: 20, output: 10 },
    timestamp: "2026-08-14T13:00:00.000Z",
  });

  const rows = core
    .getDbInstance()
    .prepare("SELECT billing_team_id FROM usage_history ORDER BY timestamp")
    .all() as Array<{ billing_team_id: string | null }>;
  assert.deepEqual(
    rows.map((row) => row.billing_team_id),
    [alpha.id, beta.id]
  );
});

test("retention rollup preserves the team dimension and all billable token classes", async () => {
  const key = await apiKeys.createApiKey("agent-c", "machine-team-03");
  const team = teams.createTeam({ name: "Rollup team" });
  teams.assignApiKeyBillingTeam(key.id, team.id, "2025-12-31T00:00:00.000Z");
  await usageHistory.saveRequestUsage({
    provider: "claude",
    model: "claude-test",
    serviceTier: "priority",
    apiKeyId: key.id,
    apiKeyName: key.name,
    tokens: { input: 100, output: 50, cacheRead: 20, cacheCreation: 10, reasoning: 5 },
    timestamp: "2026-01-01T12:00:00.000Z",
  });

  const result = await aggregateHistory.rollupUsageHistoryBeforeDate("2026-01-02");
  assert.equal(result.errors, 0);
  const row = core
    .getDbInstance()
    .prepare("SELECT * FROM daily_team_usage_summary WHERE team_id = ?")
    .get(team.id) as Record<string, unknown>;
  assert.equal(row.total_requests, 1);
  assert.equal(row.total_input_tokens, 100);
  assert.equal(row.total_output_tokens, 50);
  assert.equal(row.total_cache_read_tokens, 20);
  assert.equal(row.total_cache_creation_tokens, 10);
  assert.equal(row.total_reasoning_tokens, 5);
  assert.equal(row.service_tier, "priority");
});

test("team shared budget uses committed estimated list cost and is explicit about soft enforcement", async () => {
  await localDb.updatePricing({
    openai: {
      "gpt-team-budget": { input: 1, cached: 1, output: 1, reasoning: 1, cache_creation: 1 },
    },
  });
  const key = await apiKeys.createApiKey("agent-d", "machine-team-04");
  const team = teams.createTeam({
    name: "Budget team",
    maxBudgetUsd: 1,
    budgetDuration: "1d",
  });
  const now = new Date();
  teams.assignApiKeyBillingTeam(key.id, team.id, new Date(now.getTime() - 1_000).toISOString());
  await usageHistory.saveRequestUsage({
    provider: "openai",
    model: "gpt-team-budget",
    apiKeyId: key.id,
    apiKeyName: key.name,
    billingTeamId: team.id,
    tokens: { input: 1_000_000, output: 0 },
    timestamp: now.toISOString(),
  });

  const status = await teamBudgets.getTeamUsageLimitStatusForApiKey(key.id);
  assert.ok(status);
  assert.equal(status?.enforcementMode, "soft_committed_usage");
  assert.equal(status?.estimatedListCostUsd, 1);
  assert.equal(status?.actualProviderCostUsd, null);
  assert.equal(status?.exceeded, true);

  const rejection = await teamBudgets.buildTeamUsageLimitPolicyRejection(
    new Request("http://localhost/v1/messages", { headers: { "anthropic-version": "2023-06-01" } }),
    key.id
  );
  assert.equal(rejection?.status, 400);
  assert.match(JSON.stringify(await rejection?.json()), /team.*usage quota/i);
});

test("archiving a team closes active assignments but preserves historical usage", async () => {
  const key = await apiKeys.createApiKey("agent-e", "machine-team-05");
  const team = teams.createTeam({ name: "Archive team" });
  teams.assignApiKeyBillingTeam(key.id, team.id, "2026-08-14T14:00:00.000Z");
  await usageHistory.saveRequestUsage({
    provider: "openai",
    model: "gpt-test",
    apiKeyId: key.id,
    billingTeamId: team.id,
    tokens: { input: 1 },
    timestamp: "2026-08-14T14:30:00.000Z",
  });

  const archived = teams.archiveTeam(team.id, "2026-08-14T15:00:00.000Z");
  assert.equal(archived?.status, "archived");
  assert.equal(teams.getActiveBillingTeamForApiKey(key.id), null);
  const count = core
    .getDbInstance()
    .prepare("SELECT COUNT(*) as count FROM usage_history WHERE billing_team_id = ?")
    .get(team.id) as { count: number };
  assert.equal(count.count, 1);
});
