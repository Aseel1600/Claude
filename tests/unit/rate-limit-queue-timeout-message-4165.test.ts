/**
 * #4165 — surface a clear error when the request-queue (Bottleneck) drops a job.
 *
 * OmniRoute schedules every rate-limited request through Bottleneck with
 * `{ expiration: requestQueue.maxWaitMs }` (open-sse/services/rateLimitManager.ts).
 * When a job exceeds that budget Bottleneck throws the raw message
 * `"This job timed out after <N> ms."` — which is indistinguishable from an
 * upstream gateway timeout. In #4165 an operator spent ~3h misdiagnosing local
 * queue saturation as a provider outage because the 502 body / call-log
 * `last_error` carried that upstream-looking string across many providers.
 *
 * The fix rewrites that specific Bottleneck error into a clear, OmniRoute-owned
 * message that names the knob (`resilienceSettings.requestQueue.maxWaitMs`) and
 * explicitly says it is NOT an upstream timeout, while preserving the original
 * error as `.cause` and tagging `.code = "RATE_LIMIT_QUEUE_TIMEOUT"` so callers
 * can classify it. Behavior is unchanged: the job is still dropped.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-rl-queue-timeout-"));
process.env.DATA_DIR = TEST_DATA_DIR;

const core = await import("../../src/lib/db/core.ts");
const resilienceSettings = await import("../../src/lib/resilience/settings.ts");
const rateLimitManager = await import("../../open-sse/services/rateLimitManager.ts");

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test.afterEach(async () => {
  await rateLimitManager.__resetRateLimitManagerForTests();
});

test.after(() => {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

// Drive a real queue drop: one slot, occupied, so the second job genuinely WAITS
// past maxWaitMs before it can start.
//
// This used to drive the drop with a single job that RAN longer than maxWaitMs,
// back when the knob was passed to Bottleneck as `{ expiration }`. That was the
// bug, not the feature: `expiration` is an execution deadline, so the old driver
// exercised "call was too slow" while asserting on "queue was too full" — the
// very confusion #4165 set out to end. The assertions below are unchanged; only
// the way the drop is produced was corrected.
async function triggerQueueTimeout() {
  await rateLimitManager.applyRequestQueueSettings({
    ...resilienceSettings.DEFAULT_RESILIENCE_SETTINGS.requestQueue,
    autoEnableApiKeyProviders: false,
    concurrentRequests: 1,
    requestsPerMinute: 100000,
    minTimeBetweenRequestsMs: 0,
    maxWaitMs: 40,
  });
  rateLimitManager.enableRateLimitProtection("conn-queue-timeout");

  const blocker = rateLimitManager.withRateLimit(
    "openai",
    "conn-queue-timeout",
    "gpt-4o",
    async () => {
      await wait(400);
      return "blocker";
    }
  );
  await wait(30); // let the blocker take the only slot

  try {
    return await rateLimitManager.withRateLimit(
      "openai",
      "conn-queue-timeout",
      "gpt-4o",
      async () => "should-not-reach"
    );
  } finally {
    await blocker;
  }
}

test("#4165 queue-timeout surfaces a clear OmniRoute error, not the raw upstream-looking string", async () => {
  let caught: (Error & { code?: string; cause?: { message?: string } }) | undefined;
  try {
    await triggerQueueTimeout();
    assert.fail("expected the queued job to be dropped");
  } catch (err) {
    caught = err as Error & { code?: string; cause?: { message?: string } };
  }
  assert.ok(caught, "an error should have been thrown");

  // Tagged so combo / callers can classify it as a local queue drop.
  assert.equal(caught.code, "RATE_LIMIT_QUEUE_TIMEOUT", "error must carry the queue-timeout code");

  // The surfaced message must read as a local queue limit, naming the knob,
  // and must NOT masquerade as an upstream "This job timed out" gateway error.
  assert.match(caught.message, /maxWaitMs/, "message should name the maxWaitMs knob");
  assert.match(
    caught.message,
    /not an upstream/i,
    "message should explicitly disclaim an upstream timeout"
  );
  assert.doesNotMatch(
    caught.message,
    /This job timed out/,
    "raw Bottleneck/upstream-looking string must not leak into the surfaced message"
  );

  // #4165 originally asserted that Bottleneck's raw error survived as `cause`,
  // because the drop was Bottleneck's to report and we only rewrote the wording.
  // OmniRoute now measures the queue wait itself and raises the error directly,
  // so there is no upstream-looking string to preserve — the diagnostic that
  // replaces it is the measured wait, which the raw error never carried.
  assert.match(
    caught.message,
    /waited\s+\d+ms/i,
    "the drop must report how long the job actually waited"
  );
});

test("#4165 a job that completes within maxWaitMs is unaffected", async () => {
  await rateLimitManager.applyRequestQueueSettings({
    ...resilienceSettings.DEFAULT_RESILIENCE_SETTINGS.requestQueue,
    autoEnableApiKeyProviders: false,
    concurrentRequests: 1,
    requestsPerMinute: 100000,
    minTimeBetweenRequestsMs: 0,
    maxWaitMs: 5000,
  });
  rateLimitManager.enableRateLimitProtection("conn-fast");

  const result = await rateLimitManager.withRateLimit(
    "openai",
    "conn-fast",
    "gpt-4o",
    async () => "ok"
  );
  assert.equal(result, "ok");
});
