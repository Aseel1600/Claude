/**
 * #9167 — built-in registry models (claude-opus-5 / claude-sonnet-5) were dropped
 * from GET /v1/models once the Claude provider synced ANY live model, because the
 * catalog builder skipped every static registry entry for a synced provider. The
 * fix (`shouldSkipStaticForSynced`) skips a static entry only when the synced set
 * actually carries that id, so registry-only models survive.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { shouldSkipStaticForSynced } from "../../src/app/api/v1/models/syncedStaticEligibility.ts";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-9167-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.API_KEY_SECRET = process.env.API_KEY_SECRET || "catalog-test-secret";

const core = await import("../../src/lib/db/core.ts");
const providersDb = await import("../../src/lib/db/providers.ts");
const modelsDb = await import("../../src/lib/db/models.ts");
const apiKeysDb = await import("../../src/lib/db/apiKeys.ts");
const v1ModelsCatalog = await import("../../src/app/api/v1/models/catalog.ts");

async function resetStorage() {
  core.resetDbInstance();
  apiKeysDb.resetApiKeyState();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
}

const CLAUDE_MODELS = [
  { id: "claude-opus-4-8" },
  { id: "claude-opus-5" },
  { id: "claude-sonnet-5" },
];

const isRegisteredEffortVariant = (
  providerModels: Array<{ id: string }>,
  modelId: string
): boolean => {
  for (const suffix of ["none", "low", "medium", "high", "max", "xhigh"]) {
    const suffixWithSeparator = `-${suffix}`;
    if (!modelId.endsWith(suffixWithSeparator)) continue;
    const baseModelId = modelId.slice(0, -suffixWithSeparator.length);
    return providerModels.some((candidate) => candidate.id === baseModelId);
  }
  return false;
};

test("#9167 registry-only model survives when synced set lacks it", () => {
  const syncedIds = new Set(["claude-opus-4-8"]);
  assert.equal(
    shouldSkipStaticForSynced(
      CLAUDE_MODELS,
      "claude-opus-5",
      true,
      syncedIds,
      isRegisteredEffortVariant
    ),
    false,
    "claude-opus-5 is not in the synced set, so the static entry must survive"
  );
});

test("#9167 synced-and-static model is still skipped (no duplicate, synced wins)", () => {
  const syncedIds = new Set(["claude-opus-4-8"]);
  assert.equal(
    shouldSkipStaticForSynced(
      CLAUDE_MODELS,
      "claude-opus-4-8",
      true,
      syncedIds,
      isRegisteredEffortVariant
    ),
    true,
    "claude-opus-4-8 is in the synced set, so the static entry is skipped to avoid a duplicate"
  );
});

test("#9167 provider that synced nothing keeps all static entries", () => {
  assert.equal(
    shouldSkipStaticForSynced(
      CLAUDE_MODELS,
      "claude-opus-4-8",
      false,
      undefined,
      isRegisteredEffortVariant
    ),
    false,
    "with no synced models the static entry must always survive"
  );
});

test("#9167 effort variant of a registry-only model is never skipped", () => {
  const syncedIds = new Set(["claude-opus-4-8"]);
  const providerModels = [...CLAUDE_MODELS, { id: "claude-opus-5-high" }];
  assert.equal(
    shouldSkipStaticForSynced(
      providerModels,
      "claude-opus-5-high",
      true,
      syncedIds,
      isRegisteredEffortVariant
    ),
    false,
    "registered effort variants are gateway-synthesized and must survive regardless of the synced set"
  );
});

test("#9167 end-to-end: GET /v1/models lists a registry-only model the sync omits", async () => {
  await resetStorage();
  const connection = await providersDb.createProviderConnection({
    provider: "claude",
    authType: "oauth",
    name: "claude-9167-account",
    isActive: true,
    testStatus: "active",
  });
  // Synced list carries opus-4-8 but NOT opus-5 (mirrors Anthropic's live list
  // lagging the OmniRoute registry). Pre-fix this dropped every static claude
  // registry model, so opus-5 vanished from /v1/models.
  await modelsDb.replaceSyncedAvailableModelsForConnection("claude", String(connection.id), [
    { id: "claude-opus-4-8", name: "Claude Opus 4.8" },
  ]);

  const response = await v1ModelsCatalog.getUnifiedModelsResponse(
    new Request("http://localhost/api/v1/models")
  );
  const body = (await response.json()) as { data: Array<{ id: string }> };
  const ids = body.data.map((m) => m.id);
  const idSet = new Set(ids);

  assert.equal(response.status, 200);
  assert.ok(
    idSet.has("claude/claude-opus-5"),
    "registry-only claude-opus-5 must appear even though the synced list omits it"
  );
  assert.ok(
    idSet.has("claude/claude-sonnet-5"),
    "registry-only claude-sonnet-5 must appear even though the synced list omits it"
  );
  assert.ok(idSet.has("claude/claude-opus-4-8"), "the synced model must still appear");
  assert.equal(
    ids.filter((id) => id === "claude/claude-opus-4-8").length,
    1,
    "the synced-and-static model must not be duplicated"
  );

  core.resetDbInstance();
  apiKeysDb.resetApiKeyState();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});
