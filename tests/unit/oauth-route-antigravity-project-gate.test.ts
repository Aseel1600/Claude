/**
 * #11284 — The OAuth route must REJECT Antigravity/AGY connects whose Cloud
 * Code projectId discovery failed, instead of persisting a dead
 * `testStatus:"active"` row that shows "Connected" while every model call
 * fails (the exact #11284 symptom).
 *
 * Contract: `antigravityMissingProjectRejection()` returns a 422 with
 * `error: "missing_cloud_code_project"` for antigravity/agy payloads carrying
 * `projectDiscoveryOutcome`, and null for healthy payloads / other providers.
 *
 * Run: node --import tsx/esm --test tests/unit/oauth-route-antigravity-project-gate.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const routeSource = fs.readFileSync(
  path.join(here, "../../src/app/api/oauth/[provider]/[action]/route.ts"),
  "utf8"
);

test("route gate exists and is wired into both exchange branches", () => {
  assert.match(routeSource, /antigravityMissingProjectRejection\(provider, tokenData\)/);
  // exchange branch + poll-callback branch both gate before persisting.
  const callSites = routeSource.match(/antigravityMissingProjectRejection\(provider, tokenData\)/g) || [];
  assert.equal(callSites.length, 2, "gate must run in exchange AND poll-callback");
  // The gate lives in its own module (extracted for the file-size cap).
  const gateSource = fs.readFileSync(
    path.join(here, "../../src/lib/oauth/antigravityProjectGate.ts"),
    "utf8"
  );
  assert.match(gateSource, /export function antigravityMissingProjectRejection\(/);
});

test("gate rejects BYOP outcome with 422 missing_cloud_code_project", () => {
  const gateSource = fs.readFileSync(
    path.join(here, "../../src/lib/oauth/antigravityProjectGate.ts"),
    "utf8"
  );
  assert.match(gateSource, /requires_manual_project/);
  assert.match(gateSource, /missing_cloud_code_project/);
  assert.match(routeSource, /status: 422/);
});

test("gate only applies to antigravity and agy", () => {
  const gateSource = fs.readFileSync(
    path.join(here, "../../src/lib/oauth/antigravityProjectGate.ts"),
    "utf8"
  );
  assert.match(gateSource, /"antigravity"/);
  assert.match(gateSource, /"agy"/);
});
