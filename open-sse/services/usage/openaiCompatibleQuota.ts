import {
  getCustomQuotaProviderKind,
  type CustomQuotaProviderKind,
} from "@/shared/utils/customQuotaProviders";
import { toNumberOrNull } from "@/shared/utils/numeric";
import { createQuotaFromUsage, parseResetTime, type UsageQuota } from "./quota.ts";

type JsonRecord = Record<string, unknown>;

const REQUEST_TIMEOUT_MS = 8_000;

function toRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function normalizeKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function buildQuotaUrlCandidates(baseUrl: string): string[] {
  const trimmed = baseUrl.replace(/\/+$/, "");
  const candidates = new Set<string>();

  try {
    const rootUrl = new URL("/quota", trimmed);
    candidates.add(rootUrl.toString());
  } catch {
    // ignore malformed root candidate
  }

  candidates.add(`${trimmed}/quota`);

  return [...candidates];
}

function buildProviderQuotaUrlCandidates(kind: CustomQuotaProviderKind, baseUrl: string): string[] {
  if (kind === "theclawbay") {
    return ["https://theclawbay.com/api/codex-auth/v1/quota"];
  }
  return buildQuotaUrlCandidates(baseUrl);
}

function quotaFromPercent(percentUsed: number | null, resetValue: unknown): UsageQuota | null {
  if (percentUsed === null) return null;
  const clampedUsed = Math.max(0, Math.min(100, percentUsed));
  return {
    used: clampedUsed,
    total: 100,
    remaining: Math.max(0, 100 - clampedUsed),
    remainingPercentage: Math.max(0, 100 - clampedUsed),
    resetAt: parseResetTime(resetValue),
    unlimited: false,
  };
}

function extractPercentUsed(value: JsonRecord): number | null {
  const directUsed = [
    value.percentUsed,
    value.percent_used,
    value.usedPercent,
    value.used_percent,
    value.usagePercent,
    value.usage_percent,
  ];
  for (const candidate of directUsed) {
    const numeric = toNumberOrNull(candidate);
    if (numeric !== null) return numeric;
  }

  const remainingCandidates = [
    value.remainingPercentage,
    value.remaining_percentage,
    value.remainingPercent,
    value.remaining_percent,
  ];
  for (const candidate of remainingCandidates) {
    const numeric = toNumberOrNull(candidate);
    if (numeric !== null) return Math.max(0, 100 - numeric);
  }

  return null;
}

function extractQuotaWindow(
  name: string,
  value: unknown
): { name: string; quota: UsageQuota } | null {
  const record = toRecord(value);
  const percentUsed = extractPercentUsed(record);
  const resetValue =
    record.resetAt ??
    record.reset_at ??
    record.resetAfter ??
    record.reset_after ??
    record.retryAfter ??
    record.retry_after;

  if (percentUsed !== null) {
    const quota = quotaFromPercent(percentUsed, resetValue);
    return quota ? { name, quota } : null;
  }

  const used = toNumberOrNull(record.used ?? record.spent ?? record.current ?? record.consumed);
  const total = toNumberOrNull(record.total ?? record.limit ?? record.max ?? record.cap);
  if (used !== null && total !== null && total > 0) {
    return { name, quota: createQuotaFromUsage(used, total, resetValue) };
  }

  return null;
}

function findWindowCandidates(source: JsonRecord): Array<{ key: string; value: unknown }> {
  const entries: Array<{ key: string; value: unknown }> = [];
  const stack: JsonRecord[] = [source];
  const seen = new Set<JsonRecord>();

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || seen.has(current)) continue;
    seen.add(current);

    for (const [key, value] of Object.entries(current)) {
      entries.push({ key, value });
      const nested = toRecord(value);
      if (Object.keys(nested).length > 0) stack.push(nested);
    }
  }

  return entries;
}

function parseQuotaWindows(payload: unknown): Record<string, UsageQuota> {
  const root = toRecord(payload);
  const candidates = findWindowCandidates(root);
  const quotas: Record<string, UsageQuota> = {};

  for (const candidate of candidates) {
    const key = normalizeKey(candidate.key);
    if (!key) continue;

    if (
      !quotas["session (5h)"] &&
      (key === "5h" || key.includes("5h") || key.includes("5 hour") || key === "session")
    ) {
      const parsed = extractQuotaWindow("session (5h)", candidate.value);
      if (parsed) quotas[parsed.name] = parsed.quota;
      continue;
    }

    if (
      !quotas["weekly (7d)"] &&
      (key === "weekly" || key.includes("week") || key.includes("7d") || key.includes("7 day"))
    ) {
      const parsed = extractQuotaWindow("weekly (7d)", candidate.value);
      if (parsed) quotas[parsed.name] = parsed.quota;
      continue;
    }
  }

  return quotas;
}

function parseTheClawBayQuota(payload: unknown): Record<string, UsageQuota> {
  const root = toRecord(payload);
  const usage = toRecord(root.usage);
  const quotas: Record<string, UsageQuota> = {};

  const fiveHour = toRecord(usage.fiveHour);
  const weekly = toRecord(usage.weekly);

  const fiveHourPercentRemaining = toNumberOrNull(
    fiveHour.percentRemaining ?? fiveHour.percent_remaining
  );
  const fiveHourPercentUsed = toNumberOrNull(fiveHour.percentUsed ?? fiveHour.percent_used);
  const weeklyPercentRemaining = toNumberOrNull(
    weekly.percentRemaining ?? weekly.percent_remaining
  );
  const weeklyPercentUsed = toNumberOrNull(weekly.percentUsed ?? weekly.percent_used);

  const buildPercentQuota = (
    percentRemaining: number | null,
    percentUsed: number | null,
    resetAt: unknown
  ): UsageQuota | null => {
    const remaining =
      percentRemaining ?? (percentUsed !== null ? Math.max(0, 100 - percentUsed) : null);
    if (remaining === null) return null;
    const used = Math.max(0, 100 - remaining);
    return {
      used,
      total: 100,
      remaining: remaining,
      remainingPercentage: remaining,
      resetAt: parseResetTime(resetAt),
      unlimited: false,
      fractionReported: true,
    };
  };

  const fiveHourQuota = buildPercentQuota(
    fiveHourPercentRemaining,
    fiveHourPercentUsed,
    fiveHour.windowEnd ?? fiveHour.window_end
  );
  if (fiveHourQuota) quotas["5 Hours Quota"] = fiveHourQuota;

  const weeklyQuota = buildPercentQuota(
    weeklyPercentRemaining,
    weeklyPercentUsed,
    weekly.windowEnd ?? weekly.window_end
  );
  if (weeklyQuota) quotas["Weekly Quota"] = weeklyQuota;

  return quotas;
}

function buildErrorMessage(kind: CustomQuotaProviderKind, response: Response): string {
  const code = response.headers.get("x-theclawbay-error-code");
  const retryable = response.headers.get("x-theclawbay-retryable");
  const provider = kind === "theclawbay" ? "The Claw Bay" : "Verboo";
  const parts = [`${provider} quota request failed (${response.status})`];
  if (code) parts.push(code);
  if (retryable) parts.push(`retryable=${retryable}`);
  return parts.join(" - ");
}

export async function getOpenAiCompatibleQuotaUsage(
  providerId: unknown,
  apiKey: string | null | undefined,
  providerSpecificData: unknown
): Promise<JsonRecord | null> {
  const kind = getCustomQuotaProviderKind(providerId, providerSpecificData);
  const psd = toRecord(providerSpecificData);
  const baseUrl = typeof psd.baseUrl === "string" ? psd.baseUrl.trim() : "";

  if (!kind || !apiKey || !baseUrl) return null;

  let lastMessage: string | null = null;

  for (const url of buildProviderQuotaUrlCandidates(kind, baseUrl)) {
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) {
        lastMessage = buildErrorMessage(kind, response);
        continue;
      }

      const payload = await response.json();
      const quotas =
        kind === "theclawbay" ? parseTheClawBayQuota(payload) : parseQuotaWindows(payload);
      if (Object.keys(quotas).length === 0) {
        lastMessage = `${kind === "theclawbay" ? "The Claw Bay" : "Verboo"} quota payload missing supported windows`;
        continue;
      }

      return {
        quotas,
        plan: kind === "theclawbay" ? "Enterprise" : "Verboo",
      };
    } catch (error) {
      lastMessage = error instanceof Error ? error.message : String(error);
    }
  }

  return lastMessage ? { message: lastMessage } : null;
}
