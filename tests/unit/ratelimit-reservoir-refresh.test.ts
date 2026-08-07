/**
 * Regression test — header-learned RPM window must keep admitting after exhaustion.
 *
 * History: this file was born as the TDD repro for the Bottleneck 2.19.5
 * reservoir-heartbeat death after updateSettings() (#9529 — a limiter whose
 * reservoir hit 0 never refilled, wedging the request queue for ~120s until the
 * watchdog fired RATE_LIMIT_QUEUE_WEDGED and a weighted 70/30 combo collapsed
 * to ~50/50). #9604 then removed the Bottleneck reservoir entirely: RPM
 * admission is now enforced by the rolling lease gate
 * (open-sse/services/rollingRpmGate.ts), and updateFromHeaders() feeds
 * low-remaining headers into it synchronously via rpmGate.learnHeaderWindow().
 *
 * The business invariant this file guards is mechanism-independent and is the
 * same one #9529 proved: after a header-learned throttle window is exhausted,
 * later requests MUST eventually be admitted again (the window rolls / the
 * learned state expires) — they must never stay queued forever. The middle
 * assertion also proves the gate actually engaged: the third request has to be
 * DELAYED by the 1s learned window, not waved straight through.
 */
import test from "node:test";
import assert from "node:assert/strict";

const rateLimitManager = await import("../../open-sse/services/rateLimitManager.ts");

const PROVIDER = "reservoir-refresh-test-provider";
const CONNECTION_ID = "reservoir-refresh-test-conn";

test.after(async () => {
  await rateLimitManager.__resetRateLimitManagerForTests();
});

test("header-learned RPM window keeps admitting after exhaustion (rolling lease gate)", async () => {
  rateLimitManager.enableRateLimitProtection(CONNECTION_ID);

  // 1. First call creates the limiter (concurrency/minTime only post-#9604 —
  // RPM is the rolling gate's job).
  const warmup = await rateLimitManager.withRateLimit(
    PROVIDER,
    CONNECTION_ID,
    null,
    async () => "warmup"
  );
  assert.equal(warmup, "warmup");

  // 2. Header-learned throttle: remaining(2) < limit(6000)*0.1 takes
  // updateFromHeaders' throttle branch, which SYNCHRONOUSLY calls
  // rpmGate.learnHeaderWindow(provider, conn, model, 2, 1000, now+1000) —
  // a 2-requests-per-1s rolling window (limit=6000 keeps minTime ~0 so limiter
  // pacing does not interfere with the admission timing below).
  rateLimitManager.updateFromHeaders(
    PROVIDER,
    CONNECTION_ID,
    {
      "x-ratelimit-limit-requests": "6000",
      "x-ratelimit-remaining-requests": "2",
      "x-ratelimit-reset-requests": "1s",
    },
    200
  );

  // 3. Consume the 2 admissions of the learned window.
  assert.equal(
    await rateLimitManager.withRateLimit(PROVIDER, CONNECTION_ID, null, async () => "slot-1"),
    "slot-1"
  );
  assert.equal(
    await rateLimitManager.withRateLimit(PROVIDER, CONNECTION_ID, null, async () => "slot-2"),
    "slot-2"
  );

  // 4. The window is exhausted. A healthy gate admits the 3rd request once the
  // rolling window advances / the learned state expires (~1s). Race it against
  // a 5s timer: "timed-out" means admission wedged forever after the learned
  // throttle — the exact failure class #9529 fixed at the reservoir layer.
  const RACE_TIMEOUT_MS = 5000;
  const startedAt = Date.now();
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timed-out">((resolve) => {
    timeoutHandle = setTimeout(() => resolve("timed-out"), RACE_TIMEOUT_MS);
  });
  const request = rateLimitManager.withRateLimit(
    PROVIDER,
    CONNECTION_ID,
    null,
    async () => "slot-3" as const
  );

  const result = await Promise.race([request, timeout]);
  if (timeoutHandle) clearTimeout(timeoutHandle);

  assert.equal(
    result,
    "slot-3",
    "an exhausted header-learned window must admit again once it rolls (~1s); " +
      '"timed-out" means RPM admission wedged forever after updateFromHeaders'
  );

  // The gate must have actually engaged: with a 2/1s learned window already
  // exhausted, the 3rd admission cannot be instantaneous. A generous lower
  // bound (300ms << the 1s window) keeps this stable under CI load while still
  // catching a gate that waves everything straight through.
  const elapsedMs = Date.now() - startedAt;
  assert.ok(
    elapsedMs >= 300,
    `3rd request was admitted in ${elapsedMs}ms — the learned 2/1s window never gated it`
  );
});
