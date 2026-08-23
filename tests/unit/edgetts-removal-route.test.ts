import assert from "node:assert/strict";
import fs from "node:fs";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-edgetts-removed-"));
const ORIGINAL_DATA_DIR = process.env.DATA_DIR;
process.env.DATA_DIR = TEST_DATA_DIR;

const core = await import("../../src/lib/db/core.ts");
const speechRoute = await import("../../src/app/api/v1/audio/speech/route.ts");

test.after(() => {
  if (ORIGINAL_DATA_DIR === undefined) {
    delete process.env.DATA_DIR;
  } else {
    process.env.DATA_DIR = ORIGINAL_DATA_DIR;
  }
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

test("removed EdgeTTS models are rejected before any upstream network attempt", async () => {
  const originalCreateConnection = https.Agent.prototype.createConnection;
  const originalFetch = globalThis.fetch;
  let networkAttempts = 0;

  https.Agent.prototype.createConnection = function blockedCreateConnection() {
    networkAttempts += 1;
    throw new Error("unexpected EdgeTTS network attempt");
  } as typeof https.Agent.prototype.createConnection;
  globalThis.fetch = (async () => {
    networkAttempts += 1;
    throw new Error("unexpected EdgeTTS fetch attempt");
  }) as typeof fetch;

  try {
    const response = await speechRoute.POST(
      new Request("http://localhost/v1/audio/speech", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "edgetts/en-US-AriaNeural",
          input: "This provider has been removed.",
        }),
      })
    );
    const body = (await response.json()) as { error?: { message?: string } };

    assert.equal(response.status, 400);
    assert.match(body.error?.message || "", /Invalid speech model/);
    assert.equal(networkAttempts, 0);
  } finally {
    https.Agent.prototype.createConnection = originalCreateConnection;
    globalThis.fetch = originalFetch;
  }
});
