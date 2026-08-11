import test from "node:test";
import assert from "node:assert/strict";
import { getGovernorStatus } from "../../../open-sse/governor/status.ts";
test("status is metadata-only and defaults active behavior off", () => {
  const status = getGovernorStatus();
  assert.equal(status.activeEnabled, false);
  assert.equal(status.profile, "balanced");
  assert.equal(status.queue.maxPending, 256);
  assert.equal(typeof status.breakerCooldownMs, "number");
  assert.equal(status.breakerOpenedAt, null);
  assert.equal(status.breakerHalfOpenProbeInFlight, false);
});
