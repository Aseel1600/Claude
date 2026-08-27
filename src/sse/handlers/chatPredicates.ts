import { getTrustedLocalRateLimitResponse } from "@omniroute/open-sse/services/rateLimitManager/errors";
import { redactVideoTranscriptSensitiveText } from "@/lib/guardrails/videoTranscriptLogRedaction";

import { isLocalStreamLifecycleError } from "../../shared/utils/circuitBreaker";
import { isRequestScopedUpstreamFailure } from "./comboFailureLogging";

export const PROVIDER_BREAKER_FAILURE_STATUSES = new Set([408, 500, 502, 503, 504]);

export function isProviderBreakerFailureStatus(status: number): boolean {
  return PROVIDER_BREAKER_FAILURE_STATUSES.has(Number(status));
}

// #7907/#7908: single-model breaker trip bypasses the `isFailure` option (only applies
// inside `breaker.execute()`), so it needs its own `isLocalStreamLifecycleError` guard —
// otherwise a client abort (502 default, error='request_signal_aborted') trips the
// provider-wide breaker. Pure predicate, unit-testable without the full request path.
export function shouldTripProviderBreakerForResult(
  result: {
    status: number;
    response?: Response;
    errorCode?: string | null;
    errorType?: string | null;
    error?: unknown;
  },
  isCombo: boolean,
  forceLiveComboTest: boolean
): boolean {
  return (
    !forceLiveComboTest &&
    !isCombo &&
    !isRequestScopedUpstreamFailure({ code: result.errorCode, type: result.errorType }) &&
    !(result.response && getTrustedLocalRateLimitResponse(result.response)) &&
    !isLocalStreamLifecycleError(result.error) &&
    // Network-layer errors (ECONNREFUSED, ETIMEDOUT) never reached the provider —
    // the provider may be healthy, only the network path is broken. OmniRoute's own
    // rate-limit queue timeouts are backpressure we applied, not a provider failure.
    result.errorCode !== "proxy_unreachable" &&
    result.errorCode !== "RATE_LIMIT_QUEUE_TIMEOUT" &&
    result.errorCode !== "RATE_LIMIT_QUEUE_WEDGED" &&
    PROVIDER_BREAKER_FAILURE_STATUSES.has(Number(result.status))
  );
}

export function isAntigravityMissingProjectError(
  provider: string,
  result: { status?: number; errorCode?: string; errorType?: string }
): boolean {
  return (
    provider === "antigravity" &&
    result.status === 422 &&
    result.errorCode === "missing_project_id" &&
    result.errorType === "oauth_missing_project_id"
  );
}

/**
 * Keep stream-readiness routing decisions on the stable gate diagnostic.
 * The operator-facing error can contain arbitrary upstream words such as
 * "quota" or "retry after", which must not change account/combo classification.
 */
export function resolveStreamReadinessClassificationError(
  result: {
    classificationError?: unknown;
    error?: unknown;
    errorCode?: unknown;
  },
  fallback = "Antigravity stream ended before useful content"
): string {
  for (const value of [result.classificationError, result.error, result.errorCode]) {
    if (typeof value === "string" && value.trim()) return value;
  }
  return fallback;
}

export interface DailyQuotaModelViews {
  /** Exact provider token used by model-lockout state and future routing decisions. */
  operationalModel: string;
  /** Safe representation allowed in retained application logs. */
  retainedModel: string;
}

/** Keep routing semantics raw while separating the retained representation at the parse seam. */
export function resolveDailyQuotaModelViews(
  errorText: string,
  resolvedModel: string,
  videoTranscriptSensitive: boolean
): DailyQuotaModelViews {
  const match = errorText.match(/today's quota for model ([^,]+)/);
  const upstreamModel = match?.[1]?.trim();
  const operationalModel = upstreamModel || resolvedModel;
  return {
    operationalModel,
    retainedModel: redactVideoTranscriptSensitiveText(
      operationalModel,
      videoTranscriptSensitive && Boolean(upstreamModel)
    ),
  };
}
