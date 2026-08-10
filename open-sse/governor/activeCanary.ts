import type { CounterfactualExecutionPlan } from "./counterfactual.ts";

export interface ActiveCanaryConfig {
  enabled: boolean;
  rate: number;
  maxEstimatedCost?: number | null;
}

export interface ActiveCanaryDecision {
  selected: boolean;
  eligible: boolean;
  reason: string;
}

export interface GovernorMutableRequest {
  provider?: string;
  model?: string;
  max_tokens?: number;
  reasoning?: unknown;
  compression?: unknown;
}

export function stableCanarySample(correlationId: string, rate: number): boolean {
  if (!Number.isFinite(rate) || rate <= 0 || rate > 1) return false;
  let hash = 2166136261;
  for (const c of correlationId) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
  return (hash >>> 0) / 0x100000000 < rate;
}

export function allHardGuardrailsPass(plan: CounterfactualExecutionPlan): boolean {
  return Object.values(plan.guardrailResults).every((value) => value === "YES");
}

export function assessActiveCanary(
  plan: CounterfactualExecutionPlan,
  correlationId: string,
  config: ActiveCanaryConfig
): ActiveCanaryDecision {
  if (!config.enabled) return { selected: false, eligible: false, reason: "kill_switch" };
  if (!plan.executable || plan.confidence !== "HIGH") {
    return { selected: false, eligible: false, reason: "plan_not_high_confidence" };
  }
  if (!allHardGuardrailsPass(plan)) {
    return { selected: false, eligible: false, reason: "guardrail_unknown_or_failed" };
  }
  if (
    plan.estimatedCurrentCost == null ||
    plan.estimatedCounterfactualCost == null ||
    plan.estimatedCounterfactualCost > plan.estimatedCurrentCost
  ) {
    return { selected: false, eligible: false, reason: "cost_unknown_or_higher" };
  }
  if (
    config.maxEstimatedCost != null &&
    plan.estimatedCounterfactualCost > config.maxEstimatedCost
  ) {
    return { selected: false, eligible: false, reason: "cost_ceiling" };
  }
  if (!stableCanarySample(correlationId, config.rate)) {
    return { selected: false, eligible: true, reason: "not_sampled" };
  }
  return { selected: true, eligible: true, reason: "canary_selected" };
}

export function applyGovernorPlan(
  request: GovernorMutableRequest,
  plan: CounterfactualExecutionPlan
): GovernorMutableRequest {
  const snapshot = { ...request };
  if (plan.selectedProvider) request.provider = plan.selectedProvider;
  if (plan.selectedModel) request.model = plan.selectedModel;
  if (plan.maxOutputTokens != null) request.max_tokens = plan.maxOutputTokens;
  if (plan.reasoningEffort && plan.reasoningEffort !== "preserve") {
    request.reasoning = plan.reasoningEffort;
  }
  if (plan.compressionMode && plan.compressionMode !== "preserve") {
    request.compression = plan.compressionMode;
  }
  return snapshot;
}

export class ActiveCanaryCircuitBreaker {
  private failures = 0;
  private tripped = false;

  constructor(private readonly threshold = 3) {}

  record(success: boolean): void {
    if (success) {
      this.failures = 0;
      return;
    }
    this.failures += 1;
    if (this.failures >= this.threshold) this.tripped = true;
  }

  isTripped(): boolean {
    return this.tripped;
  }

  reset(): void {
    this.failures = 0;
    this.tripped = false;
  }

  recordSuccess(): void {
    this.record(true);
  }

  recordFailure(): void {
    this.record(false);
  }

  getFailureCount(): number {
    return this.failures;
  }

  getThreshold(): number {
    return this.threshold;
  }

  getState(): "open" | "closed" {
    return this.tripped ? "open" : "closed";
  }
}

let sharedBreaker: ActiveCanaryCircuitBreaker | null = null;

export function getGovernorActiveBreaker(): ActiveCanaryCircuitBreaker {
  return (sharedBreaker ??= new ActiveCanaryCircuitBreaker());
}

export function getGovernorActiveBreakerStatus(): {
  state: "open" | "closed";
  failureCount: number;
  threshold: number;
} {
  const breaker = getGovernorActiveBreaker();
  return {
    state: breaker.getState(),
    failureCount: breaker.getFailureCount(),
    threshold: breaker.getThreshold(),
  };
}

export function resetGovernorActiveBreakerForTests(): void {
  sharedBreaker?.reset();
}
