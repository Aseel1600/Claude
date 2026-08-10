/**
 * open-sse/governor/types.ts
 *
 * Core provider-neutral types and interface for the OmniRoute Intelligence Governor.
 * Pre-work campaign for future S3 Adaptive Intelligence Runtime integration.
 */

export type TaskKind =
  | "trivial_control"
  | "tool_output_processing"
  | "code_edit_simple"
  | "code_debug"
  | "architecture_reasoning"
  | "unknown";

export type ModelTier = "low" | "medium" | "high" | "highest" | "preserve";
export type RoutingStrategy = "direct" | "auto_combo" | "cost_optimized" | "preserve";
export type ReasoningEffort = "none" | "low" | "medium" | "high" | "preserve";
export type CompressionMode = "none" | "rtk" | "caveman" | "compact" | "preserve";
export type QuotaState = "normal" | "warning" | "exceeded";
export type LatencyState = "low" | "normal" | "high";
export type CacheState = "hit" | "miss" | "partial";

export interface GovernorInput {
  correlationId?: string;
  taskKind?: TaskKind;
  estimatedPromptTokens?: number;
  contextWindow?: number;
  contextUtilization?: number; // 0.0 - 1.0
  toolOutputTokens?: number;
  toolCount?: number;
  messageCount?: number;
  retryCount?: number;
  previousFailureClass?: string;
  requestedMaxOutput?: number;
  quotaState?: QuotaState;
  estimatedProviderCost?: number;
  latencyState?: LatencyState;
  cacheState?: CacheState;
  availableCandidates?: string[];
  rawPromptText?: string; // Evaluated locally in-memory ONLY; NEVER stored in telemetry/logs
}

export interface ModelPolicy {
  recommendedTier: ModelTier;
  recommendedModel?: string;
}

export interface RoutingPolicy {
  strategy: RoutingStrategy;
}

export interface ReasoningPolicy {
  effort: ReasoningEffort;
}

export interface CompressionPolicy {
  mode: CompressionMode;
}

export interface ContextBudgetPolicy {
  maxPromptTokens?: number;
}

export interface EscalationPolicy {
  allowedRetries: number;
  failoverStrategy?: string;
}

export interface GovernorDecision {
  modelPolicy: ModelPolicy;
  routingPolicy: RoutingPolicy;
  reasoningPolicy: ReasoningPolicy;
  compressionPolicy: CompressionPolicy;
  contextBudgetPolicy: ContextBudgetPolicy;
  maxOutputTokens?: number;
  escalationPolicy: EscalationPolicy;
}

export interface GovernorTelemetry {
  id?: number;
  correlationId: string;
  timestamp: number;
  governorMode: "off" | "shadow" | "simulate" | "active-canary" | "active";
  actualProvider: string;
  actualModel: string;
  actualRoutingStrategy?: string;
  actualReasoningConfig?: string;
  actualCompressionConfig?: string;
  actualPromptTokens: number | null;
  actualOutputTokens: number | null;
  actualTotalTokens: number | null;
  estimatedCost?: number | null;
  latencyMs: number | null;
  retryCount: number | null;
  success: boolean | null;
  errorCategory?: string;
  recommendation: GovernorDecision;
  decisionLatencyMs: number;
  governorName?: string;
  governorVersion?: string;
  policyVersion?: string;
  observedFeatures?: Record<string, number | string | boolean | null>;
  counterfactualPlan?: unknown;
}

export interface ActualRequestContext {
  provider: string;
  model: string;
  routingStrategy?: string;
  reasoningConfig?: string;
  compressionConfig?: string;
  promptTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  estimatedCost?: number | null;
  latencyMs?: number | null;
  retryCount?: number | null;
  success?: boolean | null;
  errorCategory?: string;
}

export interface GovernorExecutionContext {
  correlationId: string; mode: "off" | "shadow" | "simulate" | "active-canary" | "active";
  decision: GovernorDecision | null; plan?: unknown; decisionCount: number; planResolutionCount: number;
  originalRoute: { provider: string; model: string; strategy?: string }; selectedRoute?: { provider: string; model: string; strategy?: string };
  activeEligible: boolean; activeSelected: boolean; activeApplied: boolean; bypassReason?: string;
  fallbackAttempted: boolean; fallbackSucceeded: boolean; breakerState?: string;
}

export interface IntelligenceGovernor {
  readonly name: string;
  readonly version: string;
  decide(input: GovernorInput): GovernorDecision;
}
