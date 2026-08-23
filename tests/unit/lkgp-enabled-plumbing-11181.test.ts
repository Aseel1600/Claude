import { test, after } from "node:test";
import assert from "node:assert/strict";

import { resolveAutoStrategyOrder } from "@omniroute/open-sse/services/combo/resolveAutoStrategy.ts";
import { resetDbInstance } from "@/lib/db/core.ts";
import { updateSettings } from "@/lib/db/settings.ts";
import { setLKGP } from "@/lib/db/settings/lkgp.ts";

// #11181: Settings toggle lkgpEnabled never reached RoutingContext.
// When lkgpEnabled=false, LKGPStrategy must delegate to rules even if a pin exists.

after(() => {
  resetDbInstance();
});

const noopLog = {
  info() {},
  warn() {},
  error() {},
  debug() {},
} as never;

const target = (provider: string, modelStr: string): never =>
  ({
    kind: "model",
    stepId: "s1",
    executionKey: `${provider}>${modelStr}`,
    modelStr,
    provider,
    providerId: null,
    connectionId: null,
    weight: 1,
    label: null,
  }) as never;

function makeCandidate(provider: string, model: string, cost = 1) {
  return {
    kind: "model",
    stepId: "s1",
    executionKey: `${provider}>${model}`,
    modelStr: model,
    provider,
    model,
    connectionId: null,
    quotaRemaining: 100,
    quotaTotal: 100,
    circuitBreakerState: "CLOSED",
    costPer1MTokens: cost,
    p95LatencyMs: 100,
    latencyStdDev: 10,
    errorRate: 0,
  };
}

function deps(buildAutoCandidates: never, comboOverrides: Record<string, unknown> = {}) {
  return {
    orderedTargets: [
      target("expensive", "model-e"),
      target("cheap", "model-c"),
    ],
    body: { messages: [{ role: "user", content: "hi" }] },
    combo: {
      id: "auto-c1",
      name: "auto",
      config: {
        // force lkgp strategy so the toggle path is exercised
        routerStrategy: "lkgp",
        ...comboOverrides,
      },
    },
    settings: null,
    config: {},
    relayOptions: null,
    resilienceSettings: { quotaPreflight: { enabled: false } },
    log: noopLog,
    buildAutoCandidates,
  } as never;
}

test("#11181 lkgpEnabled:false — pin ignored, rules strategy used", async () => {
  // Seed a pin pointing at the expensive provider
  await setLKGP("auto", "auto-c1", "expensive", "model-e");
  // Disable LKGP via settings (the UI toggle path)
  await updateSettings({ lkgpEnabled: false });

  // Cheap candidate costs less → rules should pick it over the pinned expensive one
  const build = (async () => [
    makeCandidate("expensive", "model-e", 50),
    makeCandidate("cheap", "model-c", 1),
  ]) as never;

  const result = await resolveAutoStrategyOrder(deps(build));
  assert.ok(!("earlyResponse" in result));
  if ("orderedTargets" in result) {
    // With lkgpEnabled=false the pin must NOT force expensive first
    assert.equal(
      result.orderedTargets[0].provider,
      "cheap",
      "lkgpEnabled:false must ignore the expensive pin and let rules pick cheap"
    );
  }
});

test("#11181 lkgpEnabled:true (default) — pin honored", async () => {
  await setLKGP("auto", "auto-c1", "expensive", "model-e");
  await updateSettings({ lkgpEnabled: true });

  const build = (async () => [
    makeCandidate("expensive", "model-e", 50),
    makeCandidate("cheap", "model-c", 1),
  ]) as never;

  const result = await resolveAutoStrategyOrder(deps(build));
  assert.ok(!("earlyResponse" in result));
  if ("orderedTargets" in result) {
    assert.equal(
      result.orderedTargets[0].provider,
      "expensive",
      "lkgpEnabled:true must honor the pin"
    );
  }
});
