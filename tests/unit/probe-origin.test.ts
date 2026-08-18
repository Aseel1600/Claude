import { test } from "node:test";
import assert from "node:assert/strict";
import Bottleneck from "bottleneck";

const { runAsProbe, isProbeContext } = await import("../../src/shared/utils/probeOrigin.ts");

test("runAsProbe propagates through nested async/await; false outside", async () => {
  assert.equal(isProbeContext(), false);
  await runAsProbe(async () => {
    assert.equal(isProbeContext(), true);
    await Promise.resolve();
    const inner = async () => {
      await Promise.resolve();
      return isProbeContext();
    };
    assert.equal(await inner(), true);
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(isProbeContext(), true);
  });
  assert.equal(isProbeContext(), false);
});

test("queued scheduler job wrapped in runAsProbe keeps the probe context", async () => {
  const limiter = new Bottleneck({ maxConcurrent: 1, minTime: 50 });
  let insideQueuedJob: boolean | null = null;
  // Job 1 holds the limiter; the probe job gets queued (minTime 50).
  await limiter.schedule(() => new Promise((r) => setTimeout(r, 30)));
  await limiter.schedule(() =>
    runAsProbe(() => {
      insideQueuedJob = isProbeContext();
      return Promise.resolve();
    })
  );
  assert.equal(insideQueuedJob, true);
});
