import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldTripProviderBreakerForResult } from "../../src/sse/handlers/chatPredicates.ts";
import {
  recordProviderFailure,
  clearProviderFailure,
  isProviderInCooldown,
} from "../../open-sse/services/accountFallback.ts";
import { PROVIDER_PROFILES } from "../../open-sse/config/constants.ts";

// Network-layer errors and OmniRoute's own queue timeouts must NOT trip the
// provider circuit breaker. These are not provider failures — the provider never
// saw the request, so it may be perfectly healthy while only the network path is
// broken (single-model path; the combo same-provider dead-proxy case is #8376's
// contract and stays untouched).
test("proxy_unreachable errorCode does NOT trip provider breaker", () => {
  const result = shouldTripProviderBreakerForResult(
    { status: 502, errorCode: "proxy_unreachable", errorType: null, error: "ECONNREFUSED" },
    false,
    false
  );
  assert.equal(result, false);
});
test("RATE_LIMIT_QUEUE_TIMEOUT errorCode does NOT trip provider breaker", () => {
  const result = shouldTripProviderBreakerForResult(
    { status: 503, errorCode: "RATE_LIMIT_QUEUE_TIMEOUT", errorType: null, error: "queue expired" },
    false,
    false
  );
  assert.equal(result, false);
});
test("RATE_LIMIT_QUEUE_WEDGED errorCode does NOT trip provider breaker", () => {
  const result = shouldTripProviderBreakerForResult(
    { status: 503, errorCode: "RATE_LIMIT_QUEUE_WEDGED", errorType: null, error: "limiter wedged" },
    false,
    false
  );
  assert.equal(result, false);
});
test("genuine 502 without proxy_unreachable DOES trip provider breaker", () => {
  const result = shouldTripProviderBreakerForResult(
    { status: 502, errorCode: null, errorType: null, error: "upstream error" },
    false,
    false
  );
  assert.equal(result, true);
});
test("genuine 503 without queue timeout DOES trip provider breaker", () => {
  const result = shouldTripProviderBreakerForResult(
    { status: 503, errorCode: null, errorType: null, error: "service unavailable" },
    false,
    false
  );
  assert.equal(result, true);
});
test("isCombo=true prevents breaker trip regardless of error", () => {
  const result = shouldTripProviderBreakerForResult(
    { status: 502, errorCode: null, errorType: null, error: "upstream error" },
    true,
    false
  );
  assert.equal(result, false);
});
test("forceLiveComboTest=true prevents breaker trip (combo will try next target)", () => {
  const result = shouldTripProviderBreakerForResult(
    { status: 502, errorCode: null, errorType: null, error: "upstream error" },
    false,
    true
  );
  assert.equal(result, false);
});

test("queue-timeout recordProviderFailure never opens the provider breaker", () => {
  // Control first: that many real failures WOULD open the breaker — proving the
  // isQueueTimeout flag, not an inert provider, is what keeps it closed.
  const control = "test-qt-control-provider";
  clearProviderFailure(control);
  const threshold = PROVIDER_PROFILES.apikey.circuitBreakerThreshold;
  for (let i = 0; i < threshold; i++) {
    recordProviderFailure(control, undefined, undefined, null, {});
  }
  assert.equal(isProviderInCooldown(control), true, "sanity: real failures open the breaker");

  // The queue-timeout path must never reach the breaker, no matter how many fire.
  const provider = "test-qt-provider";
  clearProviderFailure(provider);
  for (let i = 0; i < threshold; i++) {
    recordProviderFailure(provider, undefined, undefined, null, { isQueueTimeout: true });
  }
  assert.equal(isProviderInCooldown(provider), false, "queue timeouts must not open the breaker");
});