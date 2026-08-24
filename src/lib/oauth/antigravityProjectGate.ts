/**
 * #11284 — Antigravity OAuth connect-time rejection of accounts without a
 * Cloud Code projectId. Shared gate used by the OAuth route's `exchange` and
 * `poll-callback` branches.
 */

export type AntigravityProjectDiscoveryRejection = {
  success: false;
  error: "missing_cloud_code_project";
  errorDescription: string;
};

/** Providers whose Cloud Code projectId is mandatory at connect time. */
const PROJECT_REQUIRED_PROVIDERS = new Set(["antigravity", "agy"]);

const BYOP_MESSAGE =
  "Google did not assign a Cloud Code project to this account (BYOP). " +
  "Create a GCP Project at console.cloud.google.com, complete Gemini Code Assist onboarding, then reconnect. " +
  "This account cannot serve requests without a projectId.";

const DISCOVERY_FAILED_MESSAGE =
  "Could not discover the Google Cloud Code projectId during login (loadCodeAssist/onboardUser failed). " +
  "The account was NOT saved. Check network/proxy reachability to Google and retry.";

/**
 * #11284: reject Antigravity/AGY connects whose Cloud Code projectId discovery
 * failed, instead of persisting a dead `testStatus:"active"` row that shows
 * "Connected" while every model call fails. Google BYOP accounts (#8491)
 * report `requires_manual_project`; transient discovery failures report
 * `discovery_failed`. Returns the typed rejection payload, or null to proceed.
 */
export function antigravityMissingProjectRejection(
  provider: string,
  tokenData: Record<string, unknown> | null | undefined
): AntigravityProjectDiscoveryRejection | null {
  if (!PROJECT_REQUIRED_PROVIDERS.has(provider)) return null;
  const outcome = tokenData?.projectDiscoveryOutcome;
  if (!outcome) return null;
  console.warn(
    `[oauth] ${provider}: rejecting connect — no Cloud Code projectId (${String(outcome)}) (#11284)`
  );
  return {
    success: false,
    error: "missing_cloud_code_project",
    errorDescription:
      outcome === "requires_manual_project" ? BYOP_MESSAGE : DISCOVERY_FAILED_MESSAGE,
  };
}
