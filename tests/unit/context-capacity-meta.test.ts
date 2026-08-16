/**
 * Capacity fields folded into the response meta headers.
 *
 * The guarantee under test is that reporting is ADVISORY: it never fabricates a
 * number, never withholds a response, and never emits a provenance without the
 * window it describes.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { buildContextCapacityMeta } from "../../open-sse/handlers/chatCore/contextCapacityMeta.ts";

const capacity = (over = {}) => ({
  contextWindow: 400_000,
  maxInput: 272_000,
  maxOutput: 128_000,
  source: "catalog" as const,
  ...over,
});

test("emits the full capacity set for a resolved target", () => {
  const meta = buildContextCapacityMeta("openai", "gpt-5.5", () => capacity());
  assert.deepEqual(meta, {
    contextWindow: 400_000,
    contextMaxInput: 272_000,
    contextMaxOutput: 128_000,
    contextSource: "catalog",
  });
});

test("emits nothing when the target is unknown", () => {
  // No provider or no model means there is nothing to report about.
  assert.deepEqual(
    buildContextCapacityMeta(null, "gpt-4o", () => capacity()),
    {}
  );
  assert.deepEqual(
    buildContextCapacityMeta("openai", null, () => capacity()),
    {}
  );
  assert.deepEqual(
    buildContextCapacityMeta("", "", () => capacity()),
    {}
  );
});

test("withholds the provenance together with the window it describes", () => {
  // A source with no number tells a client how much to trust a value it never
  // got — worse than silence.
  for (const window of [null, 0, -1]) {
    const meta = buildContextCapacityMeta("p", "m", () => capacity({ contextWindow: window }));
    assert.deepEqual(meta, {}, `window ${String(window)} must emit nothing at all`);
  }
});

test("omits narrower fields individually without dropping the window", () => {
  const meta = buildContextCapacityMeta("p", "m", () =>
    capacity({ maxInput: null, maxOutput: null })
  );
  assert.deepEqual(meta, { contextWindow: 400_000, contextSource: "catalog" });
});

test("a resolver failure costs the caller nothing", () => {
  // Capacity is advisory metadata; it must never be able to fail a response.
  const meta = buildContextCapacityMeta("p", "m", () => {
    throw new Error("catalog unavailable");
  });
  assert.deepEqual(meta, {});
});
