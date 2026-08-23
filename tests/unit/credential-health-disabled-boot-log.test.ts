import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

// #11016 follow-up (suggested by maintainer on PR #11029): assert that the
// disabled boot path produces the correct "[STARTUP] Credential health scheduler
// disabled" log at runtime — not just that the string exists in source
// (credential-health-boot-wiring.test.ts covers static presence).
//
// This spawns a subprocess with the disable env var set, imports the scheduler,
// applies the same conditional from src/instrumentation-node.ts, and asserts the
// actual console output.

const thisDir = dirname(fileURLToPath(import.meta.url));
let projectRoot = resolve(thisDir, "../..");

if (!existsSync(resolve(projectRoot, "node_modules"))) {
  const candidate = resolve(projectRoot, "../../..");
  if (existsSync(resolve(candidate, "node_modules", "tsx"))) {
    projectRoot = candidate;
  }
}

const RUNNER_SCRIPT = `
  process.env.OMNIROUTE_DISABLE_CREDENTIAL_HEALTH_CHECK = "true";
  const { initCredentialHealthCheck } = await import(
    "./src/lib/credentialHealth/scheduler.ts"
  );
  const started = initCredentialHealthCheck();
  // Reproduce the exact conditional from src/instrumentation-node.ts:474-477
  console.log(
    started
      ? "[STARTUP] Credential health scheduler started"
      : "[STARTUP] Credential health scheduler disabled"
  );
  process.exit(0);
`;

test("disabled boot path emits [STARTUP] Credential health scheduler disabled", () => {
  const stdout = execFileSync(
    process.execPath,
    ["--import", "tsx/esm", "--input-type=module", "--eval", RUNNER_SCRIPT],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        OMNIROUTE_DISABLE_CREDENTIAL_HEALTH_CHECK: "true",
        NODE_NO_WARNINGS: "1",
      },
      encoding: "utf8",
      timeout: 30_000,
    }
  );

  assert.match(
    stdout,
    /\[STARTUP\] Credential health scheduler disabled/,
    "must log the disabled message when OMNIROUTE_DISABLE_CREDENTIAL_HEALTH_CHECK is set"
  );
  assert.doesNotMatch(
    stdout,
    /\[STARTUP\] Credential health scheduler started/,
    "must NOT log the started message when disabled"
  );
});
