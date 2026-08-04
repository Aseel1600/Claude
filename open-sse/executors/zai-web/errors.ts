/**
 * chat.z.ai in-SSE application errors.
 *
 * The upstream answers HTTP 200 and then reports failures *inside* the stream:
 *
 *   data: {"type":"chat:completion","data":{"done":true,
 *          "error":{"code":"FRONTEND_CAPTCHA_REQUIRED",
 *                   "captcha_error_type":"missing_param","detail":"…"}}}
 *
 * Before this was parsed, every one of these turned into an empty 200 with no
 * content and no diagnostic — the reported "can't make API calls" symptom. Each
 * shape below is mapped to a real HTTP status plus operator-actionable copy.
 */

export interface ZaiUpstreamError {
  status: number;
  code: string;
  message: string;
}

const CAPTCHA_CODES = new Set([
  "FRONTEND_CAPTCHA_REQUIRED",
  "CAPTCHA_VERIFICATION_FAILED",
  "CAPTCHA_UNAVAILABLE",
]);

function captchaMessage(captchaErrorType: string, detail: string): string {
  if (captchaErrorType === "verify_failed") {
    return (
      "Z.ai rejected the captcha token (verify_failed). Aliyun captcha tokens are " +
      "single-use and expire within minutes — capture a fresh one from a chat.z.ai " +
      "browser session and set providerSpecificData.captchaVerifyParam."
    );
  }
  if (captchaErrorType === "missing_param") {
    return (
      "Z.ai requires a per-message Aliyun captcha token. Complete the captcha on " +
      "chat.z.ai, copy the captchaVerifyParam value from the chat request, and set " +
      "providerSpecificData.captchaVerifyParam (a string, or an array to pool " +
      "several tokens). Each token is spent by exactly one message."
    );
  }
  return detail || "Z.ai captcha verification is unavailable — retry shortly.";
}

function classifyCode(code: string, captchaErrorType: string, detail: string): ZaiUpstreamError {
  if (CAPTCHA_CODES.has(code)) {
    return { status: 403, code, message: captchaMessage(captchaErrorType, detail) };
  }
  if (code === "426") {
    return {
      status: 426,
      code: "CLIENT_VERSION_OUTDATED",
      message:
        "Z.ai rejected the client version. The pinned X-FE-Version is stale — " +
        "update ZAI_FE_VERSION in open-sse/executors/zai-web/signature.ts to the " +
        "value chat.z.ai currently sends.",
    };
  }
  if (code === "403") {
    return {
      status: 403,
      code: "MODEL_NOT_AVAILABLE",
      message:
        detail ||
        "This model is not available for the current Z.ai account level. Pick a " +
          "model your account can access.",
    };
  }
  if (code === "401") {
    return {
      status: 401,
      code: "SESSION_EXPIRED",
      message: "Z.ai session expired — re-copy the Cookie header from chat.z.ai.",
    };
  }
  const numeric = Number(code);
  const status = Number.isFinite(numeric) && numeric >= 400 && numeric <= 599 ? numeric : 502;
  return { status, code: code || "UPSTREAM_ERROR", message: detail || "Z.ai upstream error." };
}

/**
 * Detect an error envelope in a decoded SSE frame. Returns null for normal
 * content frames.
 */
export function detectZaiUpstreamError(raw: unknown): ZaiUpstreamError | null {
  if (!raw || typeof raw !== "object") return null;
  const frame = raw as Record<string, unknown>;
  const inner = (frame.data ?? {}) as Record<string, unknown>;
  const deepest = (inner.data ?? {}) as Record<string, unknown>;

  const error = (frame.error ?? inner.error ?? deepest.error) as
    Record<string, unknown> | undefined;
  if (!error || typeof error !== "object") return null;

  const code = String(error.error_code ?? error.code ?? "");
  const detail = typeof error.detail === "string" ? error.detail : "";
  const captchaErrorType =
    typeof error.captcha_error_type === "string" ? error.captcha_error_type : "";
  const verifyCode = typeof error.verify_code === "string" ? error.verify_code : "";

  const classified = classifyCode(code, captchaErrorType, detail);
  return verifyCode
    ? { ...classified, message: `${classified.message} (upstream verify_code ${verifyCode})` }
    : classified;
}

/** Signature-rejection strings the SPA ships localized copy for. */
export function detectZaiSignatureError(text: string): ZaiUpstreamError | null {
  if (!text) return null;
  if (
    text.includes("Missing signature header") ||
    text.includes("Signature validation failed") ||
    text.includes("Signature validation error")
  ) {
    return {
      status: 403,
      code: "SIGNATURE_REJECTED",
      message:
        "Z.ai rejected the request signature. The signing key shipped in the SPA " +
        "bundle has rotated — refresh zai_web_signature_key (see " +
        "docs/security/PUBLIC_CREDS.md) or set ZAI_WEB_SIGNATURE_KEY.",
    };
  }
  return null;
}
