/**
 * A force-reset of OmniRoute's own wedged queue must not punish the connection.
 *
 * `withRateLimit` has TWO sibling failure paths for the local queue, thrown from
 * the same catch:
 *
 *   RATE_LIMIT_QUEUE_TIMEOUT  -> 503, tagged `local_queue_timeout`  (protected 08-08)
 *   RATE_LIMIT_QUEUE_WEDGED   -> 502, untagged                      (this file)
 *
 * The 08-08 fix keyed its rule on the pair `503 + local_queue_timeout`, so the
 * sibling — which surfaces as 502 — walked straight past it and was treated as a
 * provider failure.
 *
 * Production 2026-08-09, real Cursor traffic on [VB]-/deepseek-v4-flash:
 *
 *   16:36:06  WEDGED: queued=1 running=0 executing=0
 *             [502] Request dropped: ... queue ... force-reset
 *   16:38:04  Model-only lockout VB:deepseek-v4-flash — 502 server_error
 *             Account 021cd8d3 unavailable (502) | all 1 active accounts cooling down
 *   16:38:28  success
 *
 * Two minutes lost, and VB has a single active connection, so everything queued
 * behind it. `queued=1 running=0 executing=0` is the proof there was no load — the
 * limiter was idle and the job had never been dispatched. A wedge is MORE
 * self-inflicted than a queue drop: there the request at least waited its turn.
 *
 * The lesson of the miss is encoded here too: the queue tags are now recognised by
 * TYPE, not by a status+type pair. Both strings are written only by OmniRoute, at a
 * single site each, so no provider can forge them — while binding them to a status
 * is exactly the trap that let this one through.
 */
import test from "node:test";
import assert from "node:assert/strict";

const {
  isSelfInflictedFailure,
  LOCAL_QUEUE_TIMEOUT_ERROR_TYPE,
  LOCAL_QUEUE_WEDGE_ERROR_TYPE,
} = await import("../../open-sse/handlers/chatCore/cooldownClassification.ts");

const PROVIDER = "openai-compatible-chat-6775f68a";

test("the wedge tag exists and is distinct from the queue-timeout tag", () => {
  assert.equal(typeof LOCAL_QUEUE_WEDGE_ERROR_TYPE, "string");
  assert.notEqual(LOCAL_QUEUE_WEDGE_ERROR_TYPE, LOCAL_QUEUE_TIMEOUT_ERROR_TYPE);
});

test("a wedge force-reset spares the connection", () => {
  assert.equal(
    isSelfInflictedFailure(502, LOCAL_QUEUE_WEDGE_ERROR_TYPE, PROVIDER),
    true,
    "the limiter was idle and the job was never dispatched — the connection is healthy"
  );
});

test("the wedge is recognised by its tag, not by the status it happens to carry", () => {
  // Binding the 08-08 rule to `503 + local_queue_timeout` is what let the 502
  // sibling through. The tag alone must be sufficient, so a future status change
  // cannot silently un-protect it again.
  for (const status of [500, 502, 503, 504]) {
    assert.equal(
      isSelfInflictedFailure(status, LOCAL_QUEUE_WEDGE_ERROR_TYPE, PROVIDER),
      true,
      `the wedge tag must protect regardless of status (got status ${status})`
    );
  }
});

test("the queue-timeout sibling stays protected", () => {
  assert.equal(isSelfInflictedFailure(503, LOCAL_QUEUE_TIMEOUT_ERROR_TYPE, PROVIDER), true);
});

test("a genuine provider 502 still cools the connection down", () => {
  assert.equal(
    isSelfInflictedFailure(502, undefined, PROVIDER),
    false,
    "an untagged 502 is a real upstream failure and must keep its cooldown"
  );
  assert.equal(isSelfInflictedFailure(502, "server_error", PROVIDER), false);
});

test("a genuine provider 503 still cools the connection down", () => {
  assert.equal(isSelfInflictedFailure(503, undefined, PROVIDER), false);
});

test("our own deadline timeout stays protected, antigravity still excepted", () => {
  assert.equal(isSelfInflictedFailure(504, "upstream_timeout", PROVIDER), true);
  assert.equal(
    isSelfInflictedFailure(504, "upstream_timeout", "antigravity"),
    false,
    "antigravity owns its pre-response-timeout policy"
  );
});

test("the queue tags have no antigravity exception — the queue is ours for everyone", () => {
  assert.equal(isSelfInflictedFailure(502, LOCAL_QUEUE_WEDGE_ERROR_TYPE, "antigravity"), true);
  assert.equal(isSelfInflictedFailure(503, LOCAL_QUEUE_TIMEOUT_ERROR_TYPE, "antigravity"), true);
});

test("unrelated failures are untouched", () => {
  assert.equal(isSelfInflictedFailure(401, "authentication_error", PROVIDER), false);
  assert.equal(isSelfInflictedFailure(429, undefined, PROVIDER), false);
  assert.equal(isSelfInflictedFailure(500, "server_error", PROVIDER), false);
});
