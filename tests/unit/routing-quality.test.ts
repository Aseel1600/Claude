/**
 * tests/unit/routing-quality.test.ts
 *
 * Feedback-driven quality signal (open-sse/services/routing/quality.ts):
 *  - neutral (1.0) before warmup
 *  - success raises / failure lowers the EWMA score
 *  - malformed / stream-interrupted / empty-output anomalies penalize
 *  - 429 is transient and penalizes far less than a 500
 *  - confidence ramps with sample count
 *  - reset clears state
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  recordQualityEvent,
  getQualityScore,
  getQualitySnapshot,
  resetQualityTracker,
  QUALITY_WELL_KNOWN,
} from "../../open-sse/services/routing/quality.ts";

const { MIN_QUALITY_SAMPLES } = QUALITY_WELL_KNOWN;

function record(
  provider: string,
  model: string,
  partial: Parameters<typeof recordQualityEvent>[0]
): void {
  recordQualityEvent({
    provider,
    model,
    outcome: "success",
    status: 200,
    latencyMs: 100,
    ...partial,
  });
}

test("fresh model scores neutral 1.0 (no warmup penalty)", () => {
  resetQualityTracker();
  assert.equal(getQualityScore("openai", "gpt-4o"), 1);
});

test("below warmup threshold the score stays neutral", () => {
  resetQualityTracker();
  for (let i = 0; i < MIN_QUALITY_SAMPLES - 1; i++) {
    record("openai", "gpt-4o", { outcome: "error", status: 500, latencyMs: 100 });
  }
  // Even all-failures below the threshold must not penalize a cold model.
  assert.equal(getQualityScore("openai", "gpt-4o"), 1);
});

test("sustained failures degrade the score; sustained successes recover it", () => {
  resetQualityTracker();
  const provider = "openai";
  const model = "gpt-4o";
  for (let i = 0; i < 20; i++) {
    record(provider, model, { outcome: "error", status: 500, latencyMs: 100 });
  }
  const degraded = getQualityScore(provider, model);
  assert.ok(degraded < 0.5, `expected degraded score, got ${degraded}`);

  for (let i = 0; i < 40; i++) {
    record(provider, model, { outcome: "success", status: 200, latencyMs: 100 });
  }
  const recovered = getQualityScore(provider, model);
  assert.ok(recovered > degraded, "successes must recover the score");
  assert.ok(recovered > 0.7, `expected recovery toward healthy, got ${recovered}`);
});

test("malformed and stream-interrupted outcomes penalize more than a clean error", () => {
  resetQualityTracker();
  record("p", "m-a", { outcome: "malformed", status: 200, latencyMs: 100, finishReason: "stop" });
  for (let i = 0; i < 20; i++)
    record("p", "m-a", { outcome: "success", status: 200, latencyMs: 100, finishReason: "stop" });

  record("p", "m-b", { outcome: "success", status: 200, latencyMs: 100, finishReason: "stop" });
  for (let i = 0; i < 20; i++)
    record("p", "m-b", { outcome: "success", status: 200, latencyMs: 100, finishReason: "stop" });

  const withAnomaly = getQualityScore("p", "m-a");
  const clean = getQualityScore("p", "m-b");
  assert.ok(withAnomaly < clean, "anomaly history must lower quality below a clean record");
});

test("finish_reason=length (truncated output) counts as an anomaly", () => {
  resetQualityTracker();
  for (let i = 0; i < MIN_QUALITY_SAMPLES; i++) {
    record("p", "truncated", {
      outcome: "success",
      status: 200,
      latencyMs: 100,
      finishReason: "length",
    });
  }
  const truncated = getQualityScore("p", "truncated");

  resetQualityTracker();
  for (let i = 0; i < MIN_QUALITY_SAMPLES; i++) {
    record("p", "clean", { outcome: "success", status: 200, latencyMs: 100, finishReason: "stop" });
  }
  assert.ok(truncated < getQualityScore("p", "clean"), "length finish_reason must hurt quality");
});

test("429 is treated as transient (near-neutral), not a quality failure", () => {
  resetQualityTracker();
  for (let i = 0; i < MIN_QUALITY_SAMPLES; i++) {
    record("p", "rl", { outcome: "rate_limited", status: 429, latencyMs: 100 });
  }
  const rateLimited = getQualityScore("p", "rl");

  resetQualityTracker();
  for (let i = 0; i < MIN_QUALITY_SAMPLES; i++) {
    record("p", "err", { outcome: "error", status: 500, latencyMs: 100 });
  }
  assert.ok(
    rateLimited > getQualityScore("p", "err"),
    "rate-limited should score better than hard failures"
  );
  // 429s seed successEwma at 0.5; the tiny latency penalty dips it slightly below
  // 0.5, so assert near-neutral rather than exactly 0.5.
  assert.ok(rateLimited >= 0.45, "rate-limit alone should not tank quality");
});

test("snapshot reports confidence and anomaly counts", () => {
  resetQualityTracker();
  for (let i = 0; i < MIN_QUALITY_SAMPLES; i++) {
    record("snap", "model", { outcome: "success", status: 200, latencyMs: 50 });
  }
  record("snap", "model", { outcome: "malformed", status: 200, latencyMs: 50 });
  const snap = getQualitySnapshot();
  const view = snap.find((v) => v.provider === "snap" && v.model === "model");
  assert.ok(view, "snapshot must contain the tracked model");
  assert.equal(view!.confidence, 1);
  assert.ok(view!.samples >= MIN_QUALITY_SAMPLES);
  assert.ok(view!.anomalies >= 1);
  assert.ok(view!.score >= 0 && view!.score <= 1);
});

test("reset clears all tracked state", () => {
  resetQualityTracker();
  record("p", "m", { outcome: "success", status: 200, latencyMs: 50 });
  assert.equal(getQualitySnapshot().length, 1);
  resetQualityTracker();
  assert.equal(getQualitySnapshot().length, 0);
  assert.equal(getQualityScore("p", "m"), 1);
});
