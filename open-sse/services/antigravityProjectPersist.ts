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
 * Reorder antigravity connections so those with a persisted projectId surface
 * first in quota-strategy selection (#8894). Connections without a stored
 * projectId are kept (fallthrough) but ranked after. Stable; non-mutating.
 * ponytail: O(n) copy + native stable sort; fine for connection-list sizes.
 */
export function preferAntigravityConnectionsWithStoredProject<
  T extends { projectId?: unknown; providerSpecificData?: Record<string, unknown> | null },
>(connections: T[]): T[] {
  return connections
    .map((conn, index) => {
      const data = conn.providerSpecificData;
      const hasProject = Boolean(conn.projectId || (data && data.projectId));
      return { conn, hasProject, index };
    })
    .sort((a, b) => (a.hasProject === b.hasProject ? a.index - b.index : a.hasProject ? -1 : 1))
    .map((entry) => entry.conn);
}

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
