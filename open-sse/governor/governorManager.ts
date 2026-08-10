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
import type {
  GovernorDecision,
  GovernorInput,
  GovernorTelemetry,
  IntelligenceGovernor,
  ActualRequestContext,
} from "./types.ts";

export interface EvaluationResult {
  recommendation: GovernorDecision | null;
  mode: "off" | "shadow";
  decisionLatencyMs: number;
}

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
    actualContext: ActualRequestContext
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

    if (isGovernorTelemetryEnabled()) {
      const telemetryRecord: GovernorTelemetry = {
        correlationId: input.correlationId || `gov-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        timestamp: Date.now(),
        governorMode: "shadow",
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
      };

      // Non-blocking telemetry persistence
      enqueueGovernorTelemetryRow(telemetryRecord);
    }

    // ACTIVE DECISION UNTOUCHED — SHADOW RECOMMENDATION IS RETURNED FOR LOGGING ONLY
    return {
      recommendation,
      mode: "shadow",
      decisionLatencyMs,
    };
  }
}
