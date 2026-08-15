/**
 * #10085 -- a custom openai-compatible provider connection persisted under the
 * GENERIC derived type id ("openai-compatible-chat") must still be reachable
 * when the chat path looks up the concrete uuid node id
 * ("openai-compatible-chat-<uuid>"), and vice versa.
 *
 * `resolveProviderNodeForConnection` (src/lib/db/providers/nodes.ts, #4421)
 * already accepts the bare generic type id when a connection is created via
 * `/api/providers`. But `getProviderSearchPool` (src/sse/services/auth.ts)
 * only bridged the search pool via a node's `prefix`, never via the generic
 * type id <-> concrete node id relationship, so a connection created under
 * the generic type id went permanently unreachable from the chat path --
 * "No active credentials for provider: openai-compatible-chat-<uuid>", the
 * exact error reported in #10085.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-10085-compat-"));
process.env.DATA_DIR = TEST_DATA_DIR;

const core = await import("../../src/lib/db/core.ts");
const nodesDb = await import("../../src/lib/db/providers/nodes.ts");
const providersDb = await import("../../src/lib/db/providers.ts");
const auth = await import("../../src/sse/services/auth.ts");

const NODE_PREFIX = "my-compat-10085";
const NODE_ID = `openai-compatible-chat-458d982b-0000-4000-8000-000000000000`;

async function resetStorage() {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
}

test.after(() => {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

async function seedNode() {
  await nodesDb.createProviderNode({
    id: NODE_ID,
    type: "openai-compatible",
    name: "My Compat",
    prefix: NODE_PREFIX,
    apiType: "chat",
    baseUrl: "https://example.test/v1",
  });
}

test("a connection stored under the GENERIC type id is reachable when chat resolves the uuid node id (#10085)", async () => {
  await resetStorage();
  await seedNode();
  await providersDb.createProviderConnection({
    provider: "openai-compatible-chat", // generic type id, NOT the uuid node id
    authType: "apikey",
    apiKey: "sk-test-10085",
    name: "test-compat",
    isActive: true,
    testStatus: "active",
    priority: 1,
    providerSpecificData: { prefix: NODE_PREFIX, baseUrl: "https://example.test/v1" },
  });

  const creds = await auth.getProviderCredentials(NODE_ID);

  assert.ok(
    creds,
    `chat looked up "${NODE_ID}" but the connection is parked under the generic ` +
      `"openai-compatible-chat" provider id -- getProviderSearchPool never bridges the ` +
      `generic type id to the concrete node id. This matches #10085 exactly.`
  );
});

test("the bridge works in the other direction too: a uuid-stored connection is reachable via the generic type id", async () => {
  await resetStorage();
  await seedNode();
  await providersDb.createProviderConnection({
    provider: NODE_ID, // concrete uuid node id
    authType: "apikey",
    apiKey: "sk-test-10085-b",
    name: "test-compat-b",
    isActive: true,
    testStatus: "active",
    priority: 1,
    providerSpecificData: { prefix: NODE_PREFIX, baseUrl: "https://example.test/v1" },
  });

  const creds = await auth.getProviderCredentials("openai-compatible-chat");

  assert.ok(
    creds,
    `a connection stored under the uuid node id "${NODE_ID}" must also be reachable via ` +
      `a lookup using the bare generic type id "openai-compatible-chat"`
  );
});

test("control: a connection stored under the uuid node id is found by a uuid node id lookup", async () => {
  await resetStorage();
  await seedNode();
  await providersDb.createProviderConnection({
    provider: NODE_ID,
    authType: "apikey",
    apiKey: "sk-test-10085-c",
    name: "test-compat-c",
    isActive: true,
    testStatus: "active",
    priority: 1,
    providerSpecificData: { prefix: NODE_PREFIX, baseUrl: "https://example.test/v1" },
  });

  assert.ok(await auth.getProviderCredentials(NODE_ID));
});

test("control: a connection stored under the uuid node id is found via prefix lookup", async () => {
  await resetStorage();
  await seedNode();
  await providersDb.createProviderConnection({
    provider: NODE_ID,
    authType: "apikey",
    apiKey: "sk-test-10085-d",
    name: "test-compat-d",
    isActive: true,
    testStatus: "active",
    priority: 1,
    providerSpecificData: { prefix: NODE_PREFIX, baseUrl: "https://example.test/v1" },
  });

  assert.ok(await auth.getProviderCredentials(NODE_PREFIX));
});

test("the bridge does not make unrelated generic types findable", async () => {
  await resetStorage();
  await seedNode();
  await providersDb.createProviderConnection({
    provider: "openai-compatible-chat",
    authType: "apikey",
    apiKey: "sk-test-10085-e",
    name: "test-compat-e",
    isActive: true,
    testStatus: "active",
    priority: 1,
    providerSpecificData: { prefix: NODE_PREFIX, baseUrl: "https://example.test/v1" },
  });

  // A different generic type (responses, not chat) must stay unrelated.
  assert.equal(await auth.getProviderCredentials("openai-compatible-responses"), null);
});
