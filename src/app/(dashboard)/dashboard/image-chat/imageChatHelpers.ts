/**
 * Pure helpers for the Image Chat lab page.
 *
 * Kept free of React and DOM so they can be unit-tested with node:test.
 * The component consumes these; anything touching canvas/clipboard stays in the
 * client component.
 */

/** A single part of a multimodal user turn. */
export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
  /** data: URLs of the attachments sent with this turn (user turns only). */
  attachments?: string[];
  /** b64 PNG produced by the image model (assistant turns only). */
  image?: string;
  error?: string;
}

/**
 * Chat routes with vision VERIFIED on this instance (2026-08-06).
 *
 * `vision: true` from the provider catalog is a DECLARED capability and is not
 * sufficient — VOID routes declare it, accept the payload, and either tokenize
 * the base64 as text or silently ignore the image. Only routes that answered a
 * known-content probe correctly are listed here.
 */
export const VERIFIED_VISION_ROUTES = [
  "openai-compatible-chat-f71d6553-4e0b-497d-be70-26fed7adee3b/gpt-5.6",
  "openai-compatible-chat-f71d6553-4e0b-497d-be70-26fed7adee3b/gpt-5.6-terra",
  "openai-compatible-chat-f71d6553-4e0b-497d-be70-26fed7adee3b/gpt-5.4",
] as const;

/** The only image model that actually generates on this instance. */
export const IMAGE_MODEL =
  "openai-compatible-chat-f71d6553-4e0b-497d-be70-26fed7adee3b/gpt-image-2";

/** Max edge, in px, for the derived copy sent to the vision model. */
export const ANALYSIS_MAX_EDGE = 1024;

/**
 * Vision token baseline measured on the TCB adapter (2026-08-06):
 * 128²→27, 256²→84, 512²→315, 1024²→1236 tokens.
 */
export function estimateVisionTokens(width: number, height: number): number {
  if (!Number.isFinite(width) || !Number.isFinite(height)) return 0;
  if (width <= 0 || height <= 0) return 0;
  return Math.round(8 + 0.00117 * width * height);
}

/**
 * Target dimensions for the analysis copy — scales the longest edge down to
 * `maxEdge`, preserving aspect ratio. Images already within budget pass through.
 */
export function computeTargetDimensions(
  width: number,
  height: number,
  maxEdge: number = ANALYSIS_MAX_EDGE
): { width: number; height: number; resized: boolean } {
  if (width <= 0 || height <= 0) return { width: 0, height: 0, resized: false };
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width, height, resized: false };
  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    resized: true,
  };
}

/**
 * Builds the OpenAI-compatible `messages` array.
 *
 * A turn with attachments becomes an array of typed parts; a text-only turn
 * keeps the plain-string form. This is the contract change the stock ChatTab
 * lacks — it always emits `content: string`, which cannot carry an image.
 */
export function buildMultimodalMessages(
  messages: ChatMessage[],
  systemPrompt?: string
): Array<{ role: string; content: string | ContentPart[] }> {
  const out: Array<{ role: string; content: string | ContentPart[] }> = [];

  if (systemPrompt && systemPrompt.trim()) {
    out.push({ role: "system", content: systemPrompt.trim() });
  }

  for (const m of messages) {
    if (m.role === "system") continue;
    // Generated images are shown in the UI but never replayed upstream as text.
    if (m.role === "assistant" && m.image) continue;

    const attachments = m.attachments ?? [];
    if (m.role === "user" && attachments.length > 0) {
      const parts: ContentPart[] = [];
      if (m.content.trim()) parts.push({ type: "text", text: m.content });
      for (const url of attachments) {
        parts.push({ type: "image_url", image_url: { url } });
      }
      out.push({ role: m.role, content: parts });
    } else {
      out.push({ role: m.role, content: m.content });
    }
  }

  return out;
}

/** Thrown when a 2xx carries no usable payload. */
export class EmptyUpstreamResponseError extends Error {
  constructor(message = "Provider returned 2xx without a usable image.") {
    super(message);
    this.name = "EmptyUpstreamResponseError";
  }
}

/**
 * Extracts the b64 PNG from an images endpoint response.
 *
 * A 2xx with no usable content is an upstream failure, not a success — the
 * chat endpoint returns exactly that shape for image models and callers must
 * not render it as an empty answer.
 */
export function extractGeneratedImage(payload: unknown): string {
  const data = (payload as { data?: Array<{ b64_json?: string; url?: string }> })?.data;
  if (!Array.isArray(data) || data.length === 0) {
    throw new EmptyUpstreamResponseError();
  }
  const first = data[0];
  const b64 = typeof first?.b64_json === "string" ? first.b64_json.trim() : "";
  if (b64) return b64;
  const url = typeof first?.url === "string" ? first.url.trim() : "";
  if (url) return url;
  throw new EmptyUpstreamResponseError();
}

/** Short label for a fully-qualified `provider/model` route. */
export function routeLabel(route: string): string {
  const idx = route.lastIndexOf("/");
  return idx === -1 ? route : route.slice(idx + 1);
}

/**
 * Decides which images endpoint a request belongs to.
 *
 * The split between `/generations` and `/edits` is an API detail: from the
 * operator's side both are "make me an image". The presence of a base image is
 * what actually distinguishes them, so the UI routes on that instead of asking.
 */
export function resolveImageEndpoint(hasBaseImage: boolean): string {
  return hasBaseImage ? "/api/v1/images/edits" : "/api/v1/images/generations";
}

/**
 * Strips conversational scaffolding so an assistant answer reads as an image
 * prompt.
 *
 * The reasoning model already produced the description — asking it again for a
 * condensed form would be paying twice for the same content. What it needs is
 * light cleanup: markdown emphasis, headings and a leading acknowledgement
 * ("Claro!", "Sure!") that the image model would otherwise try to draw.
 *
 * Deliberately conservative: this only trims, never rewrites. The operator sees
 * and edits the result before anything is generated.
 */
export function seedPromptFromAnswer(answer: string): string {
  if (!answer) return "";

  let text = answer
    // fenced code blocks rarely belong in an image prompt
    .replace(/```[\s\S]*?```/g, " ")
    // markdown headings, emphasis and list bullets
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*|__|\*|_/g, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "");

  // Drop a single leading acknowledgement sentence, when short enough to be one.
  const ack =
    /^\s*(claro|certo|perfeito|com certeza|sure|of course|got it|entendi|beleza)\b[^.!?\n]{0,80}[.!?:]\s*/i;
  text = text.replace(ack, "");

  return text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

/** True when the keystroke should send the message. */
export function isSendKey(event: {
  key: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  isComposing?: boolean;
}): boolean {
  if (event.key !== "Enter") return false;
  // IME composition (accents, CJK) must not be interrupted.
  if (event.isComposing) return false;
  return !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey;
}
