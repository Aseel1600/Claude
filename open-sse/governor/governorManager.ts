/**
 * open-sse/governor/governorManager.ts
 *
 * Intelligence Governor Manager & Shadow Mode Evaluator.
 *
 * GUARANTEES:
 * - When mode is 'off': Zero overhead, no evaluations performed.
 * - When mode is 'shadow': Recommendations are generated and recorded for telemetry ONLY.
 * - Active routing decision is 100% UNTOUCHED (DEFAULT_ROUTING_BEHAVIOR_CHANGED = false).
 * - Non-blocking telemetry persistence: failure to log telemetry never throws into request flow.
 */

import { getGovernorMode, isGovernorTelemetryEnabled } from "@/shared/utils/featureFlags.ts";
import { insertGovernorTelemetryRow } from "@/lib/db/governorTelemetry.ts";
import { NativeOmniGovernor } from "./nativeGovernor.ts";
import type {
  GovernorDecision,
  GovernorInput,
  GovernorTelemetry,
  IntelligenceGovernor,
} from "./types.ts";

export interface EvaluationResult {
  recommendation: GovernorDecision | null;
  mode: "off" | "shadow";
  decisionLatencyMs: number;
}

export interface ActualRequestContext {
  provider: string;
  model: string;
  routingStrategy?: string;
  reasoningConfig?: string;
  compressionConfig?: string;
  promptTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  estimatedCost?: number;
  latencyMs?: number;
  retryCount?: number;
  success?: boolean;
  errorCategory?: string;
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
      const promptTokens = actualContext.promptTokens ?? input.estimatedPromptTokens ?? 0;
      const outputTokens = actualContext.outputTokens ?? input.requestedMaxOutput ?? 0;
      const totalTokens = actualContext.totalTokens ?? promptTokens + outputTokens;

      const telemetryRecord: GovernorTelemetry = {
        correlationId: input.correlationId || `gov-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        timestamp: Date.now(),
        governorMode: "shadow",
        actualProvider: actualContext.provider || "unknown",
        actualModel: actualContext.model || "unknown",
        actualRoutingStrategy: actualContext.routingStrategy,
        actualReasoningConfig: actualContext.reasoningConfig,
        actualCompressionConfig: actualContext.compressionConfig,
        actualPromptTokens: promptTokens,
        actualOutputTokens: outputTokens,
        actualTotalTokens: totalTokens,
        estimatedCost: actualContext.estimatedCost,
        latencyMs: actualContext.latencyMs ?? 0,
        retryCount: actualContext.retryCount ?? input.retryCount ?? 0,
        success: actualContext.success ?? true,
        errorCategory: actualContext.errorCategory,
        recommendation,
        decisionLatencyMs,
      };

      // Non-blocking telemetry persistence
      try {
        insertGovernorTelemetryRow(telemetryRecord);
      } catch (err) {
        console.warn("[GovernorManager] Telemetry persistence catch:", err);
      }
    }

    // ACTIVE DECISION UNTOUCHED — SHADOW RECOMMENDATION IS RETURNED FOR LOGGING ONLY
    return {
      recommendation,
      mode: "shadow",
      decisionLatencyMs,
    };
  }
}
