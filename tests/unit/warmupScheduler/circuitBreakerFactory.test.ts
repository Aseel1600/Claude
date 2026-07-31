/**
 * Tests for getCircuitBreakerStore() factory routing:
 *   - REDIS_URL set + reachable → RedisCircuitBreakerStore
 *   - REDIS_URL set + unreachable → SqliteCircuitBreakerStore (fallback)
 *   - REDIS_URL unset → SqliteCircuitBreakerStore
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-warmup-factory-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.NODE_ENV = "test";
process.env.DISABLE_SQLITE_AUTO_BACKUP = "true";

const core = await import("../../../src/lib/db/core.ts");

async function resetDb() {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
}

test.beforeEach(async () => {
  await resetDb();
  delete process.env.REDIS_URL;
});

test.after(() => {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

test("REDIS_URL unset → SqliteCircuitBreakerStore", async () => {
  const { getCircuitBreakerStore, __resetCircuitBreakerFactory } =
    await import("../../../src/lib/warmupScheduler/circuitBreakerFactory.ts");
  __resetCircuitBreakerFactory();
  delete process.env.REDIS_URL;
  const store = await getCircuitBreakerStore();
  assert.ok(store.constructor.name.includes("Sqlite"), `got ${store.constructor.name}`);
});

test("REDIS_URL set + unreachable → falls back to SqliteCircuitBreakerStore", async () => {
  const { getCircuitBreakerStore, __resetCircuitBreakerFactory } =
    await import("../../../src/lib/warmupScheduler/circuitBreakerFactory.ts");
  __resetCircuitBreakerFactory();
  process.env.REDIS_URL = "redis://127.0.0.1:1"; // non-listening port → connect timeout
  const store = await getCircuitBreakerStore();
  assert.ok(
    store.constructor.name.includes("Sqlite"),
    `expected Sqlite fallback, got ${store.constructor.name}`
  );
  delete process.env.REDIS_URL;
});
