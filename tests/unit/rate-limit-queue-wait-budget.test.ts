/**
 * `maxWaitMs` must bound the time a job WAITS IN THE QUEUE — not how long it runs.
 *
 * OmniRoute passed `maxWaitMs` to Bottleneck as `{ expiration }`, but Bottleneck
 * defines `expiration` as an EXECUTION deadline: "The number milliseconds a job
 * has to finish" (node_modules/bottleneck/bottleneck.d.ts:109). Measured against
 * the installed dependency on 2026-08-09:
 *
 *   waited 1150ms in queue, ran 50ms,  expiration 300ms  ->  PASSED
 *   entered immediately,     ran 1200ms, expiration 300ms  ->  FAILED at 304ms
 *
 * So the knob never bounded queue wait at all, while it silently killed every
 * upstream call slower than 15s (the production default). Measured in production
 * 2026-08-08: 12 kills in 24h, 7 of them with the limiter completely IDLE
 * (running=0, executing=0) — there was no queue to be saturated. The p90 of
 * healthy traffic was 16.1s, sitting just above the ceiling.
 *
 * Call duration belongs to the guards in chatCore/upstreamTimeouts.ts (TTFB ->
 * readiness -> idle), which have the right boundaries and a per-model override
 * chain. This file pins the split: duration is free here, wait is measured.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-rl-queue-wait-"));
process.env.DATA_DIR = TEST_DATA_DIR;

const core = await import("../../src/lib/db/core.ts");
const resilienceSettings = await import("../../src/lib/resilience/settings.ts");
const rateLimitManager = await import("../../open-sse/services/rateLimitManager.ts");

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Serial queue (one slot) so a second job provably waits behind the first. */
async function applySettings(maxWaitMs: number) {
  await rateLimitManager.applyRequestQueueSettings({
    ...resilienceSettings.DEFAULT_RESILIENCE_SETTINGS.requestQueue,
    autoEnableApiKeyProviders: false,
    concurrentRequests: 1,
    requestsPerMinute: 100000,
    minTimeBetweenRequestsMs: 0,
    maxWaitMs,
  });
}

test.afterEach(async () => {
  await rateLimitManager.__resetRateLimitManagerForTests();
});

test.after(() => {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

test("a slow-RUNNING job is not killed by maxWaitMs — duration is not the queue's business", async () => {
  await applySettings(50);
  rateLimitManager.enableRateLimitProtection("conn-slow-run");

  const started = Date.now();
  const result = await rateLimitManager.withRateLimit(
    "openai",
    "conn-slow-run",
    "gpt-4o",
    async () => {
      await wait(200); // 4x maxWaitMs, but it never waited in line
      return "completed";
    }
  );

  assert.equal(result, "completed", "a job that runs long but never queued must complete");
  assert.ok(
    Date.now() - started >= 200,
    "the job must have been allowed to run to completion, not cut short"
  );
});

test("a job that WAITS past maxWaitMs is dropped", async () => {
  await applySettings(60);
  rateLimitManager.enableRateLimitProtection("conn-queued");

  // Occupy the single slot so the second job genuinely sits in the queue.
  const blocker = rateLimitManager.withRateLimit(
    "openai",
    "conn-queued",
    "gpt-4o",
    async () => {
      await wait(400);
      return "blocker";
    }
  );
  await wait(30); // let the blocker take the slot before the next one enqueues

  let caught: (Error & { code?: string }) | undefined;
  try {
    await rateLimitManager.withRateLimit("openai", "conn-queued", "gpt-4o", async () => "late");
    assert.fail("expected the queued job to be dropped after exceeding maxWaitMs");
  } catch (err) {
    caught = err as Error & { code?: string };
  }

  assert.ok(caught, "an error should have been thrown");
  assert.equal(
    caught.code,
    "RATE_LIMIT_QUEUE_TIMEOUT",
    "a queue drop must stay classifiable by callers (combo fallback, cooldown skip)"
  );
  assert.equal(await blocker, "blocker", "the job holding the slot must be unaffected");
});

test("the error reports the MEASURED wait, not just the nominal budget", async () => {
  await applySettings(60);
  rateLimitManager.enableRateLimitProtection("conn-measured");

  const blocker = rateLimitManager.withRateLimit(
    "openai",
    "conn-measured",
    "gpt-4o",
    async () => {
      await wait(400);
      return "blocker";
    }
  );
  await wait(30);

  let caught: Error | undefined;
  try {
    await rateLimitManager.withRateLimit("openai", "conn-measured", "gpt-4o", async () => "late");
    assert.fail("expected a queue drop");
  } catch (err) {
    caught = err as Error;
  }
  await blocker;

  assert.ok(caught);
  // The old message hardcoded the knob value ("maxWaitMs (15000ms)") and claimed
  // a budget that was never enforced. It must now state what actually happened.
  const measured = caught.message.match(/waited\s+(\d+)ms/i);
  assert.ok(measured, `message should report the measured wait, got: ${caught.message}`);
  assert.ok(
    Number(measured[1]) >= 60,
    `measured wait (${measured[1]}ms) should exceed the 60ms budget`
  );
  assert.match(caught.message, /maxWaitMs/, "message should still name the knob");
  assert.match(caught.message, /not an upstream/i, "message must disclaim an upstream timeout");
});

test("maxWaitMs = 0 disables the wait budget", async () => {
  await applySettings(0);
  rateLimitManager.enableRateLimitProtection("conn-disabled");

  const blocker = rateLimitManager.withRateLimit(
    "openai",
    "conn-disabled",
    "gpt-4o",
    async () => {
      await wait(200);
      return "blocker";
    }
  );
  await wait(30);

  const queued = await rateLimitManager.withRateLimit(
    "openai",
    "conn-disabled",
    "gpt-4o",
    async () => "ran-anyway"
  );

  assert.equal(queued, "ran-anyway", "with the budget off, a long wait must not drop the job");
  assert.equal(await blocker, "blocker");
});
