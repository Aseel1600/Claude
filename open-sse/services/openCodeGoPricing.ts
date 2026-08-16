/**
 * Official OpenCode Go usage-meter rates for OmniRoute's curated catalog, captured 2026-08-17.
 * Rates are USD per 1M tokens. `monthlyUsageLimitUsd` is the model-specific
 * included monthly usage column; account-wide windows remain $12/5h, $30/week,
 * and $60/month. Context thresholds use recorded prompt/input tokens.
 */
export const OPENCODE_GO_PRICING_REVISION = "2026-08-17";

export const OPENCODE_GO_WINDOW_LIMITS_USD = Object.freeze({
  session: 12,
  weekly: 30,
  monthly: 60,
});

export type OpenCodeGoPricing = {
  input: number;
  output: number;
  cached: number;
  cache_creation?: number;
  monthlyUsageLimitUsd: 15 | 60;
  variant?: string;
};

type PricingInput = {
  model: string;
  inputTokens?: number;
  timestamp?: string | number | Date;
};

type CostInput = PricingInput & {
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
};

const STATIC_PRICING: Readonly<Record<string, OpenCodeGoPricing>> = Object.freeze({
  "grok-4.5": {
    input: 2,
    output: 6,
    cached: 0.3,
    monthlyUsageLimitUsd: 15,
  },
  "glm-5.3": {
    input: 1.4,
    output: 4.4,
    cached: 0.26,
    monthlyUsageLimitUsd: 15,
  },
  "glm-5.2": {
    input: 1.4,
    output: 4.4,
    cached: 0.26,
    monthlyUsageLimitUsd: 60,
  },
  "kimi-k3": {
    input: 3,
    output: 15,
    cached: 0.3,
    monthlyUsageLimitUsd: 15,
  },
  "kimi-k2.7-code": {
    input: 0.95,
    output: 4,
    cached: 0.19,
    monthlyUsageLimitUsd: 60,
  },
  "mimo-v2.5": {
    input: 0.14,
    output: 0.28,
    cached: 0.0028,
    monthlyUsageLimitUsd: 60,
  },
  "mimo-v2.5-pro": {
    input: 0.435,
    output: 0.87,
    cached: 0.003625,
    monthlyUsageLimitUsd: 15,
  },
  "minimax-m3": {
    input: 0.3,
    output: 1.2,
    cached: 0.06,
    monthlyUsageLimitUsd: 60,
  },
  "qwen3.8-max": {
    input: 2,
    output: 6,
    cached: 0.25,
    cache_creation: 2.5,
    monthlyUsageLimitUsd: 15,
  },
  "qwen3.7-max": {
    input: 2.5,
    output: 7.5,
    cached: 0.5,
    cache_creation: 3.125,
    monthlyUsageLimitUsd: 60,
  },
  hy3: {
    input: 0.14,
    output: 0.58,
    cached: 0.035,
    monthlyUsageLimitUsd: 60,
  },
});

function safeTokenCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
}

function normalizeModel(model: string): string {
  const raw = String(model || "")
    .trim()
    .toLowerCase()
    .split("/")
    .pop();
  const id = raw || "";

  if (/^glm-5\.2-(?:high|max)$/.test(id)) return "glm-5.2";
  if (id === "kimi-k3-max") return "kimi-k3";
  if (/^mimo-v2\.5-(?:high|max)$/.test(id)) return "mimo-v2.5";
  if (/^qwen3\.7-max-(?:high|max)$/.test(id)) return "qwen3.7-max";
  if (/^qwen3\.7-plus-(?:high|max)$/.test(id)) return "qwen3.7-plus";
  if (/^hy3-(?:low|high)$/.test(id)) return "hy3";
  if (/^grok-4\.5-(?:low|medium|high|max)$/.test(id)) return "grok-4.5";
  if (/^deepseek-v4-pro-(?:low|medium|high|max)$/.test(id)) return "deepseek-v4-pro";
  if (/^deepseek-v4-flash-(?:low|medium|high|max)$/.test(id)) return "deepseek-v4-flash";
  return id;
}

function timestampMs(value: PricingInput["timestamp"]): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  if (typeof value === "string") return Date.parse(value);
  return Date.now();
}

function isDeepSeekPeak(timestamp: PricingInput["timestamp"]): boolean {
  const parsed = timestampMs(timestamp);
  if (!Number.isFinite(parsed)) return false;
  const hour = new Date(parsed).getUTCHours();
  return (hour >= 1 && hour < 4) || (hour >= 6 && hour < 10);
}

function lunaPricing(inputTokens: number): OpenCodeGoPricing {
  if (inputTokens <= 272_000) {
    return {
      input: 0.2,
      output: 1.2,
      cached: 0.02,
      cache_creation: 0.25,
      monthlyUsageLimitUsd: 15,
      variant: "lte-272k",
    };
  }
  return {
    input: 0.4,
    output: 1.8,
    cached: 0.04,
    cache_creation: 0.5,
    monthlyUsageLimitUsd: 15,
    variant: "gt-272k",
  };
}

function qwenPlusPricing(inputTokens: number): OpenCodeGoPricing {
  const large = inputTokens > 256_000;
  return large
    ? {
        input: 1.2,
        output: 4.8,
        cached: 0.12,
        cache_creation: 1.5,
        monthlyUsageLimitUsd: 60,
        variant: "gt-256k",
      }
    : {
        input: 0.4,
        output: 1.6,
        cached: 0.04,
        cache_creation: 0.5,
        monthlyUsageLimitUsd: 60,
        variant: "lte-256k",
      };
}

function deepSeekPricing(
  model: "deepseek-v4-pro" | "deepseek-v4-flash",
  timestamp: PricingInput["timestamp"]
): OpenCodeGoPricing {
  const peak = isDeepSeekPeak(timestamp);
  if (model === "deepseek-v4-pro") {
    return {
      input: peak ? 1.32 : 0.66,
      output: peak ? 3.96 : 1.98,
      cached: peak ? 0.044 : 0.022,
      monthlyUsageLimitUsd: 15,
      variant: peak ? "peak" : "off-peak",
    };
  }
  return {
    input: peak ? 0.44 : 0.22,
    output: peak ? 1.32 : 0.66,
    cached: peak ? 0.014 : 0.007,
    monthlyUsageLimitUsd: 15,
    variant: peak ? "peak" : "off-peak",
  };
}

export function resolveOpenCodeGoPricing(input: PricingInput): OpenCodeGoPricing | null {
  const model = normalizeModel(input.model);
  const inputTokens = safeTokenCount(input.inputTokens);
  if (model === "gpt-5.6-luna") return lunaPricing(inputTokens);
  if (model === "qwen3.7-plus") return qwenPlusPricing(inputTokens);
  if (model === "deepseek-v4-pro" || model === "deepseek-v4-flash") {
    return deepSeekPricing(model, input.timestamp);
  }
  return STATIC_PRICING[model] ? { ...STATIC_PRICING[model] } : null;
}

export const OPENCODE_GO_PRICED_MODEL_IDS = Object.freeze(
  [
    ...Object.keys(STATIC_PRICING),
    "gpt-5.6-luna",
    "qwen3.7-plus",
    "deepseek-v4-pro",
    "deepseek-v4-flash",
  ].sort()
);

export function calculateOpenCodeGoCost(input: CostInput) {
  const inputTokens = safeTokenCount(input.inputTokens);
  const outputTokens = safeTokenCount(input.outputTokens);
  const cacheReadTokens = safeTokenCount(input.cacheReadTokens);
  const cacheCreationTokens = safeTokenCount(input.cacheCreationTokens);
  const pricing = resolveOpenCodeGoPricing({
    model: input.model,
    inputTokens,
    timestamp: input.timestamp,
  });
  if (!pricing) return null;

  const ordinaryInputTokens = Math.max(0, inputTokens - cacheReadTokens - cacheCreationTokens);
  const costUsd =
    (ordinaryInputTokens * pricing.input +
      outputTokens * pricing.output +
      cacheReadTokens * pricing.cached +
      cacheCreationTokens * (pricing.cache_creation ?? 0)) /
    1_000_000;

  return {
    costUsd: Math.round(costUsd * 10_000_000_000) / 10_000_000_000,
    model: normalizeModel(input.model),
    pricing,
    pricingRevision: OPENCODE_GO_PRICING_REVISION,
  };
}
