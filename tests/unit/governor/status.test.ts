import test from "node:test";
import assert from "node:assert/strict";
import { getGovernorStatus } from "../../../open-sse/governor/status.ts";
test("status is metadata-only and defaults active behavior off", () => { const status = getGovernorStatus(); assert.equal(status.activeEnabled, false); assert.equal(status.profile, "balanced"); assert.ok(status.queue.maxPending === 256); });
