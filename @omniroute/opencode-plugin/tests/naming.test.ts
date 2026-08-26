/**
 * Tests for `formatFreeBudget` (@omniroute/opencode-plugin/src/naming.ts):
 * formats a free-tier model's budget info into a short human-readable
 * suffix, branching on `freeType`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { formatFreeBudget } from "../src/naming.js";

test("formatFreeBudget: recurring-daily formats tokens/day", () => {
  assert.equal(
    formatFreeBudget({ freeType: "recurring-daily", monthlyTokens: 25_000_000 }),
    "25M tokens/day"
  );
});

test("formatFreeBudget: recurring-monthly formats tokens/month", () => {
  assert.equal(
    formatFreeBudget({ freeType: "recurring-monthly", monthlyTokens: 1_000_000 }),
    "1M tokens/month"
  );
});

test("formatFreeBudget: recurring-credit formats credits", () => {
  assert.equal(
    formatFreeBudget({ freeType: "recurring-credit", creditTokens: 10_000_000 }),
    "10M credits"
  );
});

test("formatFreeBudget: one-time-initial formats credits with (one-time) suffix", () => {
  assert.equal(
    formatFreeBudget({ freeType: "one-time-initial", creditTokens: 1_000_000 }),
    "1M credits (one-time)"
  );
});

test("formatFreeBudget: keyless has no token/credit args", () => {
  assert.equal(formatFreeBudget({ freeType: "keyless" }), "(keyless)");
});

test("formatFreeBudget: discontinued has no token/credit args", () => {
  assert.equal(formatFreeBudget({ freeType: "discontinued" }), "(discontinued)");
});

test("formatFreeBudget: missing token/credit counts default to 0", () => {
  assert.equal(
    formatFreeBudget({ freeType: "recurring-daily" }),
    "0 tokens/day"
  );
});
