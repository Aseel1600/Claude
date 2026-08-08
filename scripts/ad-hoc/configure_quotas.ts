import { getDbInstance } from "../../src/lib/db/core.js";
import { randomUUID, createHash } from "crypto";

async function run() {
  const db = getDbInstance();
  const now = new Date().toISOString();

  console.log("Setting up dependencies...");

  // 1. Get a provider connection
  const conn = db.prepare("SELECT id FROM provider_connections LIMIT 1").get();
  if (!conn) {
    console.error("No provider connection found.");
    return;
  }

  // 2. Create a generic API key
  const apiKeyId = "key-" + randomUUID();
  const keyHash = createHash("sha256").update("dummy_key").digest("hex");

  try {
    db.prepare(
      `
      INSERT INTO api_keys (id, name, key, key_hash, is_active, max_sessions, scopes, created_at, updated_at, access_schedule)
      VALUES (?, ?, ?, ?, 1, 10, '[]', ?, ?, '{}')
    `
    ).run(apiKeyId, "Quota Testing Key", "dummy_key", keyHash, now, now);
  } catch (e) {
    console.error("Could not insert api_key:", e.message);
  }

  console.log("Configuring Quota Pools...");
  try {
    const poolId = randomUUID();
    db.prepare(
      `
      INSERT INTO quota_pools (id, connection_id, name, created_at)
      VALUES (?, ?, ?, ?)
    `
    ).run(poolId, conn.id, "Shared Developer Pool", now);

    // Add to quota_groups
    db.prepare(
      `
      INSERT INTO quota_groups (id, name, created_at)
      VALUES (?, ?, ?)
    `
    ).run("group-" + poolId, "Developer Group", now);
  } catch (e) {
    console.error("Error setting quota_pools:", e.message);
  }

  console.log("Configuring Domain Budgets...");
  try {
    db.prepare(
      `
      INSERT INTO domain_budgets (api_key_id, daily_limit_usd, weekly_limit_usd, monthly_limit_usd, warning_threshold)
      VALUES (?, ?, ?, ?, ?)
    `
    ).run(apiKeyId, 50.0, 200.0, 1000.0, 0.8);
  } catch (e) {
    console.error("Error setting domain_budgets:", e.message);
  }

  console.log("Configuring Fallback Chains...");
  try {
    db.prepare(
      `
      INSERT INTO domain_fallback_chains (model, chain)
      VALUES (?, ?)
    `
    ).run("gpt-4-turbo", JSON.stringify(["claude-3-opus", "gemini-1.5-pro"]));

    db.prepare(
      `
      INSERT INTO domain_fallback_chains (model, chain)
      VALUES (?, ?)
    `
    ).run("claude-3-5-sonnet", JSON.stringify(["gpt-4o", "gemini-1.5-pro"]));
  } catch (e) {
    console.error("Error setting domain_fallback_chains:", e.message);
  }

  console.log("Configuring Sync Tokens...");
  try {
    const syncTokenValue = `sync_${randomUUID().replace(/-/g, "")}`;
    const tokenHash = createHash("sha256").update(syncTokenValue).digest("hex");

    db.prepare(
      `
      INSERT INTO sync_tokens (id, name, token_hash, sync_api_key_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `
    ).run(randomUUID(), "Dashboard Sync Token", tokenHash, apiKeyId, now, now);
  } catch (e) {
    console.error("Error setting sync_tokens:", e.message);
  }

  console.log("Configuration complete!");
}

run().catch(console.error);
