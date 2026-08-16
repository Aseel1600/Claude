/**
 * byteplusQuotaFetcher.ts — BytePlus ModelArk quota probe.
 *
 * Best-effort upstream probe for BytePlus Ark usage, falling back to the local
 * estimate via `registerHybridQuotaFetcher` when the probe fails / no
 * credentials / endpoint unavailable.
 *
 * BytePlus ModelArk (ark.cn-beijing.volces.com) serves an OpenAI-compatible
 * API at `/api/v3`; a dedicated usage/balance endpoint is verified at
 * implementation time. The probe URL is configurable so the operator can point
 * it at the Ark usage endpoint when one is published (or their region's path):
 *
 *   OMNIROUTE_BYTEPLUS_QUOTA_URL   (default: {base}/api/v3/usage)
 *   connection.providerSpecificData.byteplusUsageUrl   (overrides env)
 *
 * Credentials: the connection's `apiKey` (Ark API key, Bearer) is used
 * automatically. Fail-open: any non-200 / parse failure → null.
 */

import { registerQuotaWindows, type QuotaFetcher, type QuotaInfo } from "./quotaPreflight.ts";
import { throttleQuotaFetch } from "./quotaFetchThrottle.ts";
import { toNumber } from "@/shared/utils/numeric";
import { registerHybridQuotaFetcher } from "./localEstimateQuotaFetcher.ts";

const DEFAULT_URL = "https://ark.cn-beijing.volces.com/api/v3/usage";
const BYTEPLUS_QUOTA_URL = process.env.OMNIROUTE_BYTEPLUS_QUOTA_URL || DEFAULT_URL;

const CACHE_TTL_MS = 60_000;

interface CacheEntry {
  quota: QuotaInfo | null;
  fetchedAt: number;
}

const quotaCache = new Map<string, CacheEntry>();

const _cacheCleanup = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of quotaCache) {
    if (now - entry.fetchedAt > CACHE_TTL_MS * 5) quotaCache.delete(key);
  }
}, 5 * 60_000);
if (typeof _cacheCleanup === "object" && "unref" in _cacheCleanup) {
  (_cacheCleanup as { unref?: () => void }).unref?.();
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Parse a BytePlus usage response into a QuotaInfo. Accepts a few common shapes:
 *   { usage: { tokens: { used, limit }, reset_at } }
 *   { data: { quota: { used, total } }, reset_at }
 *   { tokens_used, tokens_limit, reset_at }
 * Returns null when nothing parseable.
 */
function parseByteplusUsage(data: unknown): QuotaInfo | null {
  const obj = toRecord(data);
  const usage = toRecord(obj.usage ?? obj.data ?? obj);
  const tokens = toRecord(usage.tokens ?? usage.token);
  const quota = toRecord(usage.quota ?? usage.limit_info);

  const used = toNumber(
    tokens.used ?? tokens.used_tokens ?? quota.used ?? obj.tokens_used ?? obj.used,
    NaN
  );
  const limit = toNumber(
    tokens.limit ?? tokens.total ?? quota.total ?? obj.tokens_limit ?? obj.limit,
    NaN
  );
  if (!Number.isFinite(limit) || limit <= 0) return null;

  const effectiveUsed = Number.isFinite(used) ? used : 0;
  const percentUsed = Math.max(0, Math.min(1, effectiveUsed / limit));
  const resetAt =
    typeof (tokens.reset_at ?? obj.reset_at ?? quota.reset_at) === "string"
      ? String(tokens.reset_at ?? obj.reset_at ?? quota.reset_at)
      : null;

  const dailyWindow = { percentUsed, resetAt };
  return {
    used: effectiveUsed,
    total: limit,
    percentUsed,
    resetAt,
    windows: { daily: dailyWindow },
    limitReached: percentUsed >= 1,
  };
}

/** Probe BytePlus Ark usage; null on any failure (fail-open). */
export const fetchByteplusQuota: QuotaFetcher = async (connectionId, connection) => {
  const cached = quotaCache.get(connectionId);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.quota;

  const apiKey =
    typeof connection?.apiKey === "string" && connection.apiKey.trim().length > 0
      ? connection.apiKey.trim()
      : null;
  if (!apiKey) return null;

  const psd = toRecord(connection?.providerSpecificData);
  const url =
    typeof psd.byteplusUsageUrl === "string" && psd.byteplusUsageUrl.trim().length > 0
      ? psd.byteplusUsageUrl.trim()
      : BYTEPLUS_QUOTA_URL;

  try {
    await throttleQuotaFetch();
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return null; // 404 / 401 / 403 → fall back to local estimate

    const data = await response.json();
    const quota = parseByteplusUsage(data);
    quotaCache.set(connectionId, { quota, fetchedAt: Date.now() });
    if (quota) registerQuotaWindows("byteplus", ["daily"]);
    return quota;
  } catch {
    return null;
  }
};

/** Register the hybrid fetcher (BytePlus probe → local estimate fallback). */
export function registerByteplusQuotaFetcher(): void {
  registerHybridQuotaFetcher("byteplus", fetchByteplusQuota);
}
