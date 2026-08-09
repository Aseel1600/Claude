/**
 * A provider node with a configured `prefix` must publish each model ONCE.
 *
 * Sibling of #8327. That fix stopped the raw provider-node UUID from leaking into
 * `owned_by`; the same UUID still leaks into `id`, as a second, redundant entry
 * for every model:
 *
 *   [VB]-/mimo-v2.5                                            <- the configured prefix
 *   openai-compatible-chat-6775f68a-.../mimo-v2.5              <- same model, raw node id
 *
 * Both route identically, so the second is pure catalog noise. Measured in
 * production 2026-08-09, three prefixed nodes turned 36 real models into 60
 * entries — and the extension's picker showed every model twice.
 *
 * `MODELS_CATALOG_PREFIX_MODE=alias` is documented to publish "only the short alias
 * prefix", but does not remove these: for the loop that emits them the raw node id
 * IS the alias, so `includeAlias` keeps it. Measured: 214 entries in `dual`, 211 in
 * `alias`, with all duplicates surviving both.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-prefix-dup-"));
process.env.DATA_DIR = TEST_DATA_DIR;

const core = await import("../../src/lib/db/core.ts");
const providersDb = await import("../../src/lib/db/providers.ts");
const modelsDb = await import("../../src/lib/db/models.ts");
const v1ModelsCatalog = await import("../../src/app/api/v1/models/catalog.ts");
const { syncManagedAvailableModelAliases } = await import(
  "../../src/lib/providerModels/managedAvailableModels.ts"
);

const NODE_ID = "openai-compatible-chat-550e8400-e29b-41d4-a716-446655440000";
const PREFIX = "[VB]-";
const MODEL_ID = "mimo-v2.5";

async function resetStorage() {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
  v1ModelsCatalog.__resetCatalogBuilderRunsForTest();
}

async function seedPrefixedNodeWithModel() {
  await providersDb.createProviderNode({
    id: NODE_ID,
    type: "openai-compatible",
    name: "verboo (probe)",
    prefix: PREFIX,
    baseUrl: "https://proxy.example.com",
    chatPath: "/v1/chat/completions",
    modelsPath: "/v1/models",
  });
  const connection = await providersDb.createProviderConnection({
    provider: NODE_ID,
    authType: "apikey",
    name: "vb-conn",
    apiKey: "sk-test",
    isActive: true,
    testStatus: "active",
    providerSpecificData: {
      baseUrl: "https://proxy.example.com",
      chatPath: "/v1/chat/completions",
      modelsPath: "/v1/models",
    },
  });
  await modelsDb.replaceSyncedAvailableModelsForConnection(
    NODE_ID,
    (connection as { id: string }).id,
    [{ id: MODEL_ID, name: "MiMo 2.5", source: "imported", supportedEndpoints: ["chat"] }]
  );
  // Production nodes also carry managed aliases, written by the provider-models
  // routes on every visibility change. Without them the duplicate does not appear,
  // so the repro needs them.
  await syncManagedAvailableModelAliases(NODE_ID, [MODEL_ID], { pruneMissing: false });
}

async function catalogIds(url = "http://localhost/api/v1/models"): Promise<string[]> {
  const response = await v1ModelsCatalog.getUnifiedModelsResponse(new Request(url));
  assert.equal(response.status, 200);
  const body = (await response.json()) as { data: Array<{ id: string }> };
  return body.data.map((m) => m.id);
}

test.beforeEach(async () => {
  await resetStorage();
});

test.after(async () => {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

test("a prefixed node publishes each model once, under the prefix", async () => {
  await seedPrefixedNodeWithModel();
  const ids = await catalogIds();

  assert.ok(
    ids.includes(`${PREFIX}/${MODEL_ID}`),
    `expected the prefixed id, got ${JSON.stringify(ids)}`
  );
  assert.equal(
    ids.includes(`${NODE_ID}/${MODEL_ID}`),
    false,
    `the raw node id must not be published alongside the prefix — got ${JSON.stringify(ids)}`
  );
});

test("no catalog entry carries the raw provider-node id in its published id", async () => {
  await seedPrefixedNodeWithModel();
  const leaked = (await catalogIds()).filter((id) => id.startsWith(`${NODE_ID}/`));
  assert.deepEqual(leaked, [], "raw provider-node ids must never appear in a published model id");
});

test("prefix=alias does not resurrect the duplicate", async () => {
  await seedPrefixedNodeWithModel();
  const ids = await catalogIds("http://localhost/api/v1/models?prefix=alias");
  assert.equal(ids.includes(`${NODE_ID}/${MODEL_ID}`), false);
  assert.ok(ids.includes(`${PREFIX}/${MODEL_ID}`));
});

test("a node WITHOUT a prefix still publishes under its own id", async () => {
  const bareNode = "openai-compatible-chat-11111111-2222-3333-4444-555555555555";
  await providersDb.createProviderNode({
    id: bareNode,
    type: "openai-compatible",
    name: "sem prefixo",
    baseUrl: "https://bare.example.com",
    chatPath: "/v1/chat/completions",
    modelsPath: "/v1/models",
  });
  const connection = await providersDb.createProviderConnection({
    provider: bareNode,
    authType: "apikey",
    name: "bare-conn",
    apiKey: "sk-test",
    isActive: true,
    testStatus: "active",
    providerSpecificData: { baseUrl: "https://bare.example.com" },
  });
  await modelsDb.replaceSyncedAvailableModelsForConnection(
    bareNode,
    (connection as { id: string }).id,
    [{ id: "solo-1", name: "Solo", source: "imported", supportedEndpoints: ["chat"] }]
  );

  const ids = await catalogIds();
  assert.ok(
    ids.includes(`${bareNode}/solo-1`),
    `without a prefix the node id is the only name a client has — got ${JSON.stringify(ids)}`
  );
});
