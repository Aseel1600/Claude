/**
 * Persist a runtime-discovered Antigravity projectId back onto its connection row
 * (#8491).
 *
 * `ensureAntigravityProjectAssigned()` recovers a missing projectId via a
 * `loadCodeAssist` round-trip and hands it back to the caller for the in-flight
 * request only — nothing wrote it back to the connection record, so every
 * subsequent token refresh (or process restart) lost the discovery and forced a
 * fresh round-trip. This module is the single best-effort write path both call
 * sites (`open-sse/executors/antigravity.ts` and the models-discovery
 * normalizer) funnel through, mirroring the shape `mapAntigravityTokens()`
 * already persists at OAuth-exchange time (`src/lib/oauth/providers/antigravity.ts`).
 */

import { updateProviderConnection } from "@/lib/db/providers";

/**
 * Write `discoveredProjectId` onto both the `projectId` column and
 * `providerSpecificData.projectId` for `connectionId`, preserving any other
 * `providerSpecificData` fields already on the connection.
 *
 * Best-effort / non-fatal by design: a persistence failure must never block
 * the in-flight request, which already has the discovered id in hand.
 */
export async function persistDiscoveredAntigravityProjectId(
  connectionId: string | undefined | null,
  discoveredProjectId: string | undefined | null,
  existingProviderSpecificData?: Record<string, unknown> | null
): Promise<void> {
  if (!connectionId || !discoveredProjectId) return;
  try {
    await updateProviderConnection(connectionId, {
      projectId: discoveredProjectId,
      providerSpecificData: {
        ...(existingProviderSpecificData || {}),
        projectId: discoveredProjectId,
      },
    });
  } catch {
    // Non-fatal: persistence failure must never block the in-flight request.
  }
}

/**
 * Order Antigravity connections so those that already have a discovered/stored
 * projectId come first. Used by quota-aware selection (#8894): a connection
 * without a projectId would need a fresh `loadCodeAssist` round-trip before its
 * quota can be evaluated, so prefer the ones that are immediately usable.
 */
export function preferAntigravityConnectionsWithStoredProject(
  connections: Array<Record<string, unknown>>
): Array<Record<string, unknown>> {
  if (!Array.isArray(connections)) return connections;
  const withProject: Array<Record<string, unknown>> = [];
  const withoutProject: Array<Record<string, unknown>> = [];
  for (const conn of connections) {
    const psd = conn?.providerSpecificData as Record<string, unknown> | undefined;
    const hasProject =
      (typeof conn?.projectId === "string" && (conn.projectId as string).trim().length > 0) ||
      (typeof psd?.projectId === "string" && (psd.projectId as string).trim().length > 0);
    if (hasProject) withProject.push(conn);
    else withoutProject.push(conn);
  }
  return [...withProject, ...withoutProject];
}
