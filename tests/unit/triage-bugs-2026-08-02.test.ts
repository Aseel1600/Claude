import { test } from "node:test";
import assert from "node:assert/strict";
import { detectSupportedThinkingEfforts } from "@/lib/providerModels/modelDiscovery";

// #9160: model discovery must ingest capabilities.effort_tiers
test("#9160 model discovery must ingest capabilities.effort_tiers", () => {
  assert.deepEqual(
    detectSupportedThinkingEfforts({
      capabilities: { effort_tiers: ["low", "medium", "high", "xhigh"] },
    }),
    ["low", "medium", "high", "xhigh"]
  );
});

test("#9160 capabilities.effort_tiers with duplicate and synonym", () => {
  assert.deepEqual(
    detectSupportedThinkingEfforts({
      capabilities: { effort_tiers: ["low", "low", "max"] },
    }),
    ["low", "xhigh"]
  );
});
