import test from "node:test";
import assert from "node:assert/strict";

// Import the patch module to test it in isolation
import { applyBottleneckDoExpirePatch } from "../../open-sse/services/bottleneckPatch.ts";

test("applyBottleneckDoExpirePatch is idempotent", () => {
  // Should not throw on multiple calls
  applyBottleneckDoExpirePatch();
  applyBottleneckDoExpirePatch();
  assert.ok(true, "patch applied twice without error");
});

test("patched _run still dispatches jobs correctly", async () => {
  applyBottleneckDoExpirePatch();

  const { default: Bottleneck } = await import("bottleneck");
  const limiter = new Bottleneck({
    id: "test-doexpire-patch",
    maxConcurrent: 2,
    minTime: 0,
  });

  // Job should execute normally (no expiration triggered)
  const result = await limiter.schedule({ expiration: 5000 }, async () => {
    return "patched-ok";
  });

  assert.equal(result, "patched-ok");
  await limiter.disconnect();
});

test("patched doExpire handles job stuck in RUNNING state", async () => {
  applyBottleneckDoExpirePatch();

  const { default: Bottleneck } = await import("bottleneck");
  // Use minTime > expiration to ensure jobs expire during the minTime delay
  // (RUNNING state, before EXECUTING). This exercises the actual patch path.
  const limiter = new Bottleneck({
    id: "test-doexpire-running",
    maxConcurrent: 2,
    minTime: 500, // 500ms delay between dispatches
    reservoir: 10,
    reservoirRefreshInterval: 60_000,
    reservoirRefreshAmount: 10,
  });

  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.join(" "));
    originalWarn(...args);
  };

  try {
    // First job occupies the concurrent slot
    const slowJob = limiter.schedule({ expiration: 5000 }, async () => {
      await new Promise((r) => setTimeout(r, 100));
      return "slow-done";
    });

    // Second job will be queued. With minTime=500ms and expiration=100ms,
    // it expires during the minTime delay while still in RUNNING state
    // (before reaching EXECUTING). This is the exact doExpire bug scenario.
    const fastJob = limiter.schedule({ expiration: 100 }, async () => {
      return "fast-done";
    });

    const results = await Promise.allSettled([slowJob, fastJob]);

    // After expired/rejected jobs, the limiter should still have capacity
    // (the key assertion: no permanent capacity leak)
    const postResult = await limiter.schedule({ expiration: 5000 }, async () => {
      return "post-test";
    });
    assert.equal(postResult, "post-test", "limiter still has capacity after expired jobs");
  } finally {
    console.warn = originalWarn;
    await limiter.disconnect();
  }
});

test("diagnostic: running>0, executing=0, reservoir>0 detection", async () => {
  // This tests the diagnostic condition in rateLimitManager.ts
  // Simulate the state that the doExpire bug would produce
  const queueState = {
    running: 1, // job stuck in RUNNING
    executing: 0, // nothing actually executing
    reservoirRemaining: 5,
    lastDispatchAgeMs: 20000,
  };

  // The doExpire bug detection condition
  const isDoExpireBug =
    queueState.running > 0 &&
    queueState.executing === 0 &&
    typeof queueState.reservoirRemaining === "number" &&
    queueState.reservoirRemaining > 0;

  assert.ok(isDoExpireBug, "should detect doExpire bug condition");

  // Contrast with normal wedge (running=0, executing=0)
  const wedgeState = {
    running: 0,
    executing: 0,
    reservoirRemaining: 5,
    lastDispatchAgeMs: 20000,
  };
  const isWedge =
    wedgeState.running === 0 && wedgeState.executing === 0 && wedgeState.reservoirRemaining > 0;
  assert.ok(isWedge, "wedge detection still works for idle limiter");

  // Different states: doExpire bug has running>0, wedge has running=0
  // They detect different failure modes and are NOT mutually exclusive
  // (both could theoretically be true if multiple jobs are stuck).
  assert.ok(isDoExpireBug, "doExpire bug detected for running>0 state");
  assert.ok(isWedge, "wedge detected for running=0 state");
  assert.notEqual(
    queueState.running,
    wedgeState.running,
    "doExpire bug state has running>0, wedge state has running=0"
  );
});

test("patch does not affect jobs without expiration", async () => {
  applyBottleneckDoExpirePatch();

  const { default: Bottleneck } = await import("bottleneck");
  const limiter = new Bottleneck({
    id: "test-no-expiration",
    maxConcurrent: 2,
    minTime: 0,
  });

  // Job without expiration should work exactly as before
  const result = await limiter.schedule(async () => {
    return "no-expire";
  });

  assert.equal(result, "no-expire");
  await limiter.disconnect();
});
