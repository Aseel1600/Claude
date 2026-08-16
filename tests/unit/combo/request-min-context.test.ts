/**
 * Per-request context floor via `X-OmniRoute-Min-Context`.
 *
 * Lets an orchestrator pin a whole session to a context tier without mutating
 * the combo's stored config — the same shape `X-OmniRoute-Budget` and
 * `X-OmniRoute-Mode` already established. The header can only TIGHTEN the
 * stored `minContextWindow`; weakening an operator policy from client traffic
 * is the failure mode these tests exist to prevent.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  parseRequestMinContext,
  resolveRequestAutoControls,
} from "../../../open-sse/services/autoCombo/requestControls.ts";
import { mergeRequestMinContext } from "../../../open-sse/services/combo/contextRequirements.ts";

test("parseRequestMinContext accepts a positive token count", () => {
  assert.equal(parseRequestMinContext("1000000"), 1_000_000);
  assert.equal(parseRequestMinContext("  262144  "), 262_144);
  // Fractional input is floored rather than rejected: a client computing a
  // budget arithmetically should not have its request silently ignored.
  assert.equal(parseRequestMinContext("1024.9"), 1024);
});

test("parseRequestMinContext ignores anything that is not a usable floor", () => {
  // A malformed header must not change routing in EITHER direction — silently
  // narrowing the pool on a typo is as bad as silently widening it.
  for (const input of ["", "   ", "0", "-1", "abc", "1e", null, undefined, 128000, {}]) {
    assert.equal(
      parseRequestMinContext(input),
      undefined,
      `${JSON.stringify(input)} must not resolve to a floor`
    );
  }
});

test("resolveRequestAutoControls surfaces the header alongside the existing controls", () => {
  const headers = new Headers({
    "x-omniroute-min-context": "1000000",
    "x-omniroute-mode": "quality",
  });
  const controls = resolveRequestAutoControls(headers);
  assert.equal(controls.minContextWindow, 1_000_000);
  assert.equal(controls.mode, "quality");
});

test("resolveRequestAutoControls omits the key entirely when the header is absent", () => {
  // Absent must mean absent, not `undefined` present: the object is spread into
  // relayOptions, and a present key changes what downstream reads as "set".
  const controls = resolveRequestAutoControls(new Headers());
  assert.ok(!("minContextWindow" in controls));
});

test("mergeRequestMinContext raises a stored floor", () => {
  const merged = mergeRequestMinContext(
    { minContextWindow: 128_000, contextFilterMode: "strict" },
    1_000_000
  );
  assert.equal(merged?.minContextWindow, 1_000_000);
  assert.equal(merged?.contextFilterMode, "strict", "unrelated requirements must survive");
});

test("mergeRequestMinContext never lowers a stored floor", () => {
  // The security-relevant direction: client traffic must not be able to opt out
  // of an operator's routing constraint.
  const merged = mergeRequestMinContext({ minContextWindow: 1_000_000 }, 8_000);
  assert.equal(merged?.minContextWindow, 1_000_000);
});

test("mergeRequestMinContext applies a floor when the combo has none", () => {
  assert.equal(mergeRequestMinContext(undefined, 512_000)?.minContextWindow, 512_000);
  assert.equal(mergeRequestMinContext({}, 512_000)?.minContextWindow, 512_000);
});

test("mergeRequestMinContext returns the original object untouched with no header", () => {
  const stored = { minContextWindow: 128_000 };
  for (const value of [undefined, null, 0, -1, Number.NaN]) {
    assert.equal(
      mergeRequestMinContext(stored, value),
      stored,
      `${String(value)} must leave the stored requirements identical (same reference)`
    );
  }
  assert.equal(mergeRequestMinContext(undefined, undefined), undefined);
});
