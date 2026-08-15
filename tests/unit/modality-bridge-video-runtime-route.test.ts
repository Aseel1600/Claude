import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { makeManagementSessionRequest } from "../helpers/managementSession.ts";

const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-video-runtime-route-"));
const originalDataDirectory = process.env.DATA_DIR;
const originalInitialPassword = process.env.INITIAL_PASSWORD;
const originalJwtSecret = process.env.JWT_SECRET;
process.env.DATA_DIR = dataDirectory;

const core = await import("../../src/lib/db/core.ts");
const settings = await import("../../src/lib/db/settings.ts");
const route = await import("../../src/app/api/modality-bridge/video/runtime/route.ts");

test.beforeEach(async () => {
  core.resetDbInstance();
  fs.rmSync(dataDirectory, { force: true, recursive: true });
  fs.mkdirSync(dataDirectory, { recursive: true });
  process.env.INITIAL_PASSWORD = "video-runtime-test-password";
  await settings.updateSettings({ requireLogin: true, password: "" });
});

test.after(() => {
  core.resetDbInstance();
  fs.rmSync(dataDirectory, { force: true, recursive: true });
  if (originalDataDirectory === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDirectory;
  if (originalInitialPassword === undefined) delete process.env.INITIAL_PASSWORD;
  else process.env.INITIAL_PASSWORD = originalInitialPassword;
  if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalJwtSecret;
});

test("Video Bridge runtime status requires management auth and returns only sanitized fields", async () => {
  const url = "http://localhost/api/modality-bridge/video/runtime";
  const unauthenticated = await route.GET(new Request(url));
  assert.equal(unauthenticated.status, 401);

  const authenticated = await route.GET(await makeManagementSessionRequest(url));
  assert.equal(authenticated.status, 200);
  assert.equal(authenticated.headers.get("cache-control"), "no-store");
  const body = (await authenticated.json()) as Record<string, unknown>;
  assert.equal(typeof body.available, "boolean");
  assert.deepEqual(
    Object.keys(body).sort(),
    body.available
      ? ["available", "ffmpegVersion", "ffprobeVersion"]
      : ["available", "ffmpegVersion", "ffprobeVersion", "reason"]
  );
  assert.equal(JSON.stringify(body).includes("/private/"), false);
  assert.equal(JSON.stringify(body).includes("stderr"), false);
});
