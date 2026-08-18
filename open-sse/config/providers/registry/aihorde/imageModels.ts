/**
 * AI Horde image-generation provider entry.
 *
 * Chat still goes through oai.aihorde.net. Image jobs use the native Horde
 * async API (`/v2/generate/async`). `models` is a live getter so
 * imageRegistry stays under the file-size cap and zero-worker names are
 * never advertised.
 *
 * NOTE: this module must NOT statically import the live catalog service
 * (open-sse/services/aihordeImageCatalog.ts). That service pulls in the
 * network/DB stack (safeOutboundFetch → featureFlags → db/core →
 * better-sqlite3), which would drag server-only code into the client bundle
 * and fail the production build. Instead, the server-side Horde poller pushes
 * refreshed snapshots in through `setAiHordeImageCatalogEntries()`.
 */

export interface AiHordeRegistryModelEntry {
  id: string;
  name: string;
  provider: string;
  supportedSizes: string[];
  inputModalities: string[];
  description?: string;
}

// Snapshot of the live AI Horde catalog. Empty until the server-side poller
// pushes a refresh. (The client bundle never populates it — same as before,
// when the client always read an empty in-memory cache.)
let aiHordeCatalogEntries: AiHordeRegistryModelEntry[] = [];

export function setAiHordeImageCatalogEntries(entries: AiHordeRegistryModelEntry[]): void {
  aiHordeCatalogEntries = entries;
}

export const AI_HORDE_IMAGE_PROVIDER = {
  id: "aihorde",
  alias: "horde",
  baseUrl: "https://aihorde.net/api",
  authType: "apikey",
  authHeader: "apikey",
  format: "aihorde",
  get models() {
    return aiHordeCatalogEntries.map((entry) => ({
      id: entry.id.startsWith("aihorde/") ? entry.id.slice("aihorde/".length) : entry.id,
      name: entry.name,
      inputModalities: entry.inputModalities,
    }));
  },
  supportedSizes: ["512x512", "768x768", "1024x1024", "1024x768", "768x1024"],
};
