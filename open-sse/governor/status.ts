import type { GovernorMode } from "@/shared/utils/featureFlags.ts";
import { getGovernorMode, isGovernorTelemetryEnabled } from "@/shared/utils/featureFlags.ts";
import { getGovernorTelemetryQueueMetrics } from "@/lib/db/governorTelemetry.ts";
import { GOVERNOR_PROFILES, type GovernorProfile } from "./calibration.ts";

export function getGovernorStatus(profile: GovernorProfile = "balanced") {
  const mode: GovernorMode = getGovernorMode();
  return { mode, activeEnabled: false, profile, policyVersion: "v1-candidate", telemetryEnabled: isGovernorTelemetryEnabled(), canaryRate: 0, queue: getGovernorTelemetryQueueMetrics(), profileConfig: GOVERNOR_PROFILES[profile] };
}
