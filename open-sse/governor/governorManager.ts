/**
 * open-sse/governor/governorManager.ts
 *
 * Intelligence Governor Manager & Shadow Mode Evaluator.
 *
 * GUARANTEES:
 * - When mode is 'off': Zero overhead, no evaluations performed.
 * - When mode is 'shadow': Recommendations are generated and recorded for telemetry ONLY.
 * - Shadow recommendations do not alter authoritative routing selection; shadow mode may add local overhead.
 * - Non-blocking telemetry persistence: failure to log telemetry never throws into request flow.
 */

import { getGovernorMode, isGovernorTelemetryEnabled } from "@/shared/utils/featureFlags.ts";
import { enqueueGovernorTelemetryRow } from "@/lib/db/governorTelemetry.ts";
import { NativeOmniGovernor } from "./nativeGovernor.ts";
import { resolveCounterfactualPlan, type CounterfactualExecutionPlan, type CounterfactualInput } from "./counterfactual.ts";
import type {
  GovernorDecision,
  GovernorInput,
  GovernorTelemetry,
  IntelligenceGovernor,
  ActualRequestContext,
} from "./types.ts";

export interface EvaluationResult {
  recommendation: GovernorDecision | null;
  mode: "off" | "shadow" | "simulate";
  decisionLatencyMs: number;
  plan?: CounterfactualExecutionPlan;
}

export interface SimulationResult extends EvaluationResult { plan: CounterfactualExecutionPlan | null; }

export class GovernorManager {
  private static governor: IntelligenceGovernor = new NativeOmniGovernor();

  public static getGovernor(): IntelligenceGovernor {
    return this.governor;
  }

  public static setGovernor(governor: IntelligenceGovernor): void {
    this.governor = governor;
  }

  public static evaluateShadow(
    input: GovernorInput,
    actualContext: ActualRequestContext,
    counterfactualInput?: CounterfactualInput
  ): EvaluationResult {
    const mode = getGovernorMode();

    if (mode === "off") {
      return {
        recommendation: null,
        mode: "off",
        decisionLatencyMs: 0,
      };
    }

    const startTime = performance.now();
    let recommendation: GovernorDecision;

    try {
      recommendation = this.governor.decide(input);
    } catch (error) {
      console.warn("[GovernorManager] Governor decision error:", error);
      return {
        recommendation: null,
        mode: "shadow",
        decisionLatencyMs: Number((performance.now() - startTime).toFixed(3)),
      };
    }

    const decisionLatencyMs = Number((performance.now() - startTime).toFixed(3));
    const counterfactualPlan = mode === "simulate" && counterfactualInput
      ? resolveCounterfactualPlan(counterfactualInput, recommendation)
      : undefined;

    if (isGovernorTelemetryEnabled()) {
      const telemetryRecord: GovernorTelemetry = {
        correlationId: input.correlationId || `gov-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        timestamp: Date.now(),
        governorMode: mode,
        actualProvider: actualContext.provider || "unknown",
        actualModel: actualContext.model || "unknown",
        actualRoutingStrategy: actualContext.routingStrategy,
        actualReasoningConfig: actualContext.reasoningConfig,
        actualCompressionConfig: actualContext.compressionConfig,
        actualPromptTokens: actualContext.promptTokens ?? null,
        actualOutputTokens: actualContext.outputTokens ?? null,
        actualTotalTokens: actualContext.totalTokens ?? null,
        estimatedCost: actualContext.estimatedCost,
        latencyMs: actualContext.latencyMs ?? null,
        retryCount: actualContext.retryCount ?? null,
        success: actualContext.success ?? null,
        errorCategory: actualContext.errorCategory,
        recommendation,
        decisionLatencyMs,
        governorName: this.governor.name,
        governorVersion: this.governor.version,
        policyVersion: "v0",
        observedFeatures: {
          estimatedPromptTokens: input.estimatedPromptTokens ?? null,
          contextUtilization: input.contextUtilization ?? null,
          toolCount: input.toolCount ?? null,
          messageCount: input.messageCount ?? null,
          requestedMaxOutput: input.requestedMaxOutput ?? null,
          retryCount: input.retryCount ?? null,
          cacheState: input.cacheState ?? null,
        },
        counterfactualPlan,
      };

      // Non-blocking telemetry persistence
      enqueueGovernorTelemetryRow(telemetryRecord);
    }

    // ACTIVE DECISION UNTOUCHED — SHADOW RECOMMENDATION IS RETURNED FOR LOGGING ONLY
    return {
      recommendation,
      mode,
      decisionLatencyMs,
      ...(counterfactualPlan ? { plan: counterfactualPlan } : {}),
    };
  }

  public static evaluateSimulation(input: CounterfactualInput): SimulationResult {
    const mode = getGovernorMode();
    if (mode !== "simulate") return { recommendation: null, mode, decisionLatencyMs: 0, plan: null };
    const start = performance.now();
    try {
      const recommendation = this.governor.decide(input);
      return { recommendation, mode: "simulate", decisionLatencyMs: Number((performance.now() - start).toFixed(3)), plan: resolveCounterfactualPlan(input, recommendation) };
    } catch {
      return { recommendation: null, mode: "simulate", decisionLatencyMs: Number((performance.now() - start).toFixed(3)), plan: null };
    }
  }
}
