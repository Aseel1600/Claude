import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { OMNIROUTE_CONTEXT_SOURCES } from "../../src/shared/constants/headers.ts";

// Point the capability/override lookups at a throwaway database BEFORE the module
// graph loads: contextManager reaches into `model_context_overrides`, and the
// default DATA_DIR is the operator's real ~/.omniroute, which a unit test must
// never migrate or read.
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "omniroute-context-capacity-"));

const { resolveContextCapacity, getTokenLimit } =
  await import("../../open-sse/services/contextManager.ts");

test("resolveContextCapacity reports a catalog-backed window as `catalog`", () => {
  const capacity = resolveContextCapacity("anthropic", "claude-sonnet-4-5");
  assert.equal(capacity.source, "catalog");
  assert.ok(
    capacity.contextWindow !== null && capacity.contextWindow > 0,
    "a catalogued model must resolve a positive window"
  );
});

test("resolveContextCapacity flags a name-inferred window as `heuristic`", () => {
  // No such provider/model exists: the only reason a window comes back at all is
  // the substring match on the model NAME, which is a guess.
  const capacity = resolveContextCapacity("provider-that-does-not-exist", "some-claude-thing");
  assert.equal(capacity.source, "heuristic");
});

test("resolveContextCapacity flags the catch-all as `default`", () => {
  const capacity = resolveContextCapacity(
    "provider-that-does-not-exist",
    "model-with-no-known-family"
  );
  assert.equal(capacity.source, "default");
  // The dangerous part this header exists to expose: the catch-all still hands
  // back a plausible-looking number, indistinguishable from a measured one
  // without the provenance.
  assert.ok(capacity.contextWindow !== null && capacity.contextWindow > 0);
});

test("resolveContextCapacity tolerates a missing model id", () => {
  const capacity = resolveContextCapacity("provider-that-does-not-exist", null);
  assert.equal(capacity.maxInput, null);
  assert.equal(capacity.maxOutput, null);
  assert.ok(OMNIROUTE_CONTEXT_SOURCES.includes(capacity.source));
});

test("resolveContextCapacity always reports a source from the closed set", () => {
  for (const [provider, model] of [
    ["anthropic", "claude-sonnet-4-5"],
    ["openai", "gpt-4o"],
    ["provider-that-does-not-exist", "some-claude-thing"],
    ["provider-that-does-not-exist", "model-with-no-known-family"],
  ] as Array<[string, string]>) {
    const { source } = resolveContextCapacity(provider, model);
    assert.ok(
      OMNIROUTE_CONTEXT_SOURCES.includes(source),
      `${provider}/${model} produced an out-of-set source: ${source}`
    );
  }
});

test("resolveContextCapacity never contradicts getTokenLimit", () => {
  // The window a client is told must be the window routing decisions are made
  // against; two chains that can disagree are worse than one that is merely wrong.
  for (const [provider, model] of [
    ["anthropic", "claude-sonnet-4-5"],
    ["openai", "gpt-4o"],
    ["provider-that-does-not-exist", "model-with-no-known-family"],
  ] as Array<[string, string]>) {
    assert.equal(
      resolveContextCapacity(provider, model).contextWindow,
      getTokenLimit(provider, model),
      `${provider}/${model} disagreed with getTokenLimit`
    );
  }
});

test("resolveContextCapacity omits maxInput when it is not narrower than the window", () => {
  // Echoing the total window back as the input ceiling carries no information and
  // is exactly what kept auto-compaction from firing in #6191.
  for (const [provider, model] of [
    ["anthropic", "claude-sonnet-4-5"],
    ["openai", "gpt-4o"],
  ] as Array<[string, string]>) {
    const { contextWindow, maxInput } = resolveContextCapacity(provider, model);
    if (maxInput !== null && contextWindow !== null) {
      assert.ok(
        maxInput < contextWindow,
        `${provider}/${model} reported maxInput ${maxInput} that is not narrower than ${contextWindow}`
      );
    }
  }
});
