/**
 * open-sse/governor/nativeGovernor.ts
 *
 * Deterministic Native OmniGovernor V0 implementation.
 * Local classification & routing recommendation engine.
 *
 * ABSOLUTE GUARANTEES:
 * - 100% deterministic (same GovernorInput -> identical GovernorDecision)
 * - NO external LLM calls or network requests
 * - NO side effects, pure decision math
 * - Execution overhead < 1ms
 */

import type {
  GovernorDecision,
  GovernorInput,
  IntelligenceGovernor,
  TaskKind,
} from "./types.ts";

export class NativeOmniGovernor implements IntelligenceGovernor {
  readonly name = "NativeOmniGovernor";
  readonly version = "0.1.0";

  public classifyTask(input: GovernorInput): TaskKind {
    if (input.taskKind && input.taskKind !== "unknown") {
      return input.taskKind;
    }

    const toolCount = input.toolCount ?? 0;
    const toolTokens = input.toolOutputTokens ?? 0;
    const promptTokens = input.estimatedPromptTokens ?? 0;
    const promptText = (input.rawPromptText ?? "").toLowerCase();

    if (toolCount > 0 || toolTokens > 500) {
      return "tool_output_processing";
    }

    // Structural signals cover multilingual requests without a keyword dictionary.
    if (input.previousFailureClass || (input.retryCount ?? 0) > 0) {
      return "code_debug";
    }
    if (promptTokens >= 8000 || (input.messageCount ?? 0) >= 12) {
      return "architecture_reasoning";
    }
    if (promptTokens >= 600 || (input.messageCount ?? 0) >= 4) {
      return "code_edit_simple";
    }

    // Low-weight English hints remain only as a backwards-compatible fallback.
    if (
      promptText.includes("architecture") ||
      promptText.includes("system design") ||
      promptText.includes("trade-offs") ||
      promptText.includes("high-level plan") ||
      promptText.includes("security model")
    ) {
      return "architecture_reasoning";
    }

    if (
      promptText.includes("error") ||
      promptText.includes("exception") ||
      promptText.includes("stack trace") ||
      promptText.includes("failing test") ||
      promptText.includes("bug") ||
      promptText.includes("panic")
    ) {
      return "code_debug";
    }

    if (
      promptText.includes("format") ||
      promptText.includes("rename") ||
      promptText.includes("add comment") ||
      promptText.includes("fix typo") ||
      promptText.includes("lint")
    ) {
      return "code_edit_simple";
    }

    if (promptTokens > 0 && promptTokens < 150 && toolCount === 0) {
      return "trivial_control";
    }

    if (promptTokens >= 150) {
      return "code_edit_simple";
    }

    return "unknown";
  }

  public decide(input: GovernorInput): GovernorDecision {
    const taskKind = this.classifyTask(input);
    const retryCount = input.retryCount ?? 0;
    const contextUtilization = input.contextUtilization ?? 0;

    let decision: GovernorDecision;

    switch (taskKind) {
      case "trivial_control":
        decision = {
          modelPolicy: { recommendedTier: "low" },
          routingPolicy: { strategy: "cost_optimized" },
          reasoningPolicy: { effort: "none" },
          compressionPolicy: { mode: "compact" },
          contextBudgetPolicy: { maxPromptTokens: 2000 },
          maxOutputTokens: 1024,
          escalationPolicy: { allowedRetries: 1 },
        };
        break;

      case "tool_output_processing":
        decision = {
          modelPolicy: { recommendedTier: "medium" },
          routingPolicy: { strategy: "auto_combo" },
          reasoningPolicy: { effort: "low" },
          compressionPolicy: { mode: "rtk" },
          contextBudgetPolicy: { maxPromptTokens: 16000 },
          maxOutputTokens: 4096,
          escalationPolicy: { allowedRetries: 2 },
        };
        break;

      case "code_edit_simple":
        decision = {
          modelPolicy: { recommendedTier: "medium" },
          routingPolicy: { strategy: "direct" },
          reasoningPolicy: { effort: "low" },
          compressionPolicy: { mode: "caveman" },
          contextBudgetPolicy: { maxPromptTokens: 32000 },
          maxOutputTokens: 4096,
          escalationPolicy: { allowedRetries: 2 },
        };
        break;

      case "code_debug":
        decision = {
          modelPolicy: { recommendedTier: "high" },
          routingPolicy: { strategy: "auto_combo" },
          reasoningPolicy: { effort: "medium" },
          compressionPolicy: { mode: "none" },
          contextBudgetPolicy: { maxPromptTokens: 64000 },
          maxOutputTokens: 8192,
          escalationPolicy: { allowedRetries: 3 },
        };
        break;

      case "architecture_reasoning":
        decision = {
          modelPolicy: { recommendedTier: "highest" },
          routingPolicy: { strategy: "auto_combo" },
          reasoningPolicy: { effort: "high" },
          compressionPolicy: { mode: "none" },
          contextBudgetPolicy: { maxPromptTokens: 128000 },
          maxOutputTokens: 16384,
          escalationPolicy: { allowedRetries: 3 },
        };
        break;

      case "unknown":
      default:
        decision = {
          modelPolicy: { recommendedTier: "preserve" },
          routingPolicy: { strategy: "preserve" },
          reasoningPolicy: { effort: "preserve" },
          compressionPolicy: { mode: "preserve" },
          contextBudgetPolicy: { maxPromptTokens: input.contextWindow },
          maxOutputTokens: input.requestedMaxOutput,
          escalationPolicy: { allowedRetries: 2 },
        };
        break;
    }

    // Dynamic adaptations based on retries and pressure
    if (retryCount >= 2 && decision.modelPolicy.recommendedTier !== "preserve") {
      if (decision.modelPolicy.recommendedTier === "low") {
        decision.modelPolicy.recommendedTier = "medium";
      } else if (decision.modelPolicy.recommendedTier === "medium") {
        decision.modelPolicy.recommendedTier = "high";
      } else if (decision.modelPolicy.recommendedTier === "high") {
        decision.modelPolicy.recommendedTier = "highest";
      }

      if (decision.reasoningPolicy.effort === "none") {
        decision.reasoningPolicy.effort = "low";
      } else if (decision.reasoningPolicy.effort === "low") {
        decision.reasoningPolicy.effort = "medium";
      } else if (decision.reasoningPolicy.effort === "medium") {
        decision.reasoningPolicy.effort = "high";
      }

      decision.escalationPolicy.allowedRetries = Math.max(
        decision.escalationPolicy.allowedRetries,
        retryCount + 1
      );
    }

    if (contextUtilization > 0.85 && decision.compressionPolicy.mode === "none") {
      decision.compressionPolicy.mode = "rtk";
    }

    return decision;
  }
}
