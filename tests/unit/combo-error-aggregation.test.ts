import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyComboOutcome,
  formatComboOutcomes,
  redactConnectionLabel,
  buildRedactedSummary,
} from "../../open-sse/services/combo/comboErrorAggregation.ts";

// #10314 — combo error aggregation mixes quality and auth.
// Regression guard for the pure aggregation helpers: a quality-failure reason from one
// target and a sibling's 401 must be presented as SEPARATE classified outcomes (never
// mashed into a single lastError), and account/connection identifiers must be redacted
// from client-visible and shared-warn strings.

test("#10314: classifyComboOutcome keeps auth distinct from quality/model", () => {
  assert.equal(classifyComboOutcome(401, "invalid_api_key"), "auth");
  assert.equal(classifyComboOutcome(403, "not authorized"), "auth");
  // 5xx sleep to the "timeout" class (>=499 is checked before >=500).
  assert.equal(classifyComboOutcome(503, "upstream unavailable"), "timeout");
  assert.equal(classifyComboOutcome(408, "timeout"), "timeout");
  assert.equal(classifyComboOutcome(400, "bad request"), "model");
});

test("#10314: formatComboOutcomes lists quality and auth reasons SEPARATELY (both visible)", () => {
  const msg = formatComboOutcomes([
    { model: "openai/model-quality", status: 502, error: "response failed quality validation", kind: "quality" },
    { model: "openai/proxy-account-b", status: 401, error: "invalid_api_key", kind: "auth" },
  ]);
  assert.match(msg, /quality validation/);
  assert.match(msg, /invalid_api_key/);
  assert.match(msg, /auth/);
  assert.ok(msg.indexOf("quality validation") < msg.indexOf("invalid_api_key"));
});

test("#10314: redactConnectionLabel masks connection/account identifiers", () => {
  assert.equal(
    redactConnectionLabel("openai/proxy-account-b"),
    "openai/proxy-account-b"
  );
  const withUuid = redactConnectionLabel("openai/8a4f0c6e-3b27-4c51-9d88-1f2a3b4c5d6e");
  assert.equal(withUuid, "openai/conn:8a4f0c6e");
  const withHex = redactConnectionLabel("openai/0f1e2d3c4b5a69788796170a1b2c3d4e5f607182");
  assert.equal(withHex, "openai/conn:0f1e2d3c");
});

test("#10314: buildRedactedSummary is redacted and truncates past 5 entries", () => {
  const s = buildRedactedSummary(
    Array.from({ length: 6 }, (_, i) => ({ model: `openai/8a4f0c6e-3b27-4c51-9d88-1f2a3b4c5d6e-${i}`, status: 401 + i }))
  );
  assert.ok(!s.includes("8a4f0c6e-3b27"), "summary must not leak a full UUID");
  assert.match(s, /conn:8a4f0c6e/);
  assert.match(s, /\(\+1\)/);
});