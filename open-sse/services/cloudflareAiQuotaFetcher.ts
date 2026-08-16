/**
 * cloudflareAiQuotaFetcher.ts — Cloudflare Workers AI daily-quota probe.
 *
 * Best-effort upstream probe for the Cloudflare AI daily free-tier window
 * ("neurons/day"), falling back to the local estimate via
 * `registerHybridQuotaFetcher` when the probe fails / no credentials / endpoint
 * unavailable.
 *
 * Endpoint (configurable): `GET /accounts/{account_id}/ai/limits`
 *   Cloudflare API base: https://api.cloudflare.com/client/v4
 *   Requires a Cloudflare API token with Workers AI read scope.
 *
 * Credentials (in precedence order):
 *   env  CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID
 *   connection.providerSpecificData.cloudflareApiToken / .cloudflareAccountId
 *
 * NOTE (2026-08): the `/ai/limits` endpoint path is verified at implementation
 * time — if it 404s, the probe returns null and routing falls back to the
 * local estimate (never breaks). Set OMNIROUTE_CLOUDFLARE_AI_QUOTA_URL to a
 * working endpoint. Fail-open: any non-200 / parse failure → null.
 */

import { registerQuotaWindows, type QuotaFetcher, type QuotaInfo } from "./quotaPreflight.ts";
import { throttleQuotaFetch } from "./quotaFetchThrottle.ts";
import { toNumber } from "@/shared/utils/numeric";
import {
  getWindowBounds,
  registerHybridQuotaFetcher,
} from "./localEstimateQuotaFetcher.ts";

const DEFAULT_URL = "https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/limits";
const CLOUDFLARE_QUOTA_URL =
  process.env.OMNIROUTE_CLOUDFLARE_AI_QUOTA_URL || DEFAULT_URL;

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

function extractCredentials(connection?: Record<string, unknown>): {
  token: string | null;
  accountId: string | null;
} {
  const psd = toRecord(connection?.providerSpecificData);
  const token =
    typeof psd.cloudflareApiToken === "string" && psd.cloudflareApiToken.trim().length > 0
      ? psd.cloudflareApiToken.trim()
      : process.env.CLOUDFLARE_API_TOKEN || null;
  const accountId =
    typeof psd.cloudflareAccountId === "string" && psd.cloudflareAccountId.trim().length > 0
      ? psd.cloudflareAccountId.trim()
      : process.env.CLOUDFLARE_ACCOUNT_ID || null;
  return { token, accountId };
}

/**
 * Parse a Workers AI limits response into a daily QuotaInfo.
 * Accepts either `result.neurons{Used,Limit,Remaining}` or generic
 * `result.{used,limit,remaining}` shapes. Returns null when unparseable.
 */
function parseCloudflareLimits(data: unknown): QuotaInfo | null {
  const obj = toRecord(data);
  if (obj.success === false) return null;
  const result = toRecord(obj.result);
  const used = toNumber(result.neuronsUsed ?? result.used, NaN);
  const limit = toNumber(result.neuronsLimit ?? result.limit, NaN);
  const remaining = toNumber(result.neuronsRemaining ?? result.remaining, NaN);
  if (!Number.isFinite(limit) || limit <= 0) return null;

  const effectiveUsed = Number.isFinite(used) ? used : Math.max(0, limit - remaining);
  const percentUsed = Math.max(0, Math.min(1, effectiveUsed / limit));
  const resetIso =
    typeof result.nextResetAt === "string"
      ? result.nextResetAt
      : getWindowBounds("daily").resetIso;

  const dailyWindow = { percentUsed, resetAt: resetIso };
  return {
    used: effectiveUsed,
    total: limit,
    percentUsed,
    resetAt: resetIso,
    windows: { daily: dailyWindow },
    limitReached: percentUsed >= 1,
  };
}

/** Probe Cloudflare Workers AI daily limits; null on any failure (fail-open). */
export const fetchCloudflareAiQuota: QuotaFetcher = async (connectionId, connection) => {
  const cached = quotaCache.get(connectionId);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.quota;

  const { token, accountId } = extractCredentials(connection);
  if (!token || !accountId) return null;

  const url = CLOUDFLARE_QUOTA_URL.replace("{account_id}", accountId);
  try {
    await throttleQuotaFetch();
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return null; // 404 / 401 / 403 → fall back to local estimate

    const data = await response.json();
    const quota = parseCloudflareLimits(data);
    quotaCache.set(connectionId, { quota, fetchedAt: Date.now() });
    if (quota) registerQuotaWindows("cloudflare-ai", ["daily"]);
    return quota;
  } catch {
    return null;
  }
};

/** Register the hybrid fetcher (Cloudflare probe → local estimate fallback). */
export function registerCloudflareAiQuotaFetcher(): void {
  registerHybridQuotaFetcher("cloudflare-ai", fetchCloudflareAiQuota);
}
