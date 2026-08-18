/**
 * AI Horde image-generation provider entry.
 *
 * Chat still goes through oai.aihorde.net. Image jobs use the native Horde
 * async API (`/v2/generate/async`). `models` is a live getter so
 * imageRegistry stays under the file-size cap and zero-worker names are
 * never advertised.
 */
import { getCachedAiHordeImageCatalogEntries } from "../../../../services/aihordeImageCatalog.ts";

export const AI_HORDE_IMAGE_PROVIDER = {
  id: "aihorde",
  alias: "horde",
  baseUrl: "https://aihorde.net/api",
  authType: "apikey",
  authHeader: "apikey",
  format: "aihorde",
  get models() {
    return getCachedAiHordeImageCatalogEntries().map((entry) => ({
      id: entry.id.startsWith("aihorde/") ? entry.id.slice("aihorde/".length) : entry.id,
      name: entry.name,
      inputModalities: entry.inputModalities,
    }));
  },
  supportedSizes: ["512x512", "768x768", "1024x1024", "1024x768", "768x1024"],
};
