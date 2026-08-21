import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The credential-health sweep re-probes web-session connections and recovers ones
// whose cookies expired (the "*-web providers go red on restart" bug). scheduler.ts
// only auto-inits when something imports it; nothing did at boot, so the sweep never
// ran proactively at startup. This guards that the wiring lives in the REAL startup
// (src/instrumentation-node.ts) and NOT in the unused src/server-init.ts — the exact
// mistake that made the earlier attempt (closed PR #7432) a no-op.

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const instrumentation = read("../../src/instrumentation-node.ts");

test("credential health scheduler is started from the real Next.js instrumentation startup", () => {
  assert.match(
    instrumentation,
    /import\(["']@\/lib\/credentialHealth\/scheduler["']\)/,
    "instrumentation-node.ts must import the scheduler at boot"
  );
  assert.match(
    instrumentation,
    /initCredentialHealthCheck\(\)/,
    "instrumentation-node.ts must call initCredentialHealthCheck() at boot"
  );
  assert.match(
    instrumentation,
    /\[STARTUP\] Credential health scheduler (started|disabled)/,
    "a [STARTUP] log line proves the boot wiring ran (grep-able in app.log)"
  );
});

import * as testProcess from "../../src/shared/utils/testProcess";
import { mock } from "node:test";

test("initCredentialHealthCheck returns correct boolean based on env var", async () => {
  const oldNodeEnv = process.env.NODE_ENV;
  const oldVitest = process.env.VITEST;
  const oldArgv = process.argv;
  const oldExecArgv = process.execArgv;

  process.env.NODE_ENV = "development";
  delete process.env.VITEST;
  process.argv = ["node", "script.js"];
  process.execArgv = [];

  const { initCredentialHealthCheck, stopCredentialHealthCheck } =
    await import("../../src/lib/credentialHealth/scheduler");

  // Cleanup any previous state
  stopCredentialHealthCheck();

  // Test disabled state
  process.env.OMNIROUTE_DISABLE_CREDENTIAL_HEALTH_CHECK = "1";
  assert.equal(initCredentialHealthCheck(), false, "Should return false when disabled");

  // Cleanup and test enabled state
  stopCredentialHealthCheck();
  delete process.env.OMNIROUTE_DISABLE_CREDENTIAL_HEALTH_CHECK;
  assert.equal(initCredentialHealthCheck(), true, "Should return true when enabled");

  // Cleanup
  stopCredentialHealthCheck();

  process.env.NODE_ENV = oldNodeEnv;
  if (oldVitest !== undefined) process.env.VITEST = oldVitest;
  process.argv = oldArgv;
  process.execArgv = oldExecArgv;
});

test("the wiring is NOT placed in the dead src/server-init.ts (the #7432 no-op)", () => {
  const url = new URL("../../src/server-init.ts", import.meta.url);
  const p = fileURLToPath(url);
  if (!existsSync(p)) return; // file removed upstream → nothing to guard
  assert.doesNotMatch(
    readFileSync(p, "utf8"),
    /initCredentialHealthCheck/,
    "server-init.ts is unused in production; wiring there never runs"
  );
});
