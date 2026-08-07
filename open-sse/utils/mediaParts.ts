/**
 * Unified media-part detection for request messages.
 * Single source of truth shared by the vision/audio bridge guardrails (src/)
 * and the combo compatibility filter (open-sse/) — the two previously kept
 * divergent copies (guardrail missed input_image; combo saw it).
 */
export type MediaKind = "image" | "audio";

export interface MediaPart {
  kind: MediaKind;
  /** URL, data URI, or base64 payload reference for the media content. */
  ref: string;
  messageIndex: number;
  partIndex: number;
  /** Original wire shape, for callers that need format-specific handling. */
  shape:
    | "image_url"
    | "image_base64"
    | "image_source_url"
    | "input_image"
    | "data_uri_string"
    | "input_audio"
    | "audio_url"
    /**
     * Combo-parity indicator: the value looks like an image part (image-ish
     * `type` in any casing, a bare `image_url`/`input_image` key, or a
     * `source.media_type` of image/*) but carries no extractable ref — `ref`
     * may be "". Boolean callers (combo compatibility filter) count it;
     * ref-consuming callers (vision bridge) must skip empty refs.
     */
    | "image_indicator";
}

const MAX_DEPTH = 8;

interface DetectCtx {
  out: MediaPart[];
  messageIndex: number;
  partIndex: number;
}

function pushPart(ctx: DetectCtx, kind: MediaKind, ref: string, shape: MediaPart["shape"]): void {
  ctx.out.push({ kind, ref, messageIndex: ctx.messageIndex, partIndex: ctx.partIndex, shape });
}

function inspect(value: unknown, ctx: DetectCtx, depth: number): void {
  if (depth > MAX_DEPTH || value == null) return;
  if (typeof value === "string") {
    if (value.startsWith("data:image/")) pushPart(ctx, "image", value, "data_uri_string");
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) inspect(entry, ctx, depth + 1);
    return;
  }
  if (typeof value !== "object") return;
  const obj = value as Record<string, unknown>;
  const type = typeof obj.type === "string" ? obj.type : undefined;

  if (type === "image_url" || type === "input_image") {
    const raw = obj.image_url;
    const url =
      typeof raw === "string"
        ? raw
        : typeof (raw as Record<string, unknown> | undefined)?.url === "string"
          ? ((raw as Record<string, unknown>).url as string)
          : undefined;
    if (url) {
      pushPart(ctx, "image", url, type === "input_image" ? "input_image" : "image_url");
      return;
    }
  }
  if (type === "image") {
    const source = obj.source as Record<string, unknown> | undefined;
    if (source?.type === "base64" && typeof source.data === "string") {
      const media = typeof source.media_type === "string" ? source.media_type : "image/png";
      pushPart(ctx, "image", `data:${media};base64,${source.data}`, "image_base64");
      return;
    }
    // Non-empty url required: an empty `source.url` is not an extractable image
    // (mirrors the guardrail's historical `if (url)` guard).
    if (source?.type === "url" && typeof source.url === "string" && source.url) {
      pushPart(ctx, "image", source.url, "image_source_url");
      return;
    }
  }
  // Audio branches do NOT early-return: the same object can also carry image
  // indicators (bare `image_url`/`input_image` keys the legacy combo filter
  // matched) or nest image parts inside its payload — pushing audio must not
  // shadow them. `pushedAudio` guarantees at most one audio part per object.
  let pushedAudio = false;
  if (type === "input_audio") {
    const audio = obj.input_audio as Record<string, unknown> | undefined;
    if (typeof audio?.data === "string") {
      pushPart(ctx, "audio", audio.data, "input_audio");
      pushedAudio = true;
    }
  }
  if (!pushedAudio && type === "audio_url") {
    const raw = obj.audio_url;
    const url =
      typeof raw === "string"
        ? raw
        : typeof (raw as Record<string, unknown> | undefined)?.url === "string"
          ? ((raw as Record<string, unknown>).url as string)
          : undefined;
    if (url) {
      pushPart(ctx, "audio", url, "audio_url");
      pushedAudio = true;
    }
  }
  const mediaType = (obj.source as Record<string, unknown> | undefined)?.media_type;
  if (!pushedAudio && typeof mediaType === "string" && mediaType.startsWith("audio/")) {
    const data = (obj.source as Record<string, unknown>).data;
    if (typeof data === "string") {
      pushPart(ctx, "audio", data, "input_audio");
      pushedAudio = true;
    }
  }
  // Combo-parity fallback: the legacy valueContainsImagePart (comboStructure)
  // matched image-ish `type` names case-insensitively, bare `image_url` /
  // `input_image` keys, and `source.media_type` image/* — all without needing
  // an extractable ref. Emit an indicator part (ref best-effort, possibly "")
  // so boolean callers keep seeing those requests as vision requests.
  const lowerType = type?.toLowerCase();
  const looksLikeImage =
    lowerType === "image" ||
    lowerType === "image_url" ||
    lowerType === "input_image" ||
    "image_url" in obj ||
    "input_image" in obj;
  const imageMediaType =
    typeof mediaType === "string" && mediaType.toLowerCase().startsWith("image/");
  if (looksLikeImage || imageMediaType) {
    const rawUrl = obj.image_url ?? obj.input_image;
    const ref =
      typeof rawUrl === "string"
        ? rawUrl
        : typeof (rawUrl as Record<string, unknown> | undefined)?.url === "string"
          ? ((rawUrl as Record<string, unknown>).url as string)
          : "";
    pushPart(ctx, "image", ref, "image_indicator");
    return;
  }
  for (const nested of Object.values(obj)) inspect(nested, ctx, depth + 1);
}

export function detectMediaParts(
  messages: ReadonlyArray<{ role?: string; content?: unknown }> | undefined | null
): MediaPart[] {
  const out: MediaPart[] = [];
  if (!Array.isArray(messages)) return out;
  for (let messageIndex = 0; messageIndex < messages.length; messageIndex++) {
    const content = messages[messageIndex]?.content;
    if (!Array.isArray(content)) continue;
    for (let partIndex = 0; partIndex < content.length; partIndex++) {
      inspect(content[partIndex], { out, messageIndex, partIndex }, 0);
    }
  }
  return out;
}
