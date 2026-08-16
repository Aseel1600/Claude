import {
  OPENCODE_GO_PRICING_REVISION,
  OPENCODE_GO_WINDOW_LIMITS_USD,
  calculateOpenCodeGoCost,
} from "@omniroute/open-sse/services/openCodeGoPricing.ts";

import { getDbInstance } from "@/lib/db/core";
import { toNumber } from "@/shared/utils/numeric";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

type WindowName = "session" | "weekly" | "monthly";

type UsageRow = {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  timestamp: string;
};

type WindowQuota = {
  used: number;
  total: number;
  remaining: number;
  remainingPercentage: number;
  resetAt: string | null;
  unlimited: false;
  displayName: string;
  currency: "USD";
  quotaSource: "localUsageHistory";
  details?: Array<{ name: string; used: number }>;
};

type WindowTimeInput = string | number | Date;

export type OpenCodeGoLocalUsageOptions = {
  connectionId: string;
  now?: number;
  windowStarts?: Partial<Record<WindowName, WindowTimeInput>>;
  windowResets?: Partial<Record<WindowName, string | null>>;
};

export type OpenCodeGoLocalUsage = {
  pricingRevision: string;
  quotas: Record<WindowName, WindowQuota>;
  modelMonthly: Array<{
    model: string;
    used: number;
    total: number;
    remaining: number;
    remainingPercentage: number;
    effectiveRemainingUsd: number;
  }>;
  requestsPriced: number;
  unknownModels: string[];
};

function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function toTimestamp(value: WindowTimeInput | undefined, fallback: number): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function buildQuota(
  name: WindowName,
  usedValue: number,
  resetAt: string | null | undefined,
  details?: Array<{ name: string; used: number }>
): WindowQuota {
  const total = OPENCODE_GO_WINDOW_LIMITS_USD[name];
  const used = roundUsd(Math.max(0, usedValue));
  const remaining = roundUsd(Math.max(0, total - used));
  return {
    used,
    total,
    remaining,
    remainingPercentage: Math.max(0, Math.min(100, (remaining / total) * 100)),
    resetAt: resetAt || null,
    unlimited: false,
    displayName:
      name === "session" ? "5-hour rolling" : name === "weekly" ? "Weekly" : "Monthly",
    currency: "USD",
    quotaSource: "localUsageHistory",
    ...(details?.length ? { details } : {}),
  };
}

function fetchUsageRows(connectionId: string, sinceIso: string, nowIso: string): UsageRow[] {
  if (!connectionId) return [];
  return getDbInstance()
    .prepare(
      `
      SELECT
        LOWER(model) as model,
        COALESCE(tokens_input, 0) as inputTokens,
        COALESCE(tokens_output, 0) as outputTokens,
        COALESCE(tokens_cache_read, 0) as cacheReadTokens,
        COALESCE(tokens_cache_creation, 0) as cacheCreationTokens,
        timestamp
      FROM usage_history
      WHERE LOWER(provider) = 'opencode-go'
        AND connection_id = @connectionId
        AND timestamp >= @sinceIso
        AND timestamp <= @nowIso
        AND COALESCE(success, 1) = 1
      ORDER BY timestamp ASC, id ASC
      `
    )
    .all({ connectionId, sinceIso, nowIso }) as UsageRow[];
}

export function getOpenCodeGoLocalUsage(
  options: OpenCodeGoLocalUsageOptions
): OpenCodeGoLocalUsage {
  const now = Number.isFinite(options.now) ? Number(options.now) : Date.now();
  const sessionStart = toTimestamp(options.windowStarts?.session, now - 5 * HOUR_MS);
  const weeklyStart = toTimestamp(options.windowStarts?.weekly, now - 7 * DAY_MS);
  const monthlyStart = toTimestamp(options.windowStarts?.monthly, now - 30 * DAY_MS);
  const earliestStart = Math.min(sessionStart, weeklyStart, monthlyStart);
  const rows = fetchUsageRows(
    options.connectionId,
    new Date(earliestStart).toISOString(),
    new Date(now).toISOString()
  );

  const windowCosts: Record<WindowName, number> = { session: 0, weekly: 0, monthly: 0 };
  const modelCosts = new Map<string, { used: number; total: number }>();
  const unknownModels = new Set<string>();
  let requestsPriced = 0;

  for (const row of rows) {
    const timestamp = Date.parse(row.timestamp);
    const priced = calculateOpenCodeGoCost({
      model: row.model,
      inputTokens: toNumber(row.inputTokens),
      outputTokens: toNumber(row.outputTokens),
      cacheReadTokens: toNumber(row.cacheReadTokens),
      cacheCreationTokens: toNumber(row.cacheCreationTokens),
      timestamp: row.timestamp,
    });
    if (!priced) {
      unknownModels.add(row.model);
      continue;
    }

    requestsPriced += 1;
    if (timestamp >= sessionStart) windowCosts.session += priced.costUsd;
    if (timestamp >= weeklyStart) windowCosts.weekly += priced.costUsd;
    if (timestamp >= monthlyStart) {
      windowCosts.monthly += priced.costUsd;
      const model = modelCosts.get(priced.model) ?? {
        used: 0,
        total: priced.pricing.monthlyUsageLimitUsd,
      };
      model.used += priced.costUsd;
      modelCosts.set(priced.model, model);
    }
  }

  const monthlyDetails = [...modelCosts.entries()]
    .map(([name, value]) => ({ name, used: roundUsd(value.used) }))
    .sort((left, right) => right.used - left.used || left.name.localeCompare(right.name));
  const quotas = {
    session: buildQuota(
      "session",
      windowCosts.session,
      options.windowResets?.session
    ),
    weekly: buildQuota("weekly", windowCosts.weekly, options.windowResets?.weekly),
    monthly: buildQuota(
      "monthly",
      windowCosts.monthly,
      options.windowResets?.monthly,
      monthlyDetails
    ),
  };
  const sharedRemaining = Math.min(
    quotas.session.remaining,
    quotas.weekly.remaining,
    quotas.monthly.remaining
  );
  const modelMonthly = [...modelCosts.entries()]
    .map(([model, value]) => {
      const used = roundUsd(value.used);
      const remaining = roundUsd(Math.max(0, value.total - used));
      return {
        model,
        used,
        total: value.total,
        remaining,
        remainingPercentage: Math.max(0, Math.min(100, (remaining / value.total) * 100)),
        effectiveRemainingUsd: roundUsd(Math.min(sharedRemaining, remaining)),
      };
    })
    .sort((left, right) => right.used - left.used || left.model.localeCompare(right.model));

  return {
    pricingRevision: OPENCODE_GO_PRICING_REVISION,
    quotas,
    modelMonthly,
    requestsPriced,
    unknownModels: [...unknownModels].sort(),
  };
}
