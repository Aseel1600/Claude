import assert from "node:assert/strict";
import { test } from "node:test";
import { CircuitBreaker, STATE } from "../../src/shared/utils/circuitBreaker.ts";

test("CircuitBreaker transitions to DEGRADED on failure threshold warnings", async () => {
  const breaker = new CircuitBreaker("test-provider", {
    failureThreshold: 5,
    degradationThreshold: 3,
    resetTimeout: 10000,
  });

  assert.equal(breaker.getStatus().state, STATE.CLOSED);

  const fail = async () => {
    try {
      await breaker.execute(async () => {
        throw new Error("502 Bad Gateway");
      });
    } catch {
      /* expected */
    }
  };

  // Record 3 failures (degradation threshold)
  await fail();
  await fail();
  await fail();

  assert.equal(breaker.getStatus().state, STATE.DEGRADED);

  // Record 2 more failures -> total 5 (failure threshold)
  await fail();
  await fail();

  assert.equal(breaker.getStatus().state, STATE.OPEN);
});
