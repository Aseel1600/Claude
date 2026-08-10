import type {
  GovernorDecision,
  GovernorInput,
  ModelTier,
  ReasoningEffort,
  CompressionMode,
} from "./types.ts";
import { GOVERNOR_POLICY_VERSION } from "./constants.ts";

export type Confidence = "HIGH" | "MEDIUM" | "LOW" | "INSUFFICIENT_DATA";
export type GuardrailResult = "YES" | "NO" | "UNKNOWN";

export interface CounterfactualCandidate {
  provider: string;
  model: string;
  routingModelId?: string;
  tier: ModelTier;
  available: boolean;
  capabilities: string[];
  contextWindow?: number;
  inputPrice?: number;
  outputPrice?: number;
  supportsReasoning?: boolean;
  supportsCompression?: CompressionMode[];
  quotaState?: "normal" | "warning" | "exhausted" | "unknown";
  healthScore?: number;
}

export interface CounterfactualInput extends GovernorInput {
  currentProvider?: string;
  currentModel?: string;
  currentModelTier?: ModelTier | null;
  actualInputTokens?: number | null;
  actualOutputTokens?: number | null;
  currentCost?: number | null;
  requiredCapabilities?: string[];
  candidates: CounterfactualCandidate[];
}

export interface CounterfactualExecutionPlan {
  planVersion: string;
  governorName: string;
  governorVersion: string;
  policyVersion: string;
  recommendedModelTier: ModelTier;
  selectedProvider: string | null;
  selectedModel: string | null;
  resolvedModelTier: ModelTier | null;
  routingStrategy: string;
  reasoningEffort: ReasoningEffort;
  thinkingBudget: number | null;
  compressionMode: CompressionMode;
  contextBudget: number | null;
  maxOutputTokens: number | null;
  escalationPolicy: GovernorDecision["escalationPolicy"];
  estimatedCurrentCost: number | null;
  estimatedCounterfactualCost: number | null;
  estimatedSavings: number | null;
  estimatedSavingsPercent: number | null;
  tokenReductionOpportunity: number | null;
  confidence: Confidence;
  executable: boolean;
  unresolvedFields: string[];
  guardrailResults: Record<string, GuardrailResult>;
  reasons: string[];
  liveActiveControl: boolean;
}

function supports(candidate: CounterfactualCandidate, required: string[]): boolean {
  return required.every((value) => candidate.capabilities.includes(value));
}

function cost(candidate: CounterfactualCandidate, input: CounterfactualInput): number | null {
  if (
    candidate.inputPrice == null ||
    candidate.outputPrice == null ||
    input.actualInputTokens == null ||
    input.actualOutputTokens == null
  ) {
    return null;
  }
  return (
    (candidate.inputPrice * input.actualInputTokens +
      candidate.outputPrice * input.actualOutputTokens) /
    1_000_000
  );
}

function quotaGuard(candidate: CounterfactualCandidate | undefined): GuardrailResult {
  if (!candidate) return "UNKNOWN";
  if (candidate.quotaState === "exhausted") return "NO";
  if (candidate.quotaState === "normal" || candidate.quotaState === "warning") return "YES";
  return "UNKNOWN";
}

export function resolveCounterfactualPlan(
  input: CounterfactualInput,
  decision: GovernorDecision
): CounterfactualExecutionPlan {
  const unresolved: string[] = [];
  const required = input.requiredCapabilities ?? [];
  const suitable = input.candidates.filter(
    (candidate) =>
      candidate.available === true &&
      candidate.quotaState !== "exhausted" &&
      supports(candidate, required)
  );

  const candidate =
    decision.modelPolicy.recommendedTier === "preserve"
      ? suitable.find((item) => item.model === input.currentModel)
      : suitable
          .filter((item) => item.tier === decision.modelPolicy.recommendedTier)
          .sort((a, b) => (b.healthScore ?? 0) - (a.healthScore ?? 0))[0];

  if (!candidate) unresolved.push("candidate");

  const capability: GuardrailResult = candidate
    ? "YES"
    : suitable.length > 0
      ? "UNKNOWN"
      : "NO";

  const contextFits: GuardrailResult = !candidate
    ? "UNKNOWN"
    : candidate.contextWindow == null || input.estimatedPromptTokens == null
      ? "UNKNOWN"
      : input.estimatedPromptTokens <= candidate.contextWindow
        ? "YES"
        : "NO";

  const reasoningSupported: GuardrailResult =
    decision.reasoningPolicy.effort === "none" || decision.reasoningPolicy.effort === "preserve"
      ? "YES"
      : candidate?.supportsReasoning == null
        ? "UNKNOWN"
        : candidate.supportsReasoning
          ? "YES"
          : "NO";

  const compressionSupported: GuardrailResult =
    decision.compressionPolicy.mode === "none" ||
    decision.compressionPolicy.mode === "preserve"
      ? "YES"
      : candidate?.supportsCompression == null
        ? "UNKNOWN"
        : candidate.supportsCompression.includes(decision.compressionPolicy.mode)
          ? "YES"
          : "NO";

  const providerAvailable: GuardrailResult = candidate
    ? candidate.available === true
      ? "YES"
      : "NO"
    : "UNKNOWN";
  const quotaAcceptable = quotaGuard(candidate);

  const currentCost = input.currentCost ?? null;
  const counterCost = candidate ? cost(candidate, input) : null;
  if (counterCost == null) unresolved.push("pricingOrUsage");

  const requestedMax = input.requestedMaxOutput;
  const recommendedMax = decision.maxOutputTokens;
  const outputTokens =
    requestedMax == null && recommendedMax == null
      ? null
      : Math.max(
          1,
          Math.min(
            recommendedMax ?? requestedMax ?? Number.MAX_SAFE_INTEGER,
            requestedMax ?? Number.MAX_SAFE_INTEGER
          )
        );

  const userMaxRespected: GuardrailResult =
    outputTokens == null || requestedMax == null || outputTokens <= requestedMax ? "YES" : "NO";

  const savings =
    currentCost != null && counterCost != null ? currentCost - counterCost : null;

  const guardrailResults: Record<string, GuardrailResult> = {
    CAPABILITY_COMPATIBLE: capability,
    CONTEXT_FITS: contextFits,
    PROVIDER_AVAILABLE: providerAvailable,
    QUOTA_ACCEPTABLE: quotaAcceptable,
    REASONING_SUPPORTED: reasoningSupported,
    COMPRESSION_SUPPORTED: compressionSupported,
    USER_MAX_OUTPUT_RESPECTED: userMaxRespected,
  };

  const executable =
    Boolean(candidate) && Object.values(guardrailResults).every((value) => value === "YES");

  const confidence: Confidence = executable
    ? counterCost != null && currentCost != null
      ? "HIGH"
      : "MEDIUM"
    : candidate
      ? "LOW"
      : "INSUFFICIENT_DATA";

  return {
    planVersion: "3a-v1",
    governorName: "NativeOmniGovernor",
    governorVersion: "0.1.0",
    policyVersion: GOVERNOR_POLICY_VERSION,
    recommendedModelTier: decision.modelPolicy.recommendedTier,
    selectedProvider: candidate?.provider ?? null,
    selectedModel: candidate?.model ?? null,
    resolvedModelTier: candidate?.tier ?? null,
    routingStrategy: decision.routingPolicy.strategy,
    reasoningEffort: decision.reasoningPolicy.effort,
    thinkingBudget: null,
    compressionMode: decision.compressionPolicy.mode,
    contextBudget: decision.contextBudgetPolicy.maxPromptTokens ?? null,
    maxOutputTokens: outputTokens,
    escalationPolicy: decision.escalationPolicy,
    estimatedCurrentCost: currentCost,
    estimatedCounterfactualCost: counterCost,
    estimatedSavings: savings,
    estimatedSavingsPercent:
      savings != null && currentCost != null && currentCost !== 0
        ? (savings / currentCost) * 100
        : null,
    tokenReductionOpportunity:
      requestedMax != null && outputTokens != null ? Math.max(0, requestedMax - outputTokens) : null,
    confidence,
    executable,
    unresolvedFields: unresolved,
    guardrailResults,
    reasons: [
      `tier=${decision.modelPolicy.recommendedTier}`,
      `candidate=${candidate ? "resolved" : "unresolved"}`,
      `routing=${decision.routingPolicy.strategy}`,
      "plan=counterfactual",
    ],
    liveActiveControl: false,
  };
}
