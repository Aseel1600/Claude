import type { CounterfactualExecutionPlan } from "./counterfactual.ts";
import { getGovernorRuntimeConfig } from "./runtimeConfig.ts";

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

const RUNTIME_PREFLIGHT_GUARDS = new Set(["PROVIDER_AVAILABLE", "QUOTA_ACCEPTABLE"]);

export function stableCanarySample(correlationId: string, rate: number): boolean {
  if (!Number.isFinite(rate) || rate <= 0 || rate > 1) return false;
  let hash = 2166136261;
  for (const c of correlationId) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
  return (hash >>> 0) / 0x100000000 < rate;
}

/**
 * Planning-time hard guards must be YES. Provider availability/quota may remain
 * UNKNOWN until the selected route goes through OmniRoute's real credential and
 * quota preflight. A factual NO is never deferred.
 */
export function allHardGuardrailsPass(plan: CounterfactualExecutionPlan): boolean {
  return Object.entries(plan.guardrailResults).every(([name, value]) => {
    if (value === "YES") return true;
    return value === "UNKNOWN" && RUNTIME_PREFLIGHT_GUARDS.has(name);
  });
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
  private state: "closed" | "open" | "half-open" = "closed";
  private openedAt = 0;
  private halfOpenProbeInFlight = false;

  constructor(
    private readonly threshold = 3,
    private readonly cooldownMs = 30_000,
    private readonly now = () => Date.now()
  ) {}

  record(success: boolean): void {
    if (success) {
      this.failures = 0;
      this.state = "closed";
      this.openedAt = 0;
      this.halfOpenProbeInFlight = false;
      return;
    }
    this.failures += 1;
    if (this.failures >= this.threshold) {
      this.state = "open";
      this.openedAt = this.now();
      this.halfOpenProbeInFlight = false;
    }
  }

  isTripped(): boolean {
    return this.state === "open" || this.state === "half-open";
  }

  reset(): void {
    this.failures = 0;
    this.state = "closed";
    this.openedAt = 0;
    this.halfOpenProbeInFlight = false;
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

  getCooldownMs(): number {
    return this.cooldownMs;
  }

  getOpenedAt(): number | null {
    return this.openedAt > 0 ? this.openedAt : null;
  }

  isHalfOpenProbeInFlight(): boolean {
    return this.halfOpenProbeInFlight;
  }

  getState(): "open" | "closed" | "half-open" {
    if (this.state === "open" && this.now() - this.openedAt >= this.cooldownMs) {
      this.state = "half-open";
    }
    return this.state;
  }

  tryAcquireActiveAttempt(): boolean {
    const state = this.getState();
    if (state === "closed") return true;
    if (state === "open") return false;
    if (this.halfOpenProbeInFlight) return false;
    this.halfOpenProbeInFlight = true;
    return true;
  }

  recordActiveOutcome(success: boolean): void {
    this.record(success);
    if (!success && this.state === "half-open") {
      this.state = "open";
      this.openedAt = this.now();
      this.halfOpenProbeInFlight = false;
    }
  }
}

let sharedBreaker: ActiveCanaryCircuitBreaker | null = null;

export function getGovernorActiveBreaker(): ActiveCanaryCircuitBreaker {
  if (!sharedBreaker) {
    const config = getGovernorRuntimeConfig();
    sharedBreaker = new ActiveCanaryCircuitBreaker(
      config.breakerFailureThreshold,
      config.breakerCooldownMs
    );
  }
  return sharedBreaker;
}

export function getGovernorActiveBreakerStatus(): {
  state: "open" | "closed" | "half-open";
  failureCount: number;
  threshold: number;
  cooldownMs: number;
  openedAt: number | null;
  halfOpenProbeInFlight: boolean;
} {
  const breaker = getGovernorActiveBreaker();
  return {
    state: breaker.getState(),
    failureCount: breaker.getFailureCount(),
    threshold: breaker.getThreshold(),
    cooldownMs: breaker.getCooldownMs(),
    openedAt: breaker.getOpenedAt(),
    halfOpenProbeInFlight: breaker.isHalfOpenProbeInFlight(),
  };
}

export function setGovernorActiveBreakerForTests(breaker: ActiveCanaryCircuitBreaker | null): void {
  sharedBreaker = breaker;
}
