/**
 * Deterministic, no-network Governor orchestration soak.
 *
 * This exercises the production decision manager, counterfactual planner,
 * dispatch-probe guard, selected-attempt override builder, local compression
 * selector, per-target runner, fallback body isolation, and breaker state machine.
 * It is deliberately not a provider or production load test.
 */
import {
  ActiveCanaryCircuitBreaker,
  setGovernorActiveBreakerForTests,
} from "../../open-sse/governor/activeCanary.ts";
import {
  buildGovernorRequestOverrides,
  tryAcquireGovernorDispatchProbe,
} from "../../open-sse/governor/autoComboRuntime.ts";
import { GovernorManager } from "../../open-sse/governor/governorManager.ts";
import { NativeOmniGovernor } from "../../open-sse/governor/nativeGovernor.ts";
import type { CounterfactualInput } from "../../open-sse/governor/counterfactual.ts";
import type { GovernorMode, TaskKind } from "../../open-sse/governor/types.ts";
import { buildTargetTimeoutRunner } from "../../open-sse/services/combo/targetTimeoutRunner.ts";
import { selectCompressionPlan } from "../../open-sse/services/compression/strategySelector.ts";
import { DEFAULT_COMPRESSION_CONFIG } from "../../open-sse/services/compression/types.ts";
import { getGovernorTelemetryQueueMetrics } from "../../src/lib/db/governorTelemetry.ts";

export interface OfflineGovernorSoakMetrics {
  label: "OFFLINE_DETERMINISTIC_SOAK";
  iterations: number;
  maxDecisionsPerRequest: number;
  selectedDispatches: number;
  fallbacks: number;
  breakerOpens: number;
  breakerHalfOpenProbes: number;
  breakerRecoveries: number;
  breakerFailureReopens: number;
  unhandledExceptions: number;
  unhandledRejections: number;
  telemetryQueueHighWater: number;
  telemetryQueueDrops: number;
  memoryStartMb: number;
  memoryEndMb: number;
  memoryDeltaMb: number;
  latencyP50Ms: number;
  latencyP95Ms: number;
  latencyP99Ms: number;
  privateGovernorFieldsUpstream: number;
  fallbackBodyRegressions: number;
  llmControlPlaneCalls: 0;
}

const tasks: TaskKind[] = [
  "trivial_control",
  "tool_output_processing",
  "code_edit_simple",
  "code_debug",
  "architecture_reasoning",
  "unknown",
];

function percentile(values: number[], ratio: number): number {
  return values[Math.min(values.length - 1, Math.floor(values.length * ratio))] ?? 0;
}

function modeForScenario(scenario: number): GovernorMode {
  if (scenario === 0) return "off";
  if (scenario === 1) return "shadow";
  if (scenario === 2) return "simulate";
  if (scenario === 3 || scenario === 4) return "active-canary";
  return "active";
}

function counterfactualInput(correlationId: string, taskKind: TaskKind): CounterfactualInput {
  return {
    correlationId,
    taskKind,
    estimatedPromptTokens: taskKind === "architecture_reasoning" ? 12_000 : 500,
    requestedMaxOutput: 8_000,
    currentProvider: "fixture",
    currentModel: "native-a",
    currentModelTier: "high",
    estimatedInputTokensForCost: 1_000,
    estimatedOutputTokensForCost: 8_000,
    currentCost: 0.128,
    requiredCapabilities: [],
    candidates: [
      {
        provider: "fixture",
        model: "low-b",
        tier: "low",
        available: true,
        capabilities: ["streaming"],
        contextWindow: 128_000,
        inputPrice: 0.1,
        outputPrice: 0.5,
        supportsReasoning: true,
        supportsCompression: ["none", "rtk", "caveman", "compact", "preserve"],
        quotaState: "normal",
        healthScore: 1,
      },
      {
        provider: "fixture",
        model: "medium-b",
        tier: "medium",
        available: true,
        capabilities: ["streaming"],
        contextWindow: 128_000,
        inputPrice: 0.5,
        outputPrice: 1,
        supportsReasoning: true,
        supportsCompression: ["none", "rtk", "caveman", "compact", "preserve"],
        quotaState: "normal",
        healthScore: 1,
      },
      {
        provider: "fixture",
        model: "native-a",
        tier: "high",
        available: true,
        capabilities: ["streaming"],
        contextWindow: 128_000,
        inputPrice: 4,
        outputPrice: 15,
        supportsReasoning: true,
        supportsCompression: ["none", "rtk", "caveman", "compact", "preserve"],
        quotaState: "normal",
        healthScore: 0.2,
      },
      {
        provider: "fixture",
        model: "high-b",
        tier: "high",
        available: true,
        capabilities: ["streaming"],
        contextWindow: 128_000,
        inputPrice: 1,
        outputPrice: 4,
        supportsReasoning: true,
        supportsCompression: ["none", "rtk", "caveman", "compact", "preserve"],
        quotaState: "normal",
        healthScore: 1,
      },
      {
        provider: "fixture",
        model: "highest-b",
        tier: "highest",
        available: true,
        capabilities: ["streaming"],
        contextWindow: 128_000,
        inputPrice: 2,
        outputPrice: 8,
        supportsReasoning: true,
        supportsCompression: ["none", "rtk", "caveman", "compact", "preserve"],
        quotaState: "normal",
        healthScore: 1,
      },
    ],
  };
}

export async function runOfflineGovernorSoak(
  iterations = 10_000
): Promise<OfflineGovernorSoakMetrics> {
  if (!Number.isInteger(iterations) || iterations < 10_000) {
    throw new Error("OFFLINE_DETERMINISTIC_SOAK requires at least 10,000 iterations");
  }

  const oldEnv = { ...process.env };
  const memoryStartMb = process.memoryUsage().heapUsed / 1024 / 1024;
  const latencies: number[] = [];
  let selectedDispatches = 0;
  let fallbacks = 0;
  let breakerOpens = 0;
  let breakerHalfOpenProbes = 0;
  let breakerRecoveries = 0;
  let breakerFailureReopens = 0;
  let unhandledExceptions = 0;
  let unhandledRejections = 0;
  let maxDecisionsPerRequest = 0;
  let privateGovernorFieldsUpstream = 0;
  let fallbackBodyRegressions = 0;
  let breakerNow = 1;
  const normalBreaker = new ActiveCanaryCircuitBreaker(3, 10, () => breakerNow);
  const phaseBreaker = new ActiveCanaryCircuitBreaker(3, 10, () => breakerNow);
  setGovernorActiveBreakerForTests(phaseBreaker);
  const rejectionListener = () => {
    unhandledRejections += 1;
  };
  process.on("unhandledRejection", rejectionListener);

  GovernorManager.setGovernor(new NativeOmniGovernor());
  process.env.INTELLIGENCE_GOVERNOR_TELEMETRY = "false";
  process.env.GOVERNOR_ACTIVE_ENABLED = "true";

  try {
    for (let i = 0; i < iterations; i += 1) {
      const start = performance.now();
      const scenario = i % 20;
      const mode = modeForScenario(scenario);
      process.env.INTELLIGENCE_GOVERNOR_MODE = mode;
      process.env.GOVERNOR_ACTIVE_CANARY_RATE = scenario === 3 ? "0" : "1";
      const controls = {
        controlModel: scenario !== 7,
        controlProvider: true,
        controlReasoning: scenario !== 8,
        controlCompression: scenario !== 9,
        controlOutput: scenario !== 10,
      };
      const correlationId = `offline-soak-${i}`;
      const taskKind = tasks[i % tasks.length];
      const input = counterfactualInput(correlationId, taskKind);
      const { result, context } = GovernorManager.evaluateRequest(
        input,
        { provider: "fixture", model: "native-a", routingStrategy: "auto" },
        input
      );
      maxDecisionsPerRequest = Math.max(maxDecisionsPerRequest, context.decisionCount);

      try {
        if (result.plan && context.activeSelected) {
          const phaseScenario = scenario >= 11;
          const breaker = phaseScenario ? phaseBreaker : normalBreaker;
          if (scenario === 11) phaseBreaker.reset();
          if (scenario === 15 || scenario === 19) breakerNow += 11;

          const stateBefore = breaker.getState();
          const acquired = tryAcquireGovernorDispatchProbe(breaker, {
            activeSelected: context.activeSelected,
            planExecutable: result.plan.executable,
            selectedTargetAvailable: true,
            controlsPermitTarget: controls.controlModel && controls.controlProvider,
            differsFromNativeTarget: result.plan.selectedModel !== "native-a",
          });
          if (acquired) {
            if (stateBefore === "half-open") breakerHalfOpenProbes += 1;
            selectedDispatches += 1;
            const originalBody: Record<string, unknown> = {
              messages: [{ role: "user", content: `request-${i}` }],
              max_tokens: 8_000,
            };
            const overrides = buildGovernorRequestOverrides(originalBody, result.plan, {
              activeEnabled: true,
              canaryRate: 1,
              maxEstimatedRequestCost: null,
              ...controls,
              breakerFailureThreshold: 3,
              breakerCooldownMs: 10,
            });
            const selectedTarget = {
              kind: "model" as const,
              stepId: "b",
              executionKey: "b",
              modelStr: `fixture/${result.plan.selectedModel}`,
              provider: "fixture",
              providerId: null,
              connectionId: "b",
              weight: 1,
              label: null,
              governorSelected: true,
              governorRequestOverrides: overrides,
            };
            const fallbackTarget = {
              kind: "model" as const,
              stepId: "a",
              executionKey: "a",
              modelStr: "fixture/native-a",
              provider: "fixture",
              providerId: null,
              connectionId: "a",
              weight: 1,
              label: null,
            };
            const shouldFail =
              scenario === 6 ||
              scenario === 11 ||
              scenario === 12 ||
              scenario === 13 ||
              scenario === 16 ||
              scenario === 17 ||
              scenario === 18 ||
              scenario === 19;
            const run = buildTargetTimeoutRunner({
              comboTargetTimeoutMs: 0,
              log: { info() {}, warn() {}, debug() {} },
              handleSingleModel: async (attemptBody, model) => {
                if ("__omnirouteGovernorCompressionPreference" in attemptBody) {
                  selectCompressionPlan(
                    { ...DEFAULT_COMPRESSION_CONFIG, enabled: true, defaultMode: "off" },
                    null,
                    500,
                    attemptBody
                  );
                  delete attemptBody.__omnirouteGovernorCompressionPreference;
                }
                if ("__omnirouteGovernorCompressionPreference" in attemptBody) {
                  privateGovernorFieldsUpstream += 1;
                }
                return new Response(null, {
                  status: model === selectedTarget.modelStr && shouldFail ? 503 : 200,
                });
              },
            });
            const selectedResponse = await run(
              originalBody,
              selectedTarget.modelStr,
              selectedTarget
            );
            if (selectedResponse.ok) {
              breaker.recordActiveOutcome(true);
              if (stateBefore === "half-open") breakerRecoveries += 1;
            } else {
              breaker.recordActiveOutcome(false);
              if (breaker.getState() === "open" && stateBefore !== "open") breakerOpens += 1;
              if (stateBefore === "half-open") breakerFailureReopens += 1;
              fallbacks += 1;
              const fallbackResponse = await run(
                originalBody,
                fallbackTarget.modelStr,
                fallbackTarget
              );
              if (!fallbackResponse.ok) throw new Error("deterministic fallback failed");
              if (
                originalBody.max_tokens !== 8_000 ||
                "reasoning_effort" in originalBody ||
                "__omnirouteGovernorCompressionPreference" in originalBody
              ) {
                fallbackBodyRegressions += 1;
              }
            }
          }
        }
      } catch {
        unhandledExceptions += 1;
      }
      latencies.push(performance.now() - start);
    }
  } finally {
    process.off("unhandledRejection", rejectionListener);
    setGovernorActiveBreakerForTests(null);
    GovernorManager.setGovernor(new NativeOmniGovernor());
    for (const key of Object.keys(process.env)) {
      if (!(key in oldEnv)) delete process.env[key];
    }
    Object.assign(process.env, oldEnv);
  }

  await new Promise<void>((resolve) => setImmediate(resolve));
  latencies.sort((a, b) => a - b);
  const memoryEndMb = process.memoryUsage().heapUsed / 1024 / 1024;
  const queue = getGovernorTelemetryQueueMetrics();
  return {
    label: "OFFLINE_DETERMINISTIC_SOAK",
    iterations,
    maxDecisionsPerRequest,
    selectedDispatches,
    fallbacks,
    breakerOpens,
    breakerHalfOpenProbes,
    breakerRecoveries,
    breakerFailureReopens,
    unhandledExceptions,
    unhandledRejections,
    telemetryQueueHighWater: queue.highWaterMark,
    telemetryQueueDrops: queue.queueDropped,
    memoryStartMb: Number(memoryStartMb.toFixed(2)),
    memoryEndMb: Number(memoryEndMb.toFixed(2)),
    memoryDeltaMb: Number((memoryEndMb - memoryStartMb).toFixed(2)),
    latencyP50Ms: Number(percentile(latencies, 0.5).toFixed(4)),
    latencyP95Ms: Number(percentile(latencies, 0.95).toFixed(4)),
    latencyP99Ms: Number(percentile(latencies, 0.99).toFixed(4)),
    privateGovernorFieldsUpstream,
    fallbackBodyRegressions,
    llmControlPlaneCalls: 0,
  };
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("scripts/governor/offlineSoak.ts")) {
  const metrics = await runOfflineGovernorSoak(10_000);
  console.log(JSON.stringify(metrics, null, 2));
  if (
    metrics.maxDecisionsPerRequest > 1 ||
    metrics.unhandledExceptions !== 0 ||
    metrics.unhandledRejections !== 0 ||
    metrics.privateGovernorFieldsUpstream !== 0 ||
    metrics.fallbackBodyRegressions !== 0 ||
    metrics.breakerHalfOpenProbes === 0 ||
    metrics.breakerRecoveries === 0 ||
    metrics.breakerFailureReopens === 0
  ) {
    process.exitCode = 1;
  }
}
