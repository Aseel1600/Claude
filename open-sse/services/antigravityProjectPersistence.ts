/**
 * Re-export from `antigravityProjectPersist.ts` plus a connection-preference helper.
 *
 * The persistence layer for a runtime-discovered Antigravity projectId lives in
 * the sibling file `antigravityProjectPersist.ts` (named by its core function).
 * This module adds `preferAntigravityConnectionsWithStoredProject()`, used by the
 * quota-strategy engine to give priority to connections whose projectId has
 * already been discovered and persisted.
 */

import { persistDiscoveredAntigravityProjectId } from "./antigravityProjectPersist.ts";

export { persistDiscoveredAntigravityProjectId };

/**
 * Prefer Antigravity connections with a discovered/stored `projectId` for
 * reset-aware quota routing.
 *
 * This is a preference, not a hard requirement: when no candidate has a stored
 * projectId, retain the full pool rather than making freshly-added accounts unusable.
 */
function hasStoredProjectId(connection: Record<string, unknown>): boolean {
  if (typeof connection.projectId === "string" && connection.projectId.trim().length > 0) {
    return true;
  }
  const providerSpecificData = connection.providerSpecificData;
  if (providerSpecificData && typeof providerSpecificData === "object") {
    const nested = (providerSpecificData as Record<string, unknown>).projectId;
    if (typeof nested === "string" && nested.trim().length > 0) return true;
  }
  return false;
}

export function preferAntigravityConnectionsWithStoredProject<T extends Record<string, unknown>>(
  connections: T[]
): T[] {
  const withStoredProject = connections.filter(hasStoredProjectId);
  return withStoredProject.length > 0 ? withStoredProject : connections;
}
