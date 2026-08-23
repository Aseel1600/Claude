/**
 * #11181 — Settings → Routing `lkgpEnabled` toggle must reach RoutingContext.
 *
 * LKGPStrategyImpl guards on `context.lkgpEnabled === false`, and the setting is
 * persisted by the Routing tab. The production construction site is
 * resolveAutoStrategyOrder(); strategy-level tests that hand-build context stay
 * green whether or not that site populates the field. These tests drive the
 * construction site with a deps.settings snapshot (the host path) + a real pin.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";

import { resolveAutoStrategyOrder } from "@omniroute/open-sse/services/combo/resolveAutoStrategy.ts";
import { resetDbInstance } from "@/lib/db/core.ts";
import { setLKGP } from "@/lib/db/settings/lkgp.ts";

after(() => {
  resetDbInstance();
});

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

function candidate(provider: string, model: string, overrides: Record<string, unknown> = {}) {
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
    costPer1MTokens: 1,
    p95LatencyMs: 100,
    latencyStdDev: 10,
    errorRate: 0,
    ...overrides,
  };
}

// cheap wins under rules; pricey only wins via LKGP pin
function candidates() {
  return [
    candidate("openai", "cheap-model", {
      costPer1MTokens: 0.01,
      p95LatencyMs: 10,
      latencyStdDev: 1,
    }),
    candidate("anthropic", "pricey-model", {
      costPer1MTokens: 50,
      p95LatencyMs: 5000,
      latencyStdDev: 900,
    }),
  ] as never;
}

function capturingLog() {
  const entries: string[] = [];
  const push = (_tag: unknown, msg: unknown) => entries.push(String(msg));
  return { entries, info: push, warn: push, error: push, debug: push };
}

async function runWithSettings(comboName: string, settings: Record<string, unknown> | null) {
  // getLKGP(combo.name, combo.id || combo.name) — pin pricey provider
  await setLKGP(comboName, comboName, "anthropic");
  const log = capturingLog();
  const result = await resolveAutoStrategyOrder({
    orderedTargets: [target("openai", "cheap-model"), target("anthropic", "pricey-model")],
    body: { messages: [{ role: "user", content: "hi" }] },
    combo: {
      id: comboName,
      name: comboName,
      autoConfig: {
        routerStrategy: "lkgp",
        candidatePool: ["openai", "anthropic"],
        explorationRate: 0,
      },
    },
    settings,
    config: {},
    relayOptions: null,
    resilienceSettings: { quotaPreflight: { enabled: false } },
    log,
    buildAutoCandidates: (async () => candidates()) as never,
  } as never);
  assert.ok("orderedTargets" in result, "expected ordering result, not earlyResponse");
  const selection = log.entries.find((entry) => entry.startsWith("Auto selection:")) ?? "";
  return { result, selection };
}

test("control — lkgpEnabled unset keeps pin (guard must not over-fire)", async () => {
  const { result, selection } = await runWithSettings("lkgp-11181-default", null);
  assert.match(selection, /LKGP: using last known good provider anthropic/);
  if ("orderedTargets" in result) {
    assert.equal(result.orderedTargets[0].provider, "anthropic");
  }
});

test("#11181 — deps.settings lkgpEnabled:false delegates to rules", async () => {
  const { result, selection } = await runWithSettings("lkgp-11181-disabled", {
    lkgpEnabled: false,
  });
  assert.doesNotMatch(
    selection,
    /LKGP: using last known good provider/,
    `lkgpEnabled:false must disable LKGP, got: ${selection}`
  );
  assert.match(selection, /RulesStrategy|strategy=rules|rules/i);
  if ("orderedTargets" in result) {
    assert.equal(
      result.orderedTargets[0].provider,
      "openai",
      "rules should pick cheap openai over pinned pricey anthropic"
    );
  }
});
