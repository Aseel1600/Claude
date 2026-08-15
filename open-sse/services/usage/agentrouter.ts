/**
 * usage/agentrouter.ts — AgentRouter (New-API) balance quota shapes the Provider
 * Limits dashboard expects.
 *
 * Reuses the already-registered preflight/monitor fetcher (OpenAI-style routing
 * apiKey vs console System Access Token + New-Api-User id) instead of re-implementing
 * the HTTP call, so the 60s in-memory cache in agentrouterQuotaFetcher.ts is shared.
 *
 * AgentRouter exposes a raw New-API credit balance, not a real grant to divide by —
 * so, following the DeepSeek boolean-availability precedent, the percent is only a
 * two-state signal (0 = has balance, 100 = exhausted) and the human-meaningful number
 * is the dollar balance (rawQuota / QUOTA_PER_UNIT).
 */
import { fetchAgentrouterQuota, type AgentrouterQuota } from "../agentrouterQuotaFetcher.ts";
import { type UsageQuota } from "./quota.ts";

type JsonRecord = Record<string, unknown>;

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));
}

/**
 * AgentRouter balance → dashboard usage shape.
 *
 * Returns `{ message }` when the fetch returns null (no console credentials, an
 * upstream error, or a rejected token), which the Provider Limits UI renders as a
 * graceful per-row status instead of crashing the whole page. Otherwise shapes the
 * balance into a single USD `quotas.balance` entry.
 */
export async function getAgentrouterUsage(
  connectionId: string | undefined,
  connection: JsonRecord
) {
  const quota = (await fetchAgentrouterQuota(
    connectionId || "",
    connection
  )) as AgentrouterQuota | null;

  if (!quota) {
    return {
      message:
        "AgentRouter balance not available. Add the Console API Key + New-API User ID to the connection to view usage.",
    };
  }

  const percentUsed = clamp01(quota.percentUsed);
  const remaining = Math.round((1 - percentUsed) * 1000) / 10;

  const balance: UsageQuota = {
    used: Math.round(percentUsed * 100),
    total: 100,
    remaining,
    remainingPercentage: remaining,
    resetAt: quota.resetAt ?? null,
    unlimited: false,
    currency: "USD",
    displayName: "Wallet Balance (USD)",
  };

  return {
    plan: "AgentRouter",
    quotas: { balance },
    remainingUsd: quota.dollarBalance,
    availableUsd: quota.dollarBalance,
    balance: quota.dollarBalance,
  };
}