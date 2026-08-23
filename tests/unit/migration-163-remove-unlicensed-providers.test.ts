import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const TEST_DATA_DIR = fs.mkdtempSync(
  path.join(os.tmpdir(), "omniroute-unlicensed-provider-removal-")
);
process.env.DATA_DIR = TEST_DATA_DIR;

const core = await import("../../src/lib/db/core.ts");

const REMOVED_PROVIDER_IDS = [
  "raycast",
  "rc",
  "hailuo-web",
  "felo-web",
  "felo",
  "qwen-web",
  "qw",
  "microsoft-designer-web",
  "msdesigner",
] as const;

test.after(() => {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

test("migration 163 removes current provider state but preserves historical usage", () => {
  const db = core.getDbInstance();

  const applied = db
    .prepare("SELECT version FROM _omniroute_migrations WHERE version = 163")
    .get() as { version: number } | undefined;
  assert.ok(applied, "migration 163 must be recorded as applied");

  for (const provider of REMOVED_PROVIDER_IDS) {
    const connectionId = `${provider}-connection`;

    db.prepare(
      "INSERT INTO provider_connections " +
        "(id, provider, auth_type, name, is_active, created_at, updated_at) " +
        "VALUES (?, ?, 'apikey', ?, 1, datetime('now'), datetime('now'))"
    ).run(connectionId, provider, `${provider}-legacy`);

    db.prepare(
      "INSERT INTO registered_keys " +
        "(id, key, key_prefix, name, provider, account_id) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(
      `${provider}-key-id`,
      `${provider}-key-hash`,
      provider.slice(0, 8),
      `${provider}-key`,
      provider,
      `${provider}-account`
    );
    db.prepare("INSERT INTO provider_key_limits (provider) VALUES (?)").run(provider);
    db.prepare(
      "INSERT INTO discovery_results " +
        "(provider_id, method, endpoint, auth_type) VALUES (?, 'public_api', ?, 'api_key')"
    ).run(provider, `https://${provider}.example.invalid/v1`);

    for (const namespace of ["customModels", "modelCompatOverrides", "providerAliases"]) {
      db.prepare("INSERT INTO key_value (namespace, key, value) VALUES (?, ?, '[]')").run(
        namespace,
        provider
      );
    }
    db.prepare(
      "INSERT INTO key_value (namespace, key, value) VALUES ('syncedAvailableModels', ?, '[]')"
    ).run(`${provider}:${connectionId}`);
    db.prepare("INSERT INTO key_value (namespace, key, value) VALUES ('modelAliases', ?, ?)").run(
      `${provider}-legacy-alias`,
      JSON.stringify(`${provider}/legacy-model`)
    );
    db.prepare(
      "INSERT INTO key_value (namespace, key, value) " + "VALUES ('providerLimitsCache', ?, '{}')"
    ).run(connectionId);

    db.prepare(
      "INSERT INTO provider_plans (connection_id, provider, dimensions_json) VALUES (?, ?, '[]')"
    ).run(connectionId, provider);
    db.prepare(
      "INSERT INTO session_account_affinity " +
        "(session_key, provider, connection_id, created_at, last_seen_at) " +
        "VALUES (?, ?, ?, 1, 1)"
    ).run(`${provider}-session`, provider, connectionId);
    db.prepare("INSERT INTO combo_adaptation_state (combo_id, provider_id) VALUES (?, ?)").run(
      `${provider}-combo`,
      provider
    );
    db.prepare(
      "INSERT INTO tier_assignments (provider, model, tier) VALUES (?, 'legacy-model', 'free')"
    ).run(provider);
    db.prepare(
      "INSERT INTO model_context_overrides " +
        "(provider, model_id, real_context) VALUES (?, 'legacy-model', 4096)"
    ).run(provider);
    db.prepare(
      "INSERT INTO model_capability_overrides " +
        "(provider, model_id, override_key, override_value) " +
        "VALUES (?, 'legacy-model', 'vision', 'false')"
    ).run(provider);
    db.prepare("INSERT INTO key_groups (id, name) VALUES (?, ?)").run(
      `${provider}-group`,
      `${provider}-group`
    );
    db.prepare(
      "INSERT INTO group_model_permissions " +
        "(id, group_id, model_pattern, provider) VALUES (?, ?, 'legacy-*', ?)"
    ).run(`${provider}-permission`, `${provider}-group`, provider);
    db.prepare("INSERT INTO upstream_proxy_config (provider_id) VALUES (?)").run(provider);
    db.prepare(
      "INSERT INTO radar_local_model_state (provider, model_id) VALUES (?, 'legacy-model')"
    ).run(provider);
    db.prepare(
      "INSERT INTO cloud_agent_credentials (provider_id, api_key_encrypted) VALUES (?, 'legacy')"
    ).run(provider);
    db.prepare("INSERT INTO domain_circuit_breakers (name, state) VALUES (?, 'OPEN')").run(
      provider
    );
    db.prepare(
      "INSERT INTO auto_candidate_overrides " +
        "(id, api_key_id, auto_channel, connection_id, created_at) " +
        "VALUES (?, 'legacy-key', 'auto/best', ?, datetime('now'))"
    ).run(`${provider}-candidate`, connectionId);
    db.prepare("INSERT INTO connection_runtime_state (connection_id) VALUES (?)").run(connectionId);
    db.prepare(
      "INSERT INTO provider_quota_state " +
        "(connection_id, model, window_start, window_reset) VALUES (?, 'legacy-model', 1, 2)"
    ).run(connectionId);
    db.prepare(
      "INSERT INTO reasoning_routing_rules " +
        "(id, name, scope, connection_id, source_effort, request_tags, tag_match_mode, " +
        "effort_mode, target_kind, budget_action, priority, enabled, created_at, updated_at) " +
        "VALUES (?, ?, 'connection', ?, 'any', '[]', 'any', 'inherit', 'keep', " +
        "'preserve', 0, 1, datetime('now'), datetime('now'))"
    ).run(`${provider}-rule`, `${provider}-rule`, connectionId);
    db.prepare("INSERT INTO quota_pools (id, connection_id, name) VALUES (?, ?, ?)").run(
      `${provider}-pool`,
      connectionId,
      `${provider}-pool`
    );
    db.prepare("INSERT INTO quota_pool_connections (pool_id, connection_id) VALUES (?, ?)").run(
      `${provider}-pool`,
      connectionId
    );
    db.prepare(
      "INSERT INTO quota_allocations (pool_id, api_key_id, weight) VALUES (?, 'legacy-key', 100)"
    ).run(`${provider}-pool`);
    db.prepare(
      "INSERT INTO exclusive_connection_leases " +
        "(lease_owner_hash, api_key_id, provider, connection_id, generation, state, " +
        "acquired_at, renewed_at, expires_at) " +
        "VALUES (?, 'legacy-key', ?, ?, 1, 'ACTIVE', datetime('now'), datetime('now'), " +
        "datetime('now', '+1 hour'))"
    ).run(provider.padEnd(64, "0"), provider, connectionId);

    db.prepare(
      "INSERT INTO usage_history (provider, model, timestamp) " +
        "VALUES (?, 'legacy-model', datetime('now'))"
    ).run(provider);
    db.prepare(
      "INSERT INTO call_logs (id, timestamp, provider, model, status) " +
        "VALUES (?, datetime('now'), ?, 'legacy-model', 200)"
    ).run(`${provider}-historical-call`, provider);
  }

  const mixedModels = [
    { providerId: "raycast", model: "raycast/openai-gpt-5.6-sol" },
    { provider: "hailuo-web", model: "hailuo-web/hailuo" },
    "rc/openai-gpt-5.6-terra",
    { providerId: "felo-web", model: "felo-web/felo-search" },
    "felo/felo-chat",
    { provider: "qwen-web", model: "qwen-web/qwen3-coder-plus" },
    "qw/qwen3-coder-plus",
    {
      provider: "microsoft-designer-web",
      model: "microsoft-designer-web/dall-e-3",
    },
    "msdesigner/dall-e-3",
    { providerId: "openai", model: "openai/gpt-5.6-sol" },
  ];
  db.prepare(
    "INSERT INTO combos (id, name, data, created_at, updated_at) " +
      "VALUES ('mixed-combo', 'mixed-combo', ?, datetime('now'), datetime('now'))"
  ).run(JSON.stringify({ models: mixedModels, strategy: "priority", version: 2 }));
  db.prepare(
    "INSERT INTO combos (id, name, data, created_at, updated_at) " +
      "VALUES ('removed-only', 'removed-only', ?, datetime('now'), datetime('now'))"
  ).run(
    JSON.stringify({
      models: [
        "rc/openai-gpt-5.6-sol",
        "hailuo-web/hailuo",
        "felo-web/felo-chat",
        "felo/felo-search",
        "qwen-web/qwen3-coder-plus",
        "qw/qwen3-coder-plus",
        "microsoft-designer-web/dall-e-3",
        "msdesigner/dall-e-3",
      ],
      strategy: "priority",
      version: 2,
    })
  );
  db.prepare(
    "INSERT INTO combos (id, name, data, created_at, updated_at) " +
      "VALUES ('malformed-combo', 'malformed-combo', '{not-json', datetime('now'), datetime('now'))"
  ).run();

  const sql = fs.readFileSync(
    path.join(process.cwd(), "src/lib/db/migrations/163_remove_unlicensed_providers.sql"),
    "utf8"
  );
  db.exec(sql);
  db.exec(sql);

  for (const provider of REMOVED_PROVIDER_IDS) {
    assert.equal(
      db.prepare("SELECT id FROM provider_connections WHERE provider = ?").get(provider),
      undefined
    );
    assert.equal(
      db.prepare("SELECT id FROM registered_keys WHERE provider = ?").get(provider),
      undefined
    );
    assert.equal(
      db.prepare("SELECT provider FROM provider_key_limits WHERE provider = ?").get(provider),
      undefined
    );
    assert.equal(
      db.prepare("SELECT id FROM discovery_results WHERE provider_id = ?").get(provider),
      undefined
    );
    assert.equal(db.prepare("SELECT key FROM key_value WHERE key = ?").get(provider), undefined);
    assert.equal(
      db
        .prepare(
          "SELECT key FROM key_value " + "WHERE namespace = 'syncedAvailableModels' AND key LIKE ?"
        )
        .get(`${provider}:%`),
      undefined
    );
    assert.equal(
      db
        .prepare("SELECT key FROM key_value WHERE namespace = 'modelAliases' AND value = ?")
        .get(JSON.stringify(`${provider}/legacy-model`)),
      undefined
    );
    assert.equal(
      db
        .prepare("SELECT key FROM key_value WHERE namespace = 'providerLimitsCache' AND key = ?")
        .get(`${provider}-connection`),
      undefined
    );

    const currentStateChecks: Array<[string, string, string]> = [
      ["provider_plans", "provider", provider],
      ["session_account_affinity", "provider", provider],
      ["combo_adaptation_state", "provider_id", provider],
      ["tier_assignments", "provider", provider],
      ["model_context_overrides", "provider", provider],
      ["model_capability_overrides", "provider", provider],
      ["group_model_permissions", "provider", provider],
      ["upstream_proxy_config", "provider_id", provider],
      ["radar_local_model_state", "provider", provider],
      ["cloud_agent_credentials", "provider_id", provider],
      ["domain_circuit_breakers", "name", provider],
    ];
    for (const [table, column, value] of currentStateChecks) {
      assert.equal(
        db.prepare(`SELECT 1 FROM ${table} WHERE ${column} = ?`).get(value),
        undefined,
        `${table} must not retain ${provider}`
      );
    }

    const connectionId = `${provider}-connection`;
    for (const [table, column] of [
      ["auto_candidate_overrides", "connection_id"],
      ["connection_runtime_state", "connection_id"],
      ["provider_quota_state", "connection_id"],
      ["reasoning_routing_rules", "connection_id"],
      ["quota_pool_connections", "connection_id"],
      ["quota_pools", "connection_id"],
    ] as const) {
      assert.equal(
        db.prepare(`SELECT 1 FROM ${table} WHERE ${column} = ?`).get(connectionId),
        undefined,
        `${table} must not retain ${connectionId}`
      );
    }
    assert.equal(
      (
        db
          .prepare("SELECT state FROM exclusive_connection_leases WHERE connection_id = ?")
          .get(connectionId) as { state: string }
      ).state,
      "INVALIDATED"
    );

    assert.ok(
      db.prepare("SELECT id FROM usage_history WHERE provider = ?").get(provider),
      `${provider} historical usage must be preserved`
    );
    assert.ok(
      db.prepare("SELECT id FROM call_logs WHERE provider = ?").get(provider),
      `${provider} historical call logs must be preserved`
    );
  }

  const mixed = db.prepare("SELECT data FROM combos WHERE id = 'mixed-combo'").get() as {
    data: string;
  };
  assert.deepEqual(JSON.parse(mixed.data).models, [
    { providerId: "openai", model: "openai/gpt-5.6-sol" },
  ]);

  const removedOnly = db.prepare("SELECT data FROM combos WHERE id = 'removed-only'").get() as {
    data: string;
  };
  assert.deepEqual(JSON.parse(removedOnly.data).models, []);

  const malformed = db.prepare("SELECT data FROM combos WHERE id = 'malformed-combo'").get() as {
    data: string;
  };
  assert.equal(malformed.data, "{not-json");
});
