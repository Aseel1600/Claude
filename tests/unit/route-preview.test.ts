/**
 * Route preview: capacity of the resolved chain, without executing.
 *
 * The number these tests defend is `narrowestInput` — the tightest input budget
 * across every hop a request could land on. A client that fits it survives the
 * whole fallback chain without a mid-flight compaction, which is the entire
 * point of the endpoint.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Capacity resolution reads the model-context override table; keep unit tests
// off the operator's real database.
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "omniroute-route-preview-"));

const { buildRoutePreview, extractComboTargets, hopInputBudget } =
  await import("../../open-sse/handlers/routePreview.ts");

const noCombo = () => null;

test("single model resolves to a one-hop chain carrying its capacity", () => {
  const preview = buildRoutePreview("anthropic/claude-sonnet-4-5", noCombo);

  assert.equal(preview.isCombo, false);
  assert.equal(preview.strategy, null);
  assert.equal(preview.chain.length, 1);
  assert.equal(preview.chain[0].provider, "anthropic");
  assert.ok(preview.chain[0].contextWindow !== null && preview.chain[0].contextWindow > 0);
  assert.equal(preview.narrowestInput, hopInputBudget(preview.chain[0]));
});

test("narrowestInput is the tightest hop, not the first", () => {
  // The whole reason to preview: the FIRST target's window tells a client
  // nothing about what it will get after one fallback.
  const preview = buildRoutePreview("wide-then-narrow", () => ({
    name: "wide-then-narrow",
    strategy: "priority",
    targets: [
      { provider: "anthropic", model: "claude-sonnet-4-5" },
      { provider: "openai", model: "gpt-4o" },
    ],
  }));

  assert.equal(preview.isCombo, true);
  assert.equal(preview.strategy, "priority");
  assert.equal(preview.chain.length, 2);

  const budgets = preview.chain.map(hopInputBudget);
  const tightest = Math.min(...budgets.filter((b): b is number => b !== null));
  assert.equal(preview.narrowestInput, tightest);
  assert.ok(
    preview.narrowestInput! <= budgets[0]!,
    "narrowest must never exceed the first hop's budget"
  );
});

test("hops of unknown capacity are counted, never silently treated as roomy", () => {
  // Reporting an unknown hop as if it had the chain's known budget would tell a
  // client it is safe when nobody knows that. Counting it lets the client
  // choose its own conservatism.
  const preview = buildRoutePreview("half-unknown", () => ({
    name: "half-unknown",
    strategy: "priority",
    targets: [
      { provider: "anthropic", model: "claude-sonnet-4-5" },
      { provider: "provider-that-does-not-exist", model: "totally-unknown-model" },
    ],
  }));

  assert.equal(preview.chain.length, 2);
  assert.equal(
    preview.unknownCapacityHops + preview.chain.filter((h) => hopInputBudget(h) !== null).length,
    preview.chain.length,
    "every hop is either budgetable or counted as unknown"
  );
});

test("every hop reports where its window came from", () => {
  const preview = buildRoutePreview("mixed-provenance", () => ({
    name: "mixed-provenance",
    strategy: "priority",
    targets: [
      { provider: "anthropic", model: "claude-sonnet-4-5" },
      { provider: "provider-that-does-not-exist", model: "model-with-no-known-family" },
    ],
  }));

  for (const hop of preview.chain) {
    assert.ok(
      typeof hop.contextSource === "string" && hop.contextSource.length > 0,
      `${hop.provider}/${hop.model} must carry a provenance`
    );
  }
  // A guessed window and a catalogued one must be distinguishable, or the
  // provenance carries no information.
  assert.notEqual(preview.chain[0].contextSource, preview.chain[1].contextSource);
});

test("hopInputBudget prefers the input ceiling over the total window", () => {
  // #6191: the total window is not the prompt budget when output is reserved.
  assert.equal(
    hopInputBudget({
      provider: "openai",
      model: "gpt-5.5",
      contextWindow: 400_000,
      maxInput: 272_000,
      maxOutput: 128_000,
      contextSource: "catalog",
    }),
    272_000
  );
  assert.equal(
    hopInputBudget({
      provider: "x",
      model: "y",
      contextWindow: 128_000,
      maxInput: null,
      maxOutput: null,
      contextSource: "catalog",
    }),
    128_000
  );
  assert.equal(
    hopInputBudget({
      provider: "x",
      model: "y",
      contextWindow: null,
      maxInput: null,
      maxOutput: null,
      contextSource: "default",
    }),
    null
  );
});

test("extractComboTargets tolerates the shapes combos are actually stored in", () => {
  // Stored as JSON text.
  assert.deepEqual(extractComboTargets('[{"provider":"openai","model":"gpt-4o"}]'), [
    { provider: "openai", model: "gpt-4o" },
  ]);
  // Provider folded into the model id.
  assert.deepEqual(extractComboTargets([{ model: "openai/gpt-4o" }]), [
    { provider: "openai", model: "gpt-4o" },
  ]);
  // Junk entries are dropped rather than producing an unusable hop.
  assert.deepEqual(extractComboTargets([null, {}, { model: "   " }, "nope"]), []);
  for (const bad of [null, undefined, "not json", 42, {}]) {
    assert.deepEqual(extractComboTargets(bad), [], `${JSON.stringify(bad)} must yield no targets`);
  }
});

test("a combo with no usable targets yields an empty chain and no false budget", () => {
  const preview = buildRoutePreview("empty-combo", () => ({
    name: "empty-combo",
    strategy: "priority",
    targets: [],
  }));

  assert.equal(preview.isCombo, true);
  assert.deepEqual(preview.chain, []);
  assert.equal(
    preview.narrowestInput,
    null,
    "an empty chain must report no budget rather than a fabricated one"
  );
});
