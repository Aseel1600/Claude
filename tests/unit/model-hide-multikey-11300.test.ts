/**
 * #11300 — Models toggled "Hidden" on Provider pages are still listed in GET /v1/models.
 *
 * Root cause: PATCH /api/provider-models persists {isHidden} under whatever key the
 * dashboard route carried (node UUID, alias like cc/gh/xao, or canonical claude/github),
 * while every catalog lookup queries ONE key (canonical, raw connection id, or a
 * hardcoded "codex"). Any key mismatch leaks the hidden model back into /v1/models.
 *
 * This suite pins the multi-key contract:
 *   - hide saved under an ALIAS is honored when querying CANONICAL (and vice versa)
 *   - hide saved under a NODE-PREFIX/UUID-style key is honored from any equivalent key
 *   - the bulk map helper used by buildUnifiedModelsResponseCore resolves all of them
 */
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

// Hermetic DB (see synced-model-hide-persist-3782.test.ts): isolate DATA_DIR before
// any import opens the SQLite handle, release the handle afterwards.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-test-hide-multikey-"));
process.env.DATA_DIR = tmpDir;

const {
  setModelIsHidden,
  getModelIsHidden,
} = await import("../../src/lib/localDb.ts");
const { resetDbInstance } = await import("../../src/lib/db/core.ts");
const { isModelHiddenInBulkMap, providerKeysToCheck } = await import(
  "../../src/lib/db/models.ts"
);

before(() => {
  resetDbInstance();
});

after(() => {
  resetDbInstance();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("hide saved under ALIAS key is honored when querying CANONICAL (issue case 2)", () => {
  // Dashboard page /dashboard/providers/cc toggles gpt-4o hidden → stored under "cc".
  setModelIsHidden("cc", "gpt-4o", true);

  assert.equal(getModelIsHidden("cc", "gpt-4o"), true, "exact alias key must match");
  assert.equal(
    getModelIsHidden("claude", "gpt-4o"),
    true,
    "canonical lookup must find alias-stored hide (#11300)"
  );
});

test("hide saved under CANONICAL key is honored when queried via ALIAS", () => {
  setModelIsHidden("github", "gpt-4o-mini", true);

  assert.equal(getModelIsHidden("gh", "gpt-4o-mini"), true);
  assert.equal(getModelIsHidden("github", "gpt-4o-mini"), true);
});

test("hide saved under xAI alias xao is honored when querying xai (issue case 2)", () => {
  setModelIsHidden("xao", "grok-4", true);

  assert.equal(getModelIsHidden("xai", "grok-4"), true);
});

test("bulk map helper resolves alias/canonical/prefix variants (catalog seam)", () => {
  // Simulates what getHiddenModelsByProvider() returns when the operator hid models
  // from three different dashboard surfaces.
  const map = new Map<string, Set<string>>([
    ["cc", new Set(["gpt-4o"])], // hidden from alias page
    ["github", new Set(["gpt-4o-mini"])], // hidden from canonical page
    ["openai-compatible-chat-ea7d9940", new Set(["deepseek-v4-flash-0731"])], // node UUID page
  ]);

  // Static loop queries canonicalProviderId…
  assert.equal(isModelHiddenInBulkMap(map, "claude", "gpt-4o"), true);
  // Synced loop queries raw connection id (node UUID)…
  assert.equal(isModelHiddenInBulkMap(map, "openai-compatible-chat-ea7d9940", "deepseek-v4-flash-0731"), true);
  // Alias loop queries the alias…
  assert.equal(isModelHiddenInBulkMap(map, "gh", "gpt-4o-mini"), true);
  // …and unrelated providers stay untouched.
  assert.equal(isModelHiddenInBulkMap(map, "anthropic", "gpt-4o"), false);
  assert.equal(isModelHiddenInBulkMap(map, "claude", "gpt-4o-mini"), false);
});

test("codex-native unprefixed check finds hides stored under cx alias (issue case 4)", () => {
  setModelIsHidden("cx", "gpt-5-codex", true);

  // The codex-native loop calls isModelHiddenBulk("codex", …); multi-key resolution
  // must reach the alias-stored entry.
  assert.equal(getModelIsHidden("codex", "gpt-5-codex"), true);
});

test("providerKeysToCheck dedupes and keeps unknown ids intact", () => {
  assert.deepEqual(providerKeysToCheck("unknown-provider"), ["unknown-provider"]);
  const keys = providerKeysToCheck("cc");
  assert.ok(keys.includes("cc"), "original key preserved");
  assert.ok(keys.includes("claude"), "canonical included");
});

test("hidden flag stays scoped to the hidden model only", () => {
  setModelIsHidden("mistral", "mistral-large", true);

  assert.equal(getModelIsHidden("mistral", "mistral-small"), false);
  assert.equal(getModelIsHidden("mistral", "mistral-large"), true);
});
