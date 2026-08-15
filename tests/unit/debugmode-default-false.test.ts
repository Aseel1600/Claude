import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-debugmode-default-"));
process.env.DATA_DIR = TEST_DATA_DIR;

const core = await import("../../src/lib/db/core.ts");
const settings = await import("../../src/lib/db/settings.ts");

test.after(() => {
  try {
    core.closeDbInstance();
  } catch {}
  core.resetDbInstance();
});

test("getSettings defaults debugMode to false", async () => {
  core.resetDbInstance();
  core.getDbInstance();
  const result = await settings.getSettings();
  assert.strictEqual(result.debugMode, false);
});

test("getSettings debugMode default persists across reads", async () => {
  core.resetDbInstance();
  core.getDbInstance();
  const first = await settings.getSettings();
  const second = await settings.getSettings();
  assert.strictEqual(first.debugMode, false);
  assert.strictEqual(second.debugMode, false);
});
