import { after, afterEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omni-a2a-tasks-auth-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.API_KEY_SECRET = process.env.API_KEY_SECRET || "a2a-tasks-auth-test-secret";
process.env.OMNIROUTE_DISABLE_REDIS_AUTH_CACHE = "1";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const A2A_AUTH_HELPER = path.resolve(__dirname, "../../src/lib/a2a/authenticate.ts");

const core = await import("../../src/lib/db/core.ts");
const apiKeysDb = await import("../../src/lib/db/apiKeys.ts");
const settingsDb = await import("../../src/lib/db/settings.ts");
const tasksRoute = await import("../../src/app/api/a2a/tasks/route.ts");
const { authenticateA2ARequest } = await import("../../src/lib/a2a/authenticate.ts");

const ORIGINAL_REQUIRE = process.env.REQUIRE_API_KEY;
const ORIGINAL_OMNIROUTE_KEY = process.env.OMNIROUTE_API_KEY;

afterEach(() => {
  if (ORIGINAL_REQUIRE === undefined) delete process.env.REQUIRE_API_KEY;
  else process.env.REQUIRE_API_KEY = ORIGINAL_REQUIRE;
  if (ORIGINAL_OMNIROUTE_KEY === undefined) delete process.env.OMNIROUTE_API_KEY;
  else process.env.OMNIROUTE_API_KEY = ORIGINAL_OMNIROUTE_KEY;
});

after(() => {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

function request(token?: string): Request {
  return new Request("http://localhost/api/a2a/tasks", {
    method: "POST",
    headers: token ? { authorization: `Bearer ${token}` } : undefined,
  });
}

test("shared A2A helper keeps the explicit legacy key comparison constant-time", () => {
  const source = fs.readFileSync(A2A_AUTH_HELPER, "utf-8");
  assert.match(source, /import\s+\{[^}]*\btimingSafeEqual\b[^}]*\}\s+from\s+["']crypto["']/);
  assert.match(source, /timingSafeEqual\(a, b\)/);
  assert.doesNotMatch(source, /return\s+provided\s*===\s*expected/);
});

test("POST /api/a2a/tasks enforces REQUIRE_API_KEY even without OMNIROUTE_API_KEY", async () => {
  process.env.REQUIRE_API_KEY = "true";
  delete process.env.OMNIROUTE_API_KEY;

  const response = await tasksRoute.POST(request());
  assert.equal(response.status, 401);
});

test("POST /api/a2a/tasks accepts a valid database API key under REQUIRE_API_KEY", async () => {
  process.env.REQUIRE_API_KEY = "true";
  delete process.env.OMNIROUTE_API_KEY;
  await settingsDb.updateSettings({ a2aEnabled: false });
  const key = await apiKeysDb.createApiKey("a2a-post", "machine-post", []);

  const response = await tasksRoute.POST(request(key.key));
  assert.equal(response.status, 503, "auth passed; the disabled endpoint gate answered next");
});

test("POST /api/a2a/tasks preserves the keyless local-first posture", async () => {
  process.env.REQUIRE_API_KEY = "false";
  delete process.env.OMNIROUTE_API_KEY;
  await settingsDb.updateSettings({ a2aEnabled: false });

  assert.equal(await authenticateA2ARequest(request()), true);
  const response = await tasksRoute.POST(request());
  assert.equal(
    response.status,
    503,
    "keyless auth passed; the disabled endpoint gate answered next"
  );
});

test("shared A2A helper honors an explicit OMNIROUTE_API_KEY", async () => {
  process.env.REQUIRE_API_KEY = "false";
  process.env.OMNIROUTE_API_KEY = "omniroute-a2a-test-key";

  assert.equal(await authenticateA2ARequest(request("omniroute-a2a-test-key")), true);
  assert.equal(await authenticateA2ARequest(request("same-length-wrong-key")), false);
  assert.equal(await authenticateA2ARequest(request()), false);
});
