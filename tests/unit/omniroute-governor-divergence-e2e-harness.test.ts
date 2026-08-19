import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const harnessPath = new URL(
  "../../scripts/ad-hoc/omniroute-governor-divergence-e2e-20260819.mjs",
  import.meta.url
);
const harnessSource = fs.readFileSync(harnessPath, "utf8");

test("divergence harness keeps a fixed 12-category workload and no adaptive case generation", () => {
  const categories = [...harnessSource.matchAll(/category: "([A-Z_]+)"/g)].map((match) => match[1]);
  assert.equal(categories.length, 12);
  assert.deepEqual(new Set(categories).size, 12);
  assert.deepEqual(categories, [
    "SIMPLE_FAST",
    "STRUCTURED_JSON",
    "CODE_GENERATION",
    "CODE_REASONING",
    "LONG_CONTEXT",
    "PORTUGUESE",
    "ENGLISH",
    "EXTRACTION",
    "CLASSIFICATION",
    "REASONING",
    "FORMAT_STRICT",
    "LOW_COST_CANDIDATE_SCENARIO",
  ]);
  assert.match(harnessSource, /applyGovernorToAutoComboOrder/);
  assert.doesNotMatch(harnessSource, /GOVERNOR_ACTIVE_CANARY_RATE\s*=\s*1/);
});

test("E2E harness measures Governor planning before direct execution and records stale skips", () => {
  assert.match(harnessSource, /const started = performance\.now\(\);/);
  assert.match(harnessSource, /const planningStarted = performance\.now\(\);/);
  assert.match(
    harnessSource,
    /const planningMs = Math\.round\(performance\.now\(\) - planningStarted\);/
  );
  assert.match(harnessSource, /governor_target_stale/);
  assert.match(harnessSource, /governor-e2e-direct/);
  assert.match(harnessSource, /governor_then_native/);
  assert.match(harnessSource, /native_then_governor/);
  assert.match(harnessSource, /pair\.native\.request\?\.qualityPass === true/);
  assert.match(harnessSource, /pair\.governor\.direct\?\.qualityPass === true/);
  assert.match(harnessSource, /stopReason: "e2e_calibration_failed"/);
  assert.match(harnessSource, /const latencyWinner =/);
  assert.match(harnessSource, /winnerReason/);
  assert.match(harnessSource, /item\.pairwise\?\.winner === "governor"/);
});
