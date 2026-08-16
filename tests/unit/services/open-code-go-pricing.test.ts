import test from "node:test";
import assert from "node:assert/strict";

import { opencode_goProvider } from "../../../open-sse/config/providers/registry/opencode/go/index.ts";
import {
  OPENCODE_GO_PRICING_REVISION,
  OPENCODE_GO_PRICED_MODEL_IDS,
  OPENCODE_GO_WINDOW_LIMITS_USD,
  calculateOpenCodeGoCost,
  resolveOpenCodeGoPricing,
} from "../../../open-sse/services/openCodeGoPricing.ts";
import { calculateCost } from "../../../src/lib/usage/costCalculator.ts";

test("OpenCode Go pricing publishes the official budget revision", () => {
  assert.equal(OPENCODE_GO_PRICING_REVISION, "2026-08-17");
  assert.deepEqual(OPENCODE_GO_WINDOW_LIMITS_USD, {
    session: 12,
    weekly: 30,
    monthly: 60,
  });
});

test("every current OpenCode Go catalog model resolves to an official rate", () => {
  const curatedBaseModels = new Set<string>();
  for (const model of opencode_goProvider.models ?? []) {
    const priced = calculateOpenCodeGoCost({ model: model.id, inputTokens: 1 });
    assert.ok(
      priced,
      `missing official OpenCode Go pricing for ${model.id}`
    );
    curatedBaseModels.add(priced.model);
  }
  assert.deepEqual([...curatedBaseModels].sort(), [...OPENCODE_GO_PRICED_MODEL_IDS]);
});

test("effort aliases share their base model rate", () => {
  assert.deepEqual(
    resolveOpenCodeGoPricing({ model: "grok-4.5-high", inputTokens: 1 }),
    resolveOpenCodeGoPricing({ model: "grok-4.5", inputTokens: 1 })
  );
  assert.deepEqual(
    resolveOpenCodeGoPricing({ model: "deepseek-v4-pro-max", inputTokens: 1 }),
    resolveOpenCodeGoPricing({ model: "deepseek-v4-pro", inputTokens: 1 })
  );
  assert.deepEqual(
    resolveOpenCodeGoPricing({ model: "qwen3.7-plus-high", inputTokens: 1 }),
    resolveOpenCodeGoPricing({ model: "qwen3.7-plus", inputTokens: 1 })
  );
});

test("curated GPT 5.6 Luna changes rate only above 272K input tokens", () => {
  assert.deepEqual(resolveOpenCodeGoPricing({ model: "gpt-5.6-luna", inputTokens: 272_000 }), {
    input: 0.2,
    output: 1.2,
    cached: 0.02,
    cache_creation: 0.25,
    monthlyUsageLimitUsd: 15,
    variant: "lte-272k",
  });
  assert.deepEqual(resolveOpenCodeGoPricing({ model: "gpt-5.6-luna", inputTokens: 272_001 }), {
    input: 0.4,
    output: 1.8,
    cached: 0.04,
    cache_creation: 0.5,
    monthlyUsageLimitUsd: 15,
    variant: "gt-272k",
  });
});

test("curated Qwen 3.7 Plus changes rate only above 256K input tokens", () => {
  assert.equal(
    resolveOpenCodeGoPricing({ model: "qwen3.7-plus", inputTokens: 256_000 })?.input,
    0.4
  );
  assert.equal(
    resolveOpenCodeGoPricing({ model: "qwen3.7-plus", inputTokens: 256_001 })?.input,
    1.2
  );
});

test("DeepSeek Peak windows use UTC boundaries", () => {
  assert.equal(
    resolveOpenCodeGoPricing({
      model: "deepseek-v4-pro",
      inputTokens: 1,
      timestamp: "2026-08-17T01:00:00.000Z",
    })?.variant,
    "peak"
  );
  assert.equal(
    resolveOpenCodeGoPricing({
      model: "deepseek-v4-pro",
      inputTokens: 1,
      timestamp: "2026-08-17T03:59:59.999Z",
    })?.variant,
    "peak"
  );
  assert.equal(
    resolveOpenCodeGoPricing({
      model: "deepseek-v4-pro",
      inputTokens: 1,
      timestamp: "2026-08-17T04:00:00.000Z",
    })?.variant,
    "off-peak"
  );
  assert.equal(
    resolveOpenCodeGoPricing({
      model: "deepseek-v4-flash",
      inputTokens: 1,
      timestamp: "2026-08-17T06:00:00.000Z",
    })?.variant,
    "peak"
  );
  assert.equal(
    resolveOpenCodeGoPricing({
      model: "deepseek-v4-flash",
      inputTokens: 1,
      timestamp: "2026-08-17T10:00:00.000Z",
    })?.variant,
    "off-peak"
  );
});

test("OpenCode Go cost includes input, output, cache read, and cache write", () => {
  const result = calculateOpenCodeGoCost({
    model: "qwen3.8-max",
    inputTokens: 3_000_000,
    outputTokens: 1_000_000,
    cacheReadTokens: 1_000_000,
    cacheCreationTokens: 1_000_000,
  });

  assert.equal(result?.costUsd, 10.75);
  assert.equal(result?.pricing.monthlyUsageLimitUsd, 15);
});

test("unknown OpenCode Go models remain unpriced instead of becoming free", () => {
  assert.equal(resolveOpenCodeGoPricing({ model: "unknown-model", inputTokens: 1 }), null);
  assert.equal(calculateOpenCodeGoCost({ model: "unknown-model", inputTokens: 1 }), null);
  for (const retired of [
    "glm-5.1",
    "kimi-k2.6",
    "minimax-m2.7",
    "minimax-m2.5",
    "qwen3.6-plus",
  ]) {
    assert.equal(resolveOpenCodeGoPricing({ model: retired, inputTokens: 1 }), null, retired);
  }
});

test("the shared cost calculator uses OpenCode Go rates without leaking them to Zen", async () => {
  const tokens = { input: 1_000_000, output: 1_000_000 };
  assert.equal(
    await calculateCost("opencode-go", "kimi-k3", tokens, {
      timestamp: "2026-08-17T00:00:00.000Z",
    }),
    18
  );
  assert.equal(await calculateCost("opencode-zen", "kimi-k3", tokens), 0);
});
