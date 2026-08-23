import test from "node:test";
import assert from "node:assert/strict";

import { getRegistryEntry } from "../../open-sse/config/providerRegistry.ts";

const { getNextFamilyFallback } = await import("../../open-sse/services/modelFamilyFallback.ts");

// Regression for #8134: family fallback candidates absent from the resolved
// provider catalog must be skipped. GitHub now legitimately supports Opus 4.6,
// so its current chain exercises that tier while GHE Copilot remains the
// negative fixture because its catalog omits 4.6.

test("#8134: github claude-opus-4.8 follows its current supported fallback chain", () => {
  const github = getRegistryEntry("github");
  assert.ok(github, "expected the github registry entry to resolve");
  const githubIds = new Set(github.models.map((m) => m.id));
  assert.ok(githubIds.has("claude-opus-4.6"), "expected github to support Opus 4.6");

  const tried = new Set(["github/claude-opus-4.8"]);
  const first = getNextFamilyFallback("github/claude-opus-4.8", tried);
  assert.equal(first, "github/claude-opus-4.7");

  tried.add(first);
  const second = getNextFamilyFallback(first, tried);
  assert.equal(second, "github/claude-opus-4.6");
});

test("#8134: getNextFamilyFallback never returns a candidate absent from the resolved provider's catalog", () => {
  const gheCopilot = getRegistryEntry("ghe-copilot");
  assert.ok(gheCopilot, "expected the ghe-copilot registry entry to resolve");
  const gheCopilotIds = new Set(gheCopilot.models.map((m) => m.id));
  assert.ok(!gheCopilotIds.has("claude-opus-4.6"), "expected GHE Copilot to omit Opus 4.6");

  let current = "ghe-copilot/claude-opus-4.8";
  const tried = new Set([current]);
  const returnedIds: string[] = [];
  for (let hop = 0; hop < 5; hop++) {
    const next = getNextFamilyFallback(current, tried);
    if (!next) break;
    const bareId = next.replace(/^ghe-copilot\//, "");
    assert.ok(
      gheCopilotIds.has(bareId),
      `hop ${hop + 1}: "${next}" is not in GHE Copilot's registered model catalog`
    );
    returnedIds.push(bareId);
    tried.add(next);
    current = next;
  }

  assert.deepEqual(returnedIds, ["claude-opus-4.7", "claude-opus-4.5"]);
  assert.ok(!returnedIds.includes("claude-opus-4.6"));
});
