/**
 * localEstimateQuotaFetcher.ts — Generic quota fetcher for providers without a
 * public usage/quota endpoint.
 *
 * OmniRoute's `reset-window` / `reset-aware` combo strategies rank targets by
 * quota reset proximity (daily ≤24h → weekly ≤7d → monthly ≤30d → paid/unknown
 * last). They only work for providers with a registered `QuotaFetcher`. Many
 * providers (Cerebras, Cloudflare AI, Gemini API, Mistral, NVIDIA NIM, …) expose
 * no public usage endpoint, so this module estimates remaining quota from:
 *
 *   1. the operator's `provider_plans` dimensions for the connection (source of
 *      truth when set — `unit: requests|tokens`, `window: daily|weekly|monthly`);
 *   2. otherwise a SEEDED table of known free-tier limits (grounded in
 *      `open-sse/config/freeModelCatalog.data.ts` + operator-verified numbers);
 *   3. usage actually recorded locally in `usage_history` since the window start.
 *
 * The estimate is intentionally fail-open: a provider with no plan and no seed
 * limit reports no windows (0% used) rather than a wrong number, so routing
 * never breaks — it just doesn't rank that provider by quota.
 *
 * Registration: `registerLocalEstimateQuotaFetchers()` (once at server startup,
 * AFTER the bespoke fetchers so they keep precedence) registers the gaps;
 * `registerHybridQuotaFetcher()` composes a bespoke upstream probe with the
 * local estimate as its fallback (probe first, estimate on null/error).
 */

import {
  getQuotaFetcher,
  registerQuotaFetcher,
  registerQuotaWindows,
  type QuotaFetcher,
  type QuotaInfo,
} from "./quotaPreflight.ts";

// ─── Window / unit kinds (subset of providerPlans QuotaDimension) ─────────────
export type EstimateWindowKind = "daily" | "weekly" | "monthly";
export type EstimateUnitKind = "requests" | "tokens";

export interface EstimateLimit {
  window: EstimateWindowKind;
  unit: EstimateUnitKind;
  limit: number;
}

const WINDOW_KEYS: readonly EstimateWindowKind[] = ["daily", "weekly", "monthly"];

/**
 * Seeded known free-tier limits per provider, grounded in the free model catalog
 * (`freeModelCatalog.data.ts` freeType/monthlyTokens) + operator-verified daily
 * caps. Overridable per connection via `provider_plans`. Providers with no seed
 * (metered / credit / uncapped) report no windows unless the operator sets a plan.
 */
export const SEEDED_ESTIMATE_LIMITS: Record<string, EstimateLimit[]> = {
  cerebras: [{ window: "daily", unit: "tokens", limit: 1_000_000 }], // free tier ~30M tok/mo pool → ~1M/day
  "cloudflare-ai": [{ window: "daily", unit: "tokens", limit: 10_000 }], // Workers AI free ~10k neurons/day
  gemini: [{ window: "daily", unit: "requests", limit: 1_000 }], // AI Studio free-tier RPD (flash-class)
  mistral: [{ window: "monthly", unit: "tokens", limit: 1_000_000_000 }], // 1B tok/mo free tier
  nvidia: [], // NIM free = 40 req/s, unlimited rpd → uncapped, never exhausts
  "nous-research": [], // credit-based → plan override only
  byteplus: [], // metered → plan override only
  // OpenCode Zen free tier (200 req/day) and OpenCode Go weekly/monthly caps.
  // Go's true caps are USD ($30/wk, $60/mo) but there's no catalog pricing for
  // Go models, so the fallback seeds request-count windows from the official Go
  // usage table (Kimi K3: 250 req/wk, 490 req/mo — the operator's primary Go
  // model). These give reset-window the right RANKING (weekly tier) while the
  // live /zen/go/v1/usage endpoint supplies real percentages once deployed.
  opencode: [{ window: "daily", unit: "requests", limit: 200 }],
  "opencode-zen": [{ window: "daily", unit: "requests", limit: 200 }],
  "opencode-go": [
    { window: "weekly", unit: "requests", limit: 250 },
    { window: "monthly", unit: "requests", limit: 490 },
  ],
};

// ─── Fixed window boundaries (UTC) ────────────────────────────────────────────

function utcDayStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function utcNextDayStart(now: Date): Date {
  return new Date(utcDayStart(now).getTime() + 24 * 60 * 60 * 1000);
}

function utcWeekStart(now: Date): Date {
  const day = utcDayStart(now);
  // Monday as the week boundary (ISO-8601), same convention as the 7d windows.
  const dow = (day.getUTCDay() + 6) % 7;
  return new Date(day.getTime() - dow * 24 * 60 * 60 * 1000);
}

function utcNextWeekStart(now: Date): Date {
  return new Date(utcWeekStart(now).getTime() + 7 * 24 * 60 * 60 * 1000);
}

function utcMonthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function utcNextMonthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

export function getWindowBounds(
  windowKind: EstimateWindowKind,
  now: Date = new Date()
): { startIso: string; resetIso: string } {
  switch (windowKind) {
    case "daily":
      return {
        startIso: utcDayStart(now).toISOString(),
        resetIso: utcNextDayStart(now).toISOString(),
      };
    case "weekly":
      return {
        startIso: utcWeekStart(now).toISOString(),
        resetIso: utcNextWeekStart(now).toISOString(),
      };
    case "monthly":
      return {
        startIso: utcMonthStart(now).toISOString(),
        resetIso: utcNextMonthStart(now).toISOString(),
      };
  }
}

// ─── Locally recorded usage ───────────────────────────────────────────────────

interface UsageHistoryRow {
  t?: number;
  n?: number;
}

/** Sum locally-recorded usage for (provider, connectionId) since `sinceIso`. */
export async function getLocalUsage(
  provider: string,
  connectionId: string | null | undefined,
  sinceIso: string,
  unit: EstimateUnitKind
): Promise<number> {
  if (!connectionId) return 0;
  try {
    const { getDbInstance } = await import("../../src/lib/db/core");
    const db = getDbInstance();
    if (unit === "requests") {
      const row = db
        .prepare(
          `SELECT COUNT(*) AS n FROM usage_history
           WHERE provider = ? AND connection_id = ? AND timestamp >= ?`
        )
        .get(provider, connectionId, sinceIso) as UsageHistoryRow | undefined;
      return Number(row?.n ?? 0);
    }
    const row = db
      .prepare(
        `SELECT COALESCE(SUM(tokens_input + tokens_output + tokens_cache_read + tokens_cache_creation + tokens_reasoning), 0) AS t
         FROM usage_history
         WHERE provider = ? AND connection_id = ? AND timestamp >= ?`
      )
      .get(provider, connectionId, sinceIso) as UsageHistoryRow | undefined;
    return Number(row?.t ?? 0);
  } catch {
    // No DB / no usage_history — fail open to 0% used.
    return 0;
  }
}

// ─── provider_plans override ──────────────────────────────────────────────────

interface PlanDimension {
  unit: string;
  window: string;
  limit: number;
}

/**
 * Read the operator-set plan dimensions for a connection, mapped to the
 * locally-estimable windows (requests/tokens × daily/weekly/monthly). Percent/USD
 * dimensions can't be estimated from local token counts — they are skipped.
 */
export async function getPlanEstimateLimits(
  connectionId: string | null | undefined
): Promise<EstimateLimit[] | null> {
  if (!connectionId) return null;
  try {
    const { getPlan } = await import("../../src/lib/db/providerPlans");
    const plan = getPlan(connectionId);
    if (!plan || !Array.isArray(plan.dimensions) || plan.dimensions.length === 0) return null;

    const limits: EstimateLimit[] = [];
    for (const dim of plan.dimensions as PlanDimension[]) {
      const unit = dim.unit === "tokens" ? "tokens" : dim.unit === "requests" ? "requests" : null;
      const window = WINDOW_KEYS.includes(dim.window as EstimateWindowKind)
        ? (dim.window as EstimateWindowKind)
        : null;
      const limit = Number(dim.limit);
      if (!unit || !window || !Number.isFinite(limit) || limit <= 0) continue;
      limits.push({ window, unit, limit });
    }
    return limits.length > 0 ? limits : null;
  } catch {
    return null;
  }
}

// ─── Core fetcher ─────────────────────────────────────────────────────────────

export interface LocalEstimateQuota extends QuotaInfo {
  windows: Record<string, { percentUsed: number; resetAt: string | null }>;
  limitReached: boolean;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Build the QuotaInfo estimate for a provider connection.
 * Exported (pure-ish, DB-backed) for unit testing.
 */
export async function fetchLocalEstimateQuota(
  provider: string,
  connectionId: string,
  connection?: Record<string, unknown>
): Promise<LocalEstimateQuota | null> {
  const limits = (await getPlanEstimateLimits(connectionId)) ?? SEEDED_ESTIMATE_LIMITS[provider] ?? [];
  if (limits.length === 0) return null; // uncapped / no data — fail open

  const now = new Date();
  const windows: Record<string, { percentUsed: number; resetAt: string | null }> = {};
  let worstPercent = 0;
  let worstResetAt: string | null = null;
  let worstUsed = 0;
  let worstTotal = 0;

  for (const { window, unit, limit } of limits) {
    const { startIso, resetIso } = getWindowBounds(window, now);
    const used = await getLocalUsage(provider, connectionId, startIso, unit);
    const percentUsed = clamp01(used / limit);
    windows[window] = { percentUsed, resetAt: resetIso };
    if (percentUsed > worstPercent) {
      worstPercent = percentUsed;
      worstResetAt = resetIso;
      worstUsed = used;
      worstTotal = limit;
    }
  }

  return {
    used: worstUsed,
    total: worstTotal,
    percentUsed: worstPercent,
    resetAt: worstResetAt,
    windows,
    limitReached: worstPercent >= 1,
  };
}

function makeFetcher(provider: string): QuotaFetcher {
  return async (connectionId: string, connection?: Record<string, unknown>) => {
    const quota = await fetchLocalEstimateQuota(provider, connectionId, connection);
    if (quota) registerQuotaWindows(provider, Object.keys(quota.windows || {}));
    return quota;
  };
}

// ─── Registration ─────────────────────────────────────────────────────────────

/** The 9 pool providers that had no quota/usage fetcher (2026-08-15). */
export const LOCAL_ESTIMATE_GAP_PROVIDERS = [
  "cerebras",
  "cloudflare-ai",
  "gemini",
  "mistral",
  "nvidia",
  "nous-research",
  "byteplus",
] as const;

/**
 * Register the local-estimate fetcher for every provider in `providerIds` that
 * does not already have a fetcher (so bespoke fetchers keep precedence).
 * Idempotent. Call once at server startup, AFTER bespoke registrations.
 */
export function registerLocalEstimateQuotaFetchers(
  providerIds: readonly string[] = LOCAL_ESTIMATE_GAP_PROVIDERS
): void {
  for (const provider of providerIds) {
    if (getQuotaFetcher(provider)) continue; // bespoke fetcher already registered — leave it alone
    registerQuotaFetcher(provider, makeFetcher(provider));
  }
}

/**
 * Register a HYBRID fetcher for a provider: try the upstream probe first, fall
 * back to the local estimate when it returns null / throws. Used by bespoke
 * endpoint fetchers (Cloudflare AI, BytePlus) that are best-effort.
 */
export function registerHybridQuotaFetcher(
  provider: string,
  upstreamProbe: QuotaFetcher
): void {
  const estimateFetcher = makeFetcher(provider);
  registerQuotaFetcher(provider, async (connectionId, connection) => {
    try {
      const upstream = await upstreamProbe(connectionId, connection);
      if (upstream) return upstream;
    } catch {
      // probe failed — fall through to the local estimate
    }
    return estimateFetcher(connectionId, connection);
  });
}
