/**
 * Provider-specific error rules.
 *
 * Different providers expose different quota signals:
 *   - Opencode: account-wide quota. A 429 with `x-ratelimit-remaining-requests: 0`
 *     means the whole organization is out — we must lock the connection, not
 *     a specific model, so the combo router falls back to a different provider.
 *   - Minimax: per-model quota. A 429 with `x-model-quota-remaining: <model>=0`
 *     means only that model is locked — the rest of the connection stays healthy.
 *
 * New providers register a `ProviderErrorRule[]` in `providerRuleRegistry`. Rules
 * are evaluated BEFORE the global ERROR_RULES in classifyError. If no rule
 * matches, behavior falls through to the existing global text/status rules.
 *
 * Adding a new provider = create one ProviderErrorRule[] and register it below.
 * No changes to classifyError, lockModel, or updateProviderConnection needed.
 */

import type { ConfiguredErrorReason } from "./errorConfig.ts";

export type ProviderErrorRule = {
  id: string;
  match: (ctx: {
    status: number;
    headers: Record<string, string>;
    body: unknown;
  }) => ProviderErrorRuleMatch | null;
};

export type ProviderErrorRuleMatch = {
  reason: ConfiguredErrorReason;
  /**
   * Intended lock scope. NOTE: this field is currently INFORMATIONAL — no
   * consumer of `getProviderErrorRuleMatch` (checkFallbackError, combo.ts)
   * reads `scope` today; only `reason` and `cooldownMs` are consulted. The
   * actual lock scope applied at runtime is decided independently by each
   * call site (e.g. `hasPerModelQuota()` deciding model- vs connection-level
   * lockout). Honoring this field end-to-end is tracked as a follow-up —
   * see `docs/architecture/RESILIENCE_GUIDE.md` §7.
   */
  scope: "model" | "provider" | "connection";
  /** Optional explicit cooldown; falls back to the existing per-reason defaults. */
  cooldownMs?: number;
};

// ─── Opencode ───────────────────────────────────────────────────────────────────
// Opencode Go uses an account-wide quota. The body usually says "rate limit
// reached" but the presence of `x-ratelimit-remaining-requests: 0` is the
// tell. Without this rule, an exhausted org quota would be classified as
// RATE_LIMIT_EXCEEDED (~5s cooldown), causing the combo to keep retrying
// every model on the same provider until the 5h window resets.
//
// Scope note: `scope: "connection"` (not "provider") is correct because the
// upstream quota is per-account, and a single OmniRoute provider entry maps to
// one user account. Multiple OmniRoute connections under the same provider
// name mean the user has multiple upstream accounts — locking at the provider
// level would disable every one of them when only one is exhausted. See
// Issue #2 (Monthly quota exhausted treated as transient 429).
function buildOpencodeRules(): ProviderErrorRule[] {
  return [
    {
      id: "opencode-monthly-quota-resets-in",
      match: ({ status, body }) => {
        if (status !== 429) return null;
        // The exact body envelope we observe in the wild:
        //   "[429] Monthly usage limit reached. Resets in 13 days. To continue
        //    using this model now, enable usage from your available balance: ..."
        // Also covers the headers-less case where only the body carries the
        // reset hint (the opencode-quota-exhausted-headers rule above requires
        // headers, but the upstream sometimes omits them).
        const text = JSON.stringify(body ?? "").toLowerCase();
        if (!text.includes("monthly usage limit reached")) return null;
        const cooldownMs = parseResetCountdownMs(text);
        if (cooldownMs === null) return null;
        return {
          reason: "quota_exhausted",
          scope: "connection",
          cooldownMs,
        };
      },
    },
    {
      id: "opencode-quota-exhausted-headers",
      match: ({ status, headers }) => {
        if (status !== 429) return null;
        const remainingRequests = headers["x-ratelimit-remaining-requests"];
        if (remainingRequests === "0") {
          return { reason: "quota_exhausted", scope: "connection" };
        }
        const remainingTokens = headers["x-ratelimit-remaining-tokens"];
        if (remainingTokens === "0") {
          return { reason: "quota_exhausted", scope: "connection" };
        }
        return null;
      },
    },
    {
      id: "opencode-quota-exhausted-body",
      match: ({ status, body }) => {
        if (status !== 429) return null;
        const text = JSON.stringify(body ?? "").toLowerCase();
        if (
          text.includes("organization_quota_exceeded") ||
          text.includes("account_quota_exceeded") ||
          text.includes("plan_limit_reached")
        ) {
          return { reason: "quota_exhausted", scope: "connection" };
        }
        return null;
      },
    },
  ];
}

// ─── Minimax ────────────────────────────────────────────────────────────────
// Minimax returns per-model quota info via custom headers. The body is generic
// "rate limit exceeded" so we MUST read the headers. Other models on the same
// connection stay healthy; only the named model gets locked.
function buildMinimaxRules(): ProviderErrorRule[] {
  return [
    {
      id: "minimax-per-model-quota",
      match: ({ status, headers }) => {
        if (status !== 429) return null;
        // Header pattern: "x-model-quota-remaining: haiku=0,sonnet=42,opus=100"
        const headerVal = headers["x-model-quota-remaining"];
        if (!headerVal) return null;
        // If any model reports 0 remaining, the request was rejected for that
        // model. We classify as quota_exhausted so lockModel is called with
        // scope=model instead of poisoning the whole connection.
        const exhausted = headerVal.split(",").some((pair) => pair.split("=")[1]?.trim() === "0");
        if (exhausted) {
          return { reason: "quota_exhausted", scope: "model" };
        }
        return null;
      },
    },
  ];
}

// ─── Cloudflare Workers AI ─────────────────────────────────────────────────────
// Free tier = 10,000 Neurons/day, shared across the WHOLE account
// (docs/reference/FREE_TIERS.md; official: developers.cloudflare.com/
// workers-ai/platform/errors/). The exhaustion body doesn't match any
// QUOTA_PATTERNS keyword so it falls through to rate_limit and gets
// retried every ~60s against a budget that only resets at UTC midnight.
// Issue #6980.
function buildCloudflareAiRules(): ProviderErrorRule[] {
  return [
    {
      id: "cloudflare-ai-daily-neuron-allocation",
      match: ({ status, body }) => {
        if (status !== 429) return null;
        const text = JSON.stringify(body ?? "").toLowerCase();
        // Body: "you have used up your daily free allocation of 10,000 neurons,
        //        please upgrade to Cloudflare's Workers Paid plan..."
        if (!text.includes("daily free allocation")) return null;
        // No cooldownMs: recordModelLockoutFailure already sets
        // quota_exhausted without one to "next UTC midnight".
        return { reason: "quota_exhausted", scope: "connection" };
      },
    },
  ];
}

// ─── OpenRouter ─────────────────────────────────────────────────────────────
// #6842: OpenRouter returns 402 for both a negative account balance and a
// depleted per-key credit cap. The global `status_402` rule already maps this
// to `quota_exhausted` with a zero cooldown (immediate fallback to the next
// connection), but leaves the scope ambiguous and doesn't stop the SAME
// connection from being reselected instantly (credits genuinely need a
// top-up, not a timed wait). This explicit rule locks the whole connection
// (scope: "connection" — credits are account-wide, not per-model) for a real
// cooldown so combo routing skips it instead of hot-looping back onto it.
function buildOpenrouterRules(): ProviderErrorRule[] {
  return [
    {
      id: "openrouter-credit-exhausted-402",
      match: ({ status }) => {
        if (status !== 402) return null;
        return { reason: "quota_exhausted", scope: "connection", cooldownMs: 2 * 60 * 1000 };
      },
    },
  ];
}

// ─── AgentRouter ────────────────────────────────────────────────────────────
// agentrouter.org misstates temporary quota exhaustion as 403/400 with a
// Chinese body. upstreamStatusRestatement.ts rewrites the status to 429
// BEFORE classification, so rules here accept both the raw 403/400 and the
// restated 429 (text is the real discriminator either way). In production,
// the raw 403 path is what actually matters here: checkFallbackError's
// apikey-category FORBIDDEN branch (~line 1699) returns EARLY for a plain
// 403, before these rules are ever consulted — these rules fire on the
// RESTATED 429 (chatCore's upstreamStatusRestatement hook runs first) via
// resolveRuleMatchBody, which is the only path in checkFallbackError that
// hands these rules the full error text instead of just {code, type}.
//  - "额度不足": account-wide temporary quota → quota_exhausted, scope
//    "connection" (mirror of the Opencode account-wide rationale above).
//    NOTE: `scope` on ProviderErrorRuleMatch is currently informational —
//    checkFallbackError/combo.ts only consume `reason` and `cooldownMs`, not
//    `scope`. For agentrouter specifically (passthroughModels: true →
//    hasPerModelQuota() is true), this quota_exhausted match actually
//    resolves to a PER-MODEL lockout (recordModelLockoutFailure), not a
//    connection-wide lock — other models on the same account keep being
//    tried by combo routing (each burning one call) until they lock out
//    individually. Honoring `scope` end-to-end is tracked as a follow-up.
//  - "无权访问模型": declares auth_error/scope "model" (intent: lock only the
//    model so the connection keeps serving the rest — Model Lockout tier).
//    This rule does NOT fire on the production path today: it only matches
//    `status === 403`, but checkFallbackError's apikey FORBIDDEN branch
//    returns early for a plain 403 before this rule is ever consulted (see
//    the note above). A live `无权访问模型` 403 is handled like the base
//    apikey-provider 403 today. Wiring this rule into that path is tracked
//    as a follow-up.
function buildAgentrouterRules(): ProviderErrorRule[] {
  const AGENTROUTER_ERROR_STATUSES = new Set([400, 403, 429]);
  return [
    {
      id: "agentrouter-user-quota-exhausted",
      match: ({ status, body }) => {
        if (!AGENTROUTER_ERROR_STATUSES.has(status)) return null;
        const text = JSON.stringify(body ?? "").toLowerCase();
        if (!text.includes("额度不足")) return null;
        return { reason: "quota_exhausted", scope: "connection" };
      },
    },
    {
      id: "agentrouter-model-access-denied",
      match: ({ status, body }) => {
        if (status !== 403) return null;
        const text = JSON.stringify(body ?? "").toLowerCase();
        if (!text.includes("无权访问模型")) return null;
        // 6h: effectively "until the operator fixes the key's model grants",
        // without being an unrecoverable terminal state.
        return { reason: "auth_error", scope: "model", cooldownMs: 6 * 60 * 60 * 1000 };
      },
    },
  ];
}

/**
 * Global registry. Provider name → ordered list of rules (first match wins).
 * Add new providers here; the matcher in classifyError will pick them up
 * automatically.
 */
export const providerRuleRegistry = new Map<string, ProviderErrorRule[]>([
  ["opencode", buildOpencodeRules()],
  ["opencode-go", buildOpencodeRules()],
  ["opencode-cli", buildOpencodeRules()],
  ["minimax", buildMinimaxRules()],
  ["minimax-passthrough", buildMinimaxRules()],
  ["cloudflare-ai", buildCloudflareAiRules()],
  ["openrouter", buildOpenrouterRules()],
  ["agentrouter", buildAgentrouterRules()],
]);

/**
 * Providers whose rules match on the FULL upstream error text.
 * checkFallbackError's rule lookup normally passes only the structured
 * error ({code, type} — message stripped by the combo callers), which is
 * enough for header/status/code rules but blind to body-text markers like
 * agentrouter's "额度不足". Providers in this set get the raw error text as
 * the match body instead. EXCLUSIVE allowlist by owner decision (2026-08-13):
 * adding a provider here is an explicit opt-in — the default path for every
 * other provider must remain byte-for-byte unchanged.
 */
const FULL_TEXT_RULE_PROVIDERS = new Set(["agentrouter"]);

/**
 * Resolve the body handed to getProviderErrorRuleMatch inside
 * checkFallbackError: full error text for FULL_TEXT_RULE_PROVIDERS,
 * the structured error for everyone else.
 */
export function resolveRuleMatchBody(
  provider: string | null | undefined,
  structuredError: unknown,
  errorText: string | null | undefined
): unknown {
  if (provider && FULL_TEXT_RULE_PROVIDERS.has(provider.toLowerCase()) && errorText) {
    return errorText;
  }
  return structuredError ?? null;
}

/**
 * Returns the first matching rule for a provider, or null if none match.
 * Callers use this to (a) classify the reason and (b) decide whether to
 * lock just the model or the whole connection.
 */
export function getProviderErrorRuleMatch(
  provider: string | null | undefined,
  status: number,
  headers: Headers | Record<string, string> | null | undefined,
  body?: unknown
): ProviderErrorRuleMatch | null {
  if (!provider) return null;
  const rules = providerRuleRegistry.get(provider.toLowerCase());
  if (!rules) return null;
  // Normalize headers: accept either a `Headers` object (from `fetch()`) or
  // a plain record. Provider rules access headers via plain object indexing.
  const safeHeaders: Record<string, string> = !headers
    ? {}
    : typeof (headers as Headers).get === "function"
      ? Object.fromEntries((headers as Headers).entries())
      : Object.fromEntries(
          Object.entries(headers as Record<string, string>).map(([key, value]) => [
            key.toLowerCase(),
            value,
          ])
        );
  for (const rule of rules) {
    const match = rule.match({ status, headers: safeHeaders, body });
    if (match) return match;
  }
  return null;
}

/**
 * Parse a "Resets in N <unit>" countdown phrase from an upstream error body.
 *
 * Returns the cooldown in milliseconds, or null if no recognizable phrase is
 * present. Supports the units observed across OpenCode-Go / Workplace /
 * Deepseek envelopes: `days`, `day`, `hours`, `hour`, `minutes`, `minute`,
 * `seconds`, `second`. Variants like `Resets in 13 days.`, `resets in 2 hours`
 * and `Resets in 30 minutes.` all parse correctly.
 *
 * Input must already be lowercased — callers pass a `.toLowerCase()`'d body
 * because the upstream envelopes are case-inconsistent.
 *
 * Fix C / Issue #2: this is what lets a single rule declare an explicit
 * cooldown of "13 days" instead of falling through to the engine's scaled
 * ~60s default.
 */
export function parseResetCountdownMs(text: string): number | null {
  if (typeof text !== "string" || text.length === 0) return null;
  const match = text.match(
    /resets?\s+in\s+(\d+)\s+(day|days|hour|hours|minute|minutes|second|seconds)\b/
  );
  if (!match) return null;
  const n = Number(match[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  const unit = match[2];
  switch (unit) {
    case "day":
    case "days":
      return n * 86_400_000;
    case "hour":
    case "hours":
      return n * 3_600_000;
    case "minute":
    case "minutes":
      return n * 60_000;
    case "second":
    case "seconds":
      return n * 1_000;
    default:
      return null;
  }
}
