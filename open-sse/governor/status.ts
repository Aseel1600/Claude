import type { GovernorMode } from "@/shared/utils/featureFlags.ts";
import { getGovernorMode, isGovernorTelemetryEnabled } from "@/shared/utils/featureFlags.ts";
import { getGovernorTelemetryQueueMetrics } from "@/lib/db/governorTelemetry.ts";
import { GOVERNOR_PROFILES, type GovernorProfile } from "./calibration.ts";
import { GOVERNOR_POLICY_VERSION } from "./constants.ts";
import { getGovernorRuntimeConfig } from "./runtimeConfig.ts";

export function getGovernorStatus(profile: GovernorProfile = "balanced") {
  const mode: GovernorMode = getGovernorMode();
  const config = getGovernorRuntimeConfig();
  return { mode, ...config, profile, policyVersion: GOVERNOR_POLICY_VERSION, telemetryEnabled: isGovernorTelemetryEnabled(), queue: getGovernorTelemetryQueueMetrics(), breakerState: "closed", breakerFailureCount: 0, profileConfig: GOVERNOR_PROFILES[profile] };
}
