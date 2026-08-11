import type { GovernorMode } from "@/shared/utils/featureFlags.ts";
import { getGovernorMode, isGovernorTelemetryEnabled } from "@/shared/utils/featureFlags.ts";
import { getGovernorTelemetryQueueMetrics } from "@/lib/db/governorTelemetry.ts";
import { GOVERNOR_PROFILES, type GovernorProfile } from "./calibration.ts";
import { GOVERNOR_POLICY_VERSION } from "./constants.ts";
import { getGovernorRuntimeConfig } from "./runtimeConfig.ts";
import { getGovernorActiveBreakerStatus } from "./activeCanary.ts";

export function getGovernorStatus(profile: GovernorProfile = "balanced") {
  const mode: GovernorMode = getGovernorMode();
  const config = getGovernorRuntimeConfig();
  const breaker = getGovernorActiveBreakerStatus();
  return {
    mode,
    ...config,
    profile,
    policyVersion: GOVERNOR_POLICY_VERSION,
    telemetryEnabled: isGovernorTelemetryEnabled(),
    queue: getGovernorTelemetryQueueMetrics(),
    breakerState: breaker.state,
    breakerFailureCount: breaker.failureCount,
    breakerThreshold: breaker.threshold,
    breakerCooldownMs: breaker.cooldownMs,
    breakerOpenedAt: breaker.openedAt,
    breakerHalfOpenProbeInFlight: breaker.halfOpenProbeInFlight,
    profileConfig: GOVERNOR_PROFILES[profile],
  };
}
