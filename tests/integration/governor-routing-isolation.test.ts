import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-governor-routing-"));
process.env.DATA_DIR = dataDir;

const { handleComboChat } = await import("../../open-sse/services/combo.ts");
const { GovernorManager } = await import("../../open-sse/governor/governorManager.ts");
const { getFeatureFlagOverride, removeFeatureFlagOverride, setFeatureFlagOverride } =
  await import("../../src/lib/db/featureFlags.ts");

function okResponse() {
  return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

async function selectAuthoritativeTarget(mode: "off" | "shadow") {
  const previousOverride = getFeatureFlagOverride("INTELLIGENCE_GOVERNOR_MODE");
  removeFeatureFlagOverride("INTELLIGENCE_GOVERNOR_MODE");
  process.env.INTELLIGENCE_GOVERNOR_MODE = mode;
  const selected: Array<{ provider: string; model: string; strategy: string }> = [];
  try {
    const result = await handleComboChat({
      body: { messages: [{ role: "user", content: "architecture review" }] },
      combo: {
        name: `governor-isolation-${mode}`,
        strategy: "priority",
        models: ["openai/gpt-4o-mini"],
      },
      handleSingleModel: async (_body: unknown, model: string) => {
        selected.push({ provider: "openai", model, strategy: "priority" });
        GovernorManager.evaluateShadow(
          {
            correlationId: `routing-${mode}`,
            taskKind: "architecture_reasoning",
            estimatedPromptTokens: 40,
            contextWindow: 128000,
          },
          { provider: "openai", model, routingStrategy: "priority" }
        );
        return okResponse();
      },
      isModelAvailable: async () => true,
      log: { info() {}, warn() {}, error() {}, debug() {} },
      settings: null,
      allCombos: null,
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    return selected[0];
  } finally {
    delete process.env.INTELLIGENCE_GOVERNOR_MODE;
    if (previousOverride === undefined) removeFeatureFlagOverride("INTELLIGENCE_GOVERNOR_MODE");
    else setFeatureFlagOverride("INTELLIGENCE_GOVERNOR_MODE", previousOverride);
  }
}

test("active routing target is identical with Governor off and shadow", async () => {
  const offTarget = await selectAuthoritativeTarget("off");
  const shadowTarget = await selectAuthoritativeTarget("shadow");
  assert.deepEqual(offTarget, shadowTarget);
});
