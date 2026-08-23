import { createHmac } from "crypto";

const ADMISSION_FINGERPRINT_CONTEXT = "omniroute-admission-fingerprint-v1";

function fingerprint(value: string): string {
  return `key_${createHmac("sha256", ADMISSION_FINGERPRINT_CONTEXT)
    .update(value)
    .digest("hex")
    .slice(0, 16)}`;
}

/**
 * Resolve the opaque fairness key used by the process-wide admission budget.
 * Credentials are HMAC-fingerprinted and are never exposed in diagnostics.
 */
export function resolveSessionId(request: Request): string {
  const authHeader = request.headers.get("authorization") || "";
  const bearerMatch = /^bearer\s+(\S+)$/i.exec(authHeader.trim());
  if (bearerMatch) return fingerprint(bearerMatch[1]);

  const xApiKey = request.headers.get("x-api-key")?.trim();
  if (xApiKey) return fingerprint(xApiKey);

  const xGoogApiKey = request.headers.get("x-goog-api-key")?.trim();
  if (xGoogApiKey) return fingerprint(xGoogApiKey);

  return "anonymous";
}
