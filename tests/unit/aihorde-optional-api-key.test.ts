import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-aihorde-key-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.API_KEY_SECRET = process.env.API_KEY_SECRET || "aihorde-optional-key-test-secret";

const core = await import("../../src/lib/db/core.ts");
const providersDb = await import("../../src/lib/db/providers.ts");
const { getProviderCredentials } = await import("../../src/sse/services/auth.ts");
const { supportsApiKeyOnFreeProvider, providerAllowsOptionalApiKey } =
  await import("../../src/shared/constants/providers.ts");
const { getCredentialRequirement } =
  await import("../../src/shared/utils/providerCredentialRequirement.ts");
const { DefaultExecutor } = await import("../../open-sse/executors/default.ts");
const { isManagedProviderConnectionId } = await import("../../src/lib/providers/catalog.ts");

test.after(() => {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

test("aihorde treats a registered key as optional, not required", () => {
  assert.equal(providerAllowsOptionalApiKey("aihorde"), true);
  assert.equal(supportsApiKeyOnFreeProvider("aihorde"), true);
  assert.equal(getCredentialRequirement("aihorde"), "optional");
  assert.equal(isManagedProviderConnectionId("aihorde"), true);
});

test("aihorde without a stored key still uses the synthetic no-auth path", async () => {
  const creds = await getProviderCredentials("aihorde");
  assert.ok(creds);
  assert.equal((creds as { connectionId?: string }).connectionId, "noauth");
  assert.equal((creds as { apiKey?: unknown }).apiKey, null);
});

test("aihorde prefers a stored API key over the anonymous fallback", async () => {
  const created = await providersDb.createProviderConnection({
    provider: "aihorde",
    authType: "apikey",
    name: "Horde kudos key",
    apiKey: "horde-registered-key-123",
  });
  assert.ok(created?.id);

  const creds = await getProviderCredentials("aihorde");
  assert.ok(creds);
  assert.equal((creds as { apiKey?: string }).apiKey, "horde-registered-key-123");
  assert.equal((creds as { connectionId?: string }).connectionId, created.id);
});

test("DefaultExecutor uses a stored Horde key for chat, else the anonymous key", () => {
  const executor = new DefaultExecutor("aihorde");
  const withKey = executor.buildHeaders(
    { apiKey: "horde-registered-key-123", accessToken: null } as never,
    true
  ) as Record<string, string>;
  assert.equal(withKey.Authorization, "Bearer horde-registered-key-123");

  const anonymous = executor.buildHeaders(
    { apiKey: null, accessToken: null } as never,
    true
  ) as Record<string, string>;
  assert.equal(anonymous.Authorization, "Bearer 0000000000");
});
