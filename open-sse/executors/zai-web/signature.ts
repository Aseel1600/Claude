/**
 * chat.z.ai request signing + browser fingerprint.
 *
 * The chat.z.ai SPA gates `POST /api/v2/chat/completions` behind three
 * independent checks. Reproducing them is what makes the provider usable at
 * all — without the first one every request comes back HTTP 200 carrying an
 * in-SSE `{"error":{"code":426,"detail":"Your client version (unknown) is
 * outdated"}}` envelope and no content:
 *
 *   1. `X-FE-Version` — the pinned SPA build string. Presence is what clears
 *      the 426 gate (an older value still passes today, so the server only
 *      checks that the header exists).
 *   2. `X-Signature` — double-HMAC over the request identity (below). Not
 *      enforced by the server as of 2026-08, but the SPA always sends it and
 *      the bundle ships localized copy for "Missing signature header" /
 *      "Signature validation failed", so it is clearly wired for enforcement.
 *      We send a correct one so a flip does not break us.
 *   3. `captcha_verify_param` — a per-message Aliyun Captcha token. See
 *      `./captcha.ts`.
 *
 * The query string carries a browser fingerprint (`urlParams`) plus
 * `signature_timestamp`. Only three of those fields feed the signature.
 *
 * Reference: public SPA bundle `chat.z.ai/assets/index-*.js`, functions
 * `vre()` (fingerprint) and `_re()` (signature).
 */
import crypto from "node:crypto";

import { resolvePublicCred } from "../../utils/publicCreds.ts";

/**
 * Pinned SPA build advertised via `X-FE-Version`. Mirrors the
 * `QWEN_SPA_VERSION` pattern in `qwen-web.ts` — refresh when chat.z.ai ships a
 * new bundle (visible in the `X-FE-Version` header of any SPA request).
 */
export const ZAI_FE_VERSION = "prod-fe-1.1.81";

/** Signature slot width: the derived key rotates every 5 minutes. */
const SIGNATURE_SLOT_MS = 5 * 60 * 1000;

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

export interface ZaiFingerprint {
  /** Comma-joined `requestId,<uuid>,timestamp,<ms>,user_id,<id>` — signature input. */
  sortedPayload: string;
  /** Full fingerprint as a URL query string, appended to the chat endpoint. */
  urlParams: string;
  /** Epoch milliseconds, as a string. Also sent as `signature_timestamp`. */
  timestamp: string;
  requestId: string;
}

/**
 * Decode the `id` claim out of a chat.z.ai session JWT without verifying it —
 * the signature payload needs the user id the SPA reads from its own session
 * store. Returns "" for guest tokens or anything unparseable; the upstream
 * accepts an empty user_id.
 */
export function extractZaiUserId(token: string): string {
  const parts = token.split(".");
  if (parts.length < 2) return "";
  try {
    const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    const id = claims?.id ?? claims?.sub ?? claims?.user_id;
    return typeof id === "string" ? id : "";
  } catch {
    return "";
  }
}

/**
 * Build the fingerprint the SPA sends on every chat request. The values are a
 * plausible fixed desktop-Chrome profile rather than randomized noise: the
 * upstream does not validate them, and a stable profile is less anomalous than
 * a fresh random one per request.
 */
export function buildZaiFingerprint(userId: string, now: number = Date.now()): ZaiFingerprint {
  const timestamp = String(now);
  const requestId = crypto.randomUUID();
  const core = { timestamp, requestId, user_id: userId };
  const environment: Record<string, string> = {
    version: "0.0.1",
    platform: "Win32",
    token: "",
    user_agent: USER_AGENT,
    language: "en-US",
    languages: "en-US,en",
    timezone: "UTC",
    cookie_enabled: "true",
    screen_width: "1920",
    screen_height: "1080",
    screen_resolution: "1920x1080",
    viewport_height: "944",
    viewport_width: "1920",
    viewport_size: "1920x944",
    color_depth: "24",
    pixel_ratio: "1",
    current_url: "https://chat.z.ai/",
    pathname: "/",
    search: "",
    hash: "",
    host: "chat.z.ai",
    hostname: "chat.z.ai",
    protocol: "https:",
    referrer: "",
    title: "Z.ai Chat",
    timezone_offset: "0",
    local_time: new Date(now).toString(),
    utc_time: new Date(now).toUTCString(),
    is_mobile: "false",
    is_touch: "false",
    max_touch_points: "0",
    browser_name: "Chrome",
    os_name: "Windows",
  };

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...core, ...environment })) {
    params.append(key, String(value));
  }

  // Only the three identity fields are signed — the environment block travels
  // in the query string only.
  const sortedPayload = Object.entries(core)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .join(",");

  return { sortedPayload, urlParams: params.toString(), timestamp, requestId };
}

/**
 * Double HMAC-SHA256:
 *   derived = HMAC(SIGN_KEY, floor(ts / 5min))
 *   signature = HMAC(derived, `${sortedPayload}|${base64(prompt)}|${ts}`)
 *
 * `prompt` must be the exact string sent as `signature_prompt` in the body.
 */
export function signZaiRequest(
  sortedPayload: string,
  prompt: string,
  timestamp: string | number
): string {
  const key = resolvePublicCred("zai_web_signature_key", "ZAI_WEB_SIGNATURE_KEY");
  const slot = Math.floor(Number(timestamp) / SIGNATURE_SLOT_MS);
  const derived = crypto.createHmac("sha256", key).update(String(slot)).digest("hex");
  const encodedPrompt = Buffer.from(prompt, "utf8").toString("base64");
  const message = `${sortedPayload}|${encodedPrompt}|${timestamp}`;
  return crypto.createHmac("sha256", derived).update(message).digest("hex");
}

/**
 * The string the SPA signs and sends as `signature_prompt`: the trimmed text of
 * the last user turn. Multi-part (vision) content contributes its text parts.
 */
export function resolveSignaturePrompt(
  messages: Array<{ role?: string; content?: unknown }>
): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message?.role !== "user") continue;
    const { content } = message;
    if (typeof content === "string") return content.trim();
    if (Array.isArray(content)) {
      const text = content
        .map((part) => {
          if (typeof part === "string") return part;
          const record = part as Record<string, unknown>;
          return typeof record?.text === "string" ? record.text : "";
        })
        .filter(Boolean)
        .join("\n");
      return text.trim();
    }
  }
  return "";
}
