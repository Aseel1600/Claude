/**
 * opencodeQuotaFetcher.ts — OpenCode Go / OpenCode / OpenCode Zen Quota Fetcher
 *
 * Implements QuotaFetcher for the opencode-go, opencode, and opencode-zen providers
 * (quotaPreflight.ts + quotaMonitor.ts).
 *
 * OpenCode Go has THREE independent quota windows per subscription:
 *   - 5-hour (rolling):  $12 of usage
 *   - Weekly:            $30 of usage
 *   - Monthly:           $60 of usage
 *
 * Upstream endpoint (live as of anomalyco/opencode#16513, merged 2026-08-11):
 *   GET https://opencode.ai/zen/go/v1/usage
 *   Authorization: Bearer <apiKey>
 *
 * Expected response shape (Subscription.analyze* helpers, packages/console/core):
 *   {
 *     useBalance: boolean,
 *     rollingUsage: { status: "ok" | "rate-limited", resetInSec: number, usagePercent: number },
 *     weeklyUsage:  { status: "ok" | "rate-limited", resetInSec: number, usagePercent: number },
 *     monthlyUsage: { status: "ok" | "rate-limited", resetInSec: number, usagePercent: number }
 *   }
 *   usagePercent is 0-100 of the micro-cents limit; resetInSec is seconds until
 *   the window resets; status "rate-limited" means the window is exhausted.
 *
 * If the upstream server is still on an older build (endpoint not deployed yet)
 * it may return HTTP 404 — this fetcher is implemented defensively so that the
 * dashboard shows "No quota data" gracefully rather than crashing.
 *
 * On a 404 response we log ONE console.warn (latched per process — not per
 * request) pointing at the upstream deployment status, then cache the
 * "endpoint unavailable" result for 5 minutes to avoid hammering. On any other
 * non-200 / parse failure we return null (fail-open) silently. The first
 * call from each server boot is what the operator is most likely to see, so
 * we make it count.
 *
 * Cache: in-memory TTL (60s for success, 5 min for 404).
 *
 * Override: set OMNIROUTE_OPENCODE_QUOTA_URL to point at a different endpoint.
 *
 * Registration: call registerOpencodeQuotaFetcher() once at server startup.
 */

import { registerQuotaFetcher, registerQuotaWindows, type QuotaInfo } from "./quotaPreflight.ts";
import { registerMonitorFetcher } from "./quotaMonitor.ts";
import { throttleQuotaFetch } from "./quotaFetchThrottle.ts";
import { fetchLocalEstimateQuota } from "./localEstimateQuotaFetcher.ts";

// OpenCode Go usage endpoint — same key works across opencode, opencode-go, opencode-zen.
// Live upstream since anomalyco/opencode#16513 (merged 2026-08-11): GET /zen/go/v1/usage.
// Set OMNIROUTE_OPENCODE_QUOTA_URL to override.
const OPENCODE_QUOTA_URL =
  process.env.OMNIROUTE_OPENCODE_QUOTA_URL ?? "https://opencode.ai/zen/go/v1/usage";

// Cache TTL — matches Codex / DeepSeek / Bailian pattern (60s)
const CACHE_TTL_MS = 60_000;
// TTL for cached "endpoint unavailable" results (404) — longer to avoid hammering
// a non-existent endpoint
const NO_ENDPOINT_TTL_MS = 5 * 60_000; // 5 minutes

// Window keys as surfaced to the dashboard and quota-window registry
export const OPENCODE_WINDOW_5H = "window_5h";
export const OPENCODE_WINDOW_WEEKLY = "window_weekly";
export const OPENCODE_WINDOW_MONTHLY = "window_monthly";

// Triple-window quota info
export interface OpencodeTripleWindowQuota extends QuotaInfo {
  window5h: { percentUsed: number; resetAt: string | null };
  windowWeekly: { percentUsed: number; resetAt: string | null };
  windowMonthly: { percentUsed: number; resetAt: string | null };
  limitReached: boolean;
}

interface CacheEntry {
  quota: OpencodeTripleWindowQuota | null;
  fetchedAt: number;
  /** true when quota is null because the upstream endpoint returned 404 */
  noEndpoint?: boolean;
}

// In-memory cache: connectionId → { quota, fetchedAt }
const quotaCache = new Map<string, CacheEntry>();

// One-time 404 warning per URL (avoids spamming on every request)
const _warned404Urls = new Set<string>();

/**
 * Reset the 404-warning latch (test-only).
 * Exported for unit tests that want to verify the warning fires on each fresh
 * 404 response.
 */
export function _resetWarned404Urls(): void {
  _warned404Urls.clear();
}

/**
 * Check whether a URL has had its 404 warning already emitted (test-only).
 */
export function _hasWarned404(url: string): boolean {
  return _warned404Urls.has(url);
}

// Auto-cleanup stale entries every 5 minutes
const _cacheCleanup = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of quotaCache) {
    if (now - entry.fetchedAt > CACHE_TTL_MS * 5) {
      quotaCache.delete(key);
    }
  }
}, 5 * 60_000);

if (typeof _cacheCleanup === "object" && "unref" in _cacheCleanup) {
  (_cacheCleanup as { unref?: () => void }).unref?.();
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function parseWindowResetAt(window: Record<string, unknown>): string | null {
  const resetAt = toNumber(window["reset_at"] ?? window["resetAt"], 0);
  if (resetAt > 0) {
    // Unix timestamp in seconds (< 1e12) or milliseconds (>= 1e12)
    return new Date(resetAt < 1e12 ? resetAt * 1000 : resetAt).toISOString();
  }
  const resetAfterSeconds = toNumber(
    window["reset_after_seconds"] ?? window["resetAfterSeconds"],
    0
  );
  if (resetAfterSeconds > 0) {
    return new Date(Date.now() + resetAfterSeconds * 1000).toISOString();
  }
  return null;
}

function parseWindowPercent(window: Record<string, unknown>): number {
  const used = toNumber(window["used"] ?? window["used_amount"], 0);
  const limit = toNumber(window["limit"] ?? window["limit_amount"], 0);
  if (limit <= 0) return 0;
  return Math.max(0, Math.min(1, used / limit));
}

// ─── Response Parser ──────────────────────────────────────────────────────────

/**
 * Parse a single OpenCode usage window: `{ status, resetInSec, usagePercent }`
 * (usagePercent 0-100 of the micro-cents limit, resetInSec = seconds until
 * reset). Returns null when the window is structurally absent.
 */
function parseUsageWindow(
  window: unknown
): { percentUsed: number; resetAt: string | null } | null {
  const w = toRecord(window);
  const usagePercent = toNumber(w.usagePercent, NaN);
  if (!Number.isFinite(usagePercent)) return null;
  const percentUsed = Math.max(0, Math.min(1, usagePercent / 100));
  const resetInSec = toNumber(w.resetInSec, 0);
  const resetAt = resetInSec > 0 ? new Date(Date.now() + resetInSec * 1000).toISOString() : null;
  return { percentUsed, resetAt };
}

function buildTripleWindowQuota(
  window5h: { percentUsed: number; resetAt: string | null } | null,
  windowWeekly: { percentUsed: number; resetAt: string | null } | null,
  windowMonthly: { percentUsed: number; resetAt: string | null } | null,
  extraLimitReached: boolean
): OpencodeTripleWindowQuota | null {
  const has5h = window5h !== null;
  const hasWeekly = windowWeekly !== null;
  const hasMonthly = windowMonthly !== null;
  if (!has5h && !hasWeekly && !hasMonthly) return null;

  const percent5h = window5h?.percentUsed ?? 0;
  const percentWeekly = windowWeekly?.percentUsed ?? 0;
  const percentMonthly = windowMonthly?.percentUsed ?? 0;
  const worstPercent = Math.max(percent5h, percentWeekly, percentMonthly);

  // Dominant reset: pick the window with the worst usage
  let dominantResetAt: string | null = null;
  if (worstPercent === percent5h) {
    dominantResetAt = window5h?.resetAt ?? windowWeekly?.resetAt ?? windowMonthly?.resetAt ?? null;
  } else if (worstPercent === percentWeekly) {
    dominantResetAt = windowWeekly?.resetAt ?? window5h?.resetAt ?? windowMonthly?.resetAt ?? null;
  } else {
    dominantResetAt = windowMonthly?.resetAt ?? windowWeekly?.resetAt ?? window5h?.resetAt ?? null;
  }

  const windows: Record<string, { percentUsed: number; resetAt: string | null }> = {};
  if (has5h) windows[OPENCODE_WINDOW_5H] = window5h!;
  if (hasWeekly) windows[OPENCODE_WINDOW_WEEKLY] = windowWeekly!;
  if (hasMonthly) windows[OPENCODE_WINDOW_MONTHLY] = windowMonthly!;

  return {
    used: worstPercent * 100,
    total: 100,
    percentUsed: worstPercent,
    resetAt: dominantResetAt,
    windows,
    window5h: window5h ?? { percentUsed: 0, resetAt: null },
    windowWeekly: windowWeekly ?? { percentUsed: 0, resetAt: null },
    windowMonthly: windowMonthly ?? { percentUsed: 0, resetAt: null },
    limitReached: extraLimitReached || worstPercent >= 1,
  };
}

function parseOpencodeQuotaResponse(data: unknown): OpencodeTripleWindowQuota | null {
  const obj = toRecord(data);

  // ── Primary: the live /zen/go/v1/usage shape (anomalyco/opencode#16513) ──
  const primary = buildTripleWindowQuota(
    parseUsageWindow(obj.rollingUsage),
    parseUsageWindow(obj.weeklyUsage),
    parseUsageWindow(obj.monthlyUsage),
    false
  );
  if (primary) return primary;

  // ── Fallback: legacy guessed `{ quota: { window_5h: { used, limit, reset_at } } }` shape ──
  const quotaObj = toRecord(obj["quota"] ?? obj["data"] ?? obj["usage"]);
  const w5h = toRecord(
    quotaObj[OPENCODE_WINDOW_5H] ?? quotaObj["5h"] ?? quotaObj["hourly"] ?? quotaObj["short"]
  );
  const wWeekly = toRecord(
    quotaObj[OPENCODE_WINDOW_WEEKLY] ?? quotaObj["weekly"] ?? quotaObj["week"] ?? quotaObj["wk"]
  );
  const wMonthly = toRecord(
    quotaObj[OPENCODE_WINDOW_MONTHLY] ?? quotaObj["monthly"] ?? quotaObj["month"] ?? quotaObj["mo"]
  );
  const legacyLimitReached = Boolean(obj["limit_reached"] ?? quotaObj["limit_reached"]);
  return buildTripleWindowQuota(
    Object.keys(w5h).length > 0
      ? { percentUsed: parseWindowPercent(w5h), resetAt: parseWindowResetAt(w5h) }
      : null,
    Object.keys(wWeekly).length > 0
      ? { percentUsed: parseWindowPercent(wWeekly), resetAt: parseWindowResetAt(wWeekly) }
      : null,
    Object.keys(wMonthly).length > 0
      ? { percentUsed: parseWindowPercent(wMonthly), resetAt: parseWindowResetAt(wMonthly) }
      : null,
    legacyLimitReached
  );
}

// ─── Core Fetcher ─────────────────────────────────────────────────────────────

/**
 * Fall back to the local-estimate quota (seeded OpenCode Go/Zen limits minus
 * locally recorded usage) when the upstream /zen/go/v1/usage endpoint is
 * unavailable (404 / 5xx / parse failure / network error). Auth failures
 * (401/403) and missing credentials do NOT fall back — they return null so a
 * broken connection is not masked by an estimate.
 */
async function estimateFallback(
  connectionId: string,
  connection?: Record<string, unknown>
): Promise<OpencodeTripleWindowQuota | null> {
  try {
    const provider = String(connection?.provider ?? "opencode-go").toLowerCase();
    const estimate = await fetchLocalEstimateQuota(provider, connectionId, connection);
    if (!estimate) return null;
    const w = estimate.windows ?? {};
    return {
      ...estimate,
      window5h: w["window_5h"] ?? { percentUsed: 0, resetAt: null },
      windowWeekly: w["weekly"] ?? w["window_weekly"] ?? { percentUsed: 0, resetAt: null },
      windowMonthly: w["monthly"] ?? w["window_monthly"] ?? { percentUsed: 0, resetAt: null },
    };
  } catch {
    return null;
  }
}

/**
 * Fetch current quota for an OpenCode connection.
 * Returns percentUsed = max(5h%, weekly%, monthly%) — worst-case across all windows.
 *
 * Falls back to the local estimate when the upstream endpoint is unavailable
 * (404/5xx/parse/network); returns null only for missing credentials or 401/403.
 * See module-level JSDoc for upstream API status.
 *
 * @param connectionId - Connection ID from the DB (used for cache keying)
 * @param connection - Optional connection snapshot with apiKey
 * @returns OpencodeTripleWindowQuota or null if auth fails / no credentials
 */
export async function fetchOpencodeQuota(
  connectionId: string,
  connection?: Record<string, unknown>
): Promise<OpencodeTripleWindowQuota | null> {
  // Check cache first
  const cached = quotaCache.get(connectionId);
  if (cached) {
    // 404 sentinel — use longer TTL to avoid hammering a non-deployed endpoint;
    // serve the local estimate while the sentinel is warm.
    if (cached.noEndpoint && Date.now() - cached.fetchedAt < NO_ENDPOINT_TTL_MS) {
      return estimateFallback(connectionId, connection);
    }
    if (cached.quota !== null && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      return cached.quota;
    }
  }

  // Extract API key from connection
  const apiKey =
    typeof connection?.apiKey === "string" && connection.apiKey.trim().length > 0
      ? connection.apiKey
      : null;

  if (!apiKey) {
    return null;
  }

  try {
    // #6911: space concurrent upstream quota fetches (mirrors codexQuotaFetcher.ts).
    await throttleQuotaFetch();
    const response = await fetch(OPENCODE_QUOTA_URL, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(8_000),
    });

    if (!response.ok) {
      if (response.status === 404) {
        // The endpoint shipped upstream (anomalyco/opencode#16513, merged 2026-08-11);
        // a 404 now usually means the deployed opencode.ai server hasn't rolled it out
        // yet. Warn once per URL per process, cache a 404 sentinel for
        // NO_ENDPOINT_TTL_MS to avoid hammering.
        if (!_warned404Urls.has(OPENCODE_QUOTA_URL)) {
          _warned404Urls.add(OPENCODE_QUOTA_URL);
          console.warn(
            `[opencodeQuotaFetcher] ${OPENCODE_QUOTA_URL} returned 404 — the opencode-go usage endpoint shipped in anomalyco/opencode#16513 may not be deployed yet. ` +
              `Set OMNIROUTE_OPENCODE_QUOTA_URL to a working endpoint if yours differs.`
          );
        }
        quotaCache.set(connectionId, {
          quota: null,
          fetchedAt: Date.now(),
          noEndpoint: true,
        });
        return estimateFallback(connectionId, connection);
      }
      if (response.status === 401 || response.status === 403) {
        quotaCache.delete(connectionId);
        return null; // auth problem — don't mask a broken connection with an estimate
      }
      return estimateFallback(connectionId, connection);
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      // Malformed JSON — fall back to the local estimate
      return estimateFallback(connectionId, connection);
    }

    const quota = parseOpencodeQuotaResponse(data);
    if (!quota) return estimateFallback(connectionId, connection);

    // Store in cache
    quotaCache.set(connectionId, { quota, fetchedAt: Date.now() });
    return quota;
  } catch {
    // Network error, timeout, etc. — fall back to the local estimate
    return estimateFallback(connectionId, connection);
  }
}

// ─── Invalidation ─────────────────────────────────────────────────────────────

/**
 * Force-invalidate the cache for a connection (e.g., after receiving quota headers).
 */
export function invalidateOpencodeQuotaCache(connectionId: string): void {
  quotaCache.delete(connectionId);
}

// ─── Registration ─────────────────────────────────────────────────────────────

/**
 * Register the OpenCode quota fetcher with the preflight and monitor systems
 * for all three provider variants: opencode-go, opencode, opencode-zen.
 *
 * Call this once at server startup (in chat.ts, before registerGenericQuotaFetchers).
 */
export function registerOpencodeQuotaFetcher(): void {
  for (const provider of ["opencode-go", "opencode", "opencode-zen"] as const) {
    registerQuotaFetcher(provider, fetchOpencodeQuota);
    registerMonitorFetcher(provider, fetchOpencodeQuota);
    registerQuotaWindows(provider, [
      OPENCODE_WINDOW_5H,
      OPENCODE_WINDOW_WEEKLY,
      OPENCODE_WINDOW_MONTHLY,
    ]);
  }
}
