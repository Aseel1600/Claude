import { test } from "node:test";
import assert from "node:assert/strict";

// Extract the substitution decision into a pure helper so it's unit-testable
// without a DB. The helper lives in catalog.ts and is exported for tests.
import { shouldSuppressStaticModelBySyncedCoverage } from "../../src/app/api/v1/models/catalog.ts";

test("static model covered by synced list IS suppressed (current behavior kept)", () => {
  assert.equal(
    shouldSuppressStaticModelBySyncedCoverage({
      providerHasSynced: true,
      staticModelId: "gpt-5.6-luna",
      syncedModelIds: ["gpt-5.6-luna", "moonshotai/Kimi-K3"],
    }),
    true
  );
});

test("static model NOT covered by synced list is preserved (the bug fix)", () => {
  assert.equal(
    shouldSuppressStaticModelBySyncedCoverage({
      providerHasSynced: true,
      staticModelId: "deepseek/deepseek-v4-flash",
      syncedModelIds: ["gpt-5.6-luna", "moonshotai/Kimi-K3"],
    }),
    false
  );
});

test("static model covered by synced list with prefix normalization IS suppressed", () => {
  assert.equal(
    shouldSuppressStaticModelBySyncedCoverage({
      providerHasSynced: true,
      staticModelId: "deepseek/deepseek-v4-flash",
      syncedModelIds: ["deepseek/deepseek-v4-flash", "gpt-5.6-luna"],
    }),
    true
  );
});

test("no synced models -> nothing suppressed", () => {
  assert.equal(
    shouldSuppressStaticModelBySyncedCoverage({
      providerHasSynced: false,
      staticModelId: "deepseek/deepseek-v4-flash",
      syncedModelIds: [],
    }),
    false
  );
});
