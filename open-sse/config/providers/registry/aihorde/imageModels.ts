/**
 * AI Horde image-generation provider entry.
 *
 * Chat still goes through oai.aihorde.net. Image jobs use the native Horde
 * async API (`/v2/generate/async`). `models` is a live getter so
 * imageRegistry stays under the file-size cap and zero-worker names are
 * never advertised.
 *
 * The catalog is served by `aihordeImageCatalog.ts`, which imports server-only
 * network/credential modules (fs, tls, child_process). Statically importing it
 * here would drag those into the client bundle — `imageRegistry` is imported by
 * client dashboard pages (MediaPageClient / ProviderDetailPageClient). The
 * catalog is only ever populated on the server, so we resolve it lazily through
 * a server-side registration (see aihordeImageCatalog.ts) instead of a static
 * import. On the client the catalog is always empty, which already matches
 * prior behavior (the client singleton is never polled).
 */

export type AiHordeCatalogEntry = {
  id: string;
  name: string;
  inputModalities: string[];
};

// Registered by aihordeImageCatalog.ts at server module load. Null on the
// client, where the catalog is never populated.
let _catalogResolver: (() => AiHordeCatalogEntry[]) | null = null;

export function registerAiHordeCatalog(resolver: () => AiHordeCatalogEntry[]): void {
  _catalogResolver = resolver;
}

export const AI_HORDE_IMAGE_PROVIDER = {
  id: "aihorde",
  alias: "horde",
  baseUrl: "https://aihorde.net/api",
  authType: "apikey",
  authHeader: "apikey",
  format: "aihorde",
  get models() {
    const entries = _catalogResolver ? _catalogResolver() : [];
    return entries.map((entry) => ({
      id: entry.id.startsWith("aihorde/") ? entry.id.slice("aihorde/".length) : entry.id,
      name: entry.name,
      inputModalities: entry.inputModalities,
    }));
  },
  supportedSizes: ["512x512", "768x768", "1024x1024", "1024x768", "768x1024"],
};
