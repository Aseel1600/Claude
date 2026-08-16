/**
 * Normalize Jina / Memorix native multimodal embedding items into OmniRoute's
 * canonical `{ type, source }` contract before Zod validation.
 *
 * Jina's `/v1/embeddings` and Memorix 1.6.0 send `{ image: "data:image/..." }`
 * (and `{ text }`, `{ audio }`, `{ video }`, `{ pdf }`). OmniRoute previously
 * accepted only `{ type: "image", source: { type: "base64"|"url", ... } }`, so
 * those clients received a generic HTTP 400 `Invalid request`.
 */

const JINA_MEDIA_KEYS = ["text", "image", "audio", "video", "pdf"] as const;
type JinaMediaKey = (typeof JINA_MEDIA_KEYS)[number];

const DEFAULT_MEDIA_TYPE: Record<Exclude<JinaMediaKey, "text">, string> = {
  image: "image/png",
  audio: "audio/mpeg",
  video: "video/mp4",
  pdf: "application/pdf",
};

const DATA_URI_RE = /^data:([^;,]+);base64,(.+)$/i;

export function isJinaNativeEmbeddingItem(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if ("type" in record && "source" in record) return false;
  const present = JINA_MEDIA_KEYS.filter((key) => key in record);
  if (present.length !== 1) return false;
  return typeof record[present[0]] === "string" && String(record[present[0]]).trim().length > 0;
}

function mediaStringToSource(media: string, fallbackMediaType: string) {
  const trimmed = media.trim();
  const dataUri = DATA_URI_RE.exec(trimmed);
  if (dataUri) {
    return {
      type: "base64" as const,
      data: dataUri[2],
      media_type: dataUri[1],
    };
  }
  if (/^https:\/\//i.test(trimmed)) {
    return { type: "url" as const, url: trimmed };
  }
  return {
    type: "base64" as const,
    data: trimmed,
    media_type: fallbackMediaType,
  };
}

export function jinaNativeItemToCanonical(value: Record<string, unknown>) {
  if (typeof value.text === "string") {
    return { type: "text" as const, text: value.text };
  }
  for (const key of ["image", "audio", "video", "pdf"] as const) {
    if (typeof value[key] !== "string") continue;
    const type = key === "pdf" ? ("document" as const) : key;
    return {
      type,
      source: mediaStringToSource(value[key], DEFAULT_MEDIA_TYPE[key]),
    };
  }
  return value;
}

/**
 * If the input array contains any Jina-native items, convert those (and bare
 * strings in the same batch) to canonical multimodal items. Other shapes are
 * left untouched so existing OpenAI string/token and OmniRoute structured
 * inputs keep their current Zod path.
 */
export function normalizeJinaNativeEmbeddingInput(input: unknown): unknown {
  if (!Array.isArray(input)) return input;
  if (!input.some(isJinaNativeEmbeddingItem)) return input;
  return input.map((item) => {
    if (typeof item === "string") return { type: "text", text: item };
    if (isJinaNativeEmbeddingItem(item)) {
      return jinaNativeItemToCanonical(item as Record<string, unknown>);
    }
    return item;
  });
}
