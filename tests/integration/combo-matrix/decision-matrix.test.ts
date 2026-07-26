// tests/integration/combo-matrix/decision-matrix.test.ts
//
// Integration tests for the response-driven combo advance/stop decision.
//
// The combo router examines each upstream response and decides whether to:
//   - continue advancing to the next connection (e.g. a model-scoped 400 —
//     try the next provider because the model isn't supported on this one)
//   - stop and surface the error (e.g. a 401 unauthorized — failing here
//     means no amount of provider rotation will rescue the request)
//   - retry the same connection then stop (e.g. a 429 — give backoff a
//     chance, then surface the failure)
//
// These tests pin the canonical contract against `release/v3.8.49` so that
// future changes to the response-classification logic cannot silently
// regress the contract. Each case is a single-request, deterministic
// integration test using the same `createComboRoutingHarness` fixture as
// the sibling tests in this directory.
//
// History: this contract has been reshaped by #2101, #4279, #5249, #8251,
// #8252 (and earlier bug fixes). The matrix below captures the post-#8252
// invariant. Roadmap 3.8.51 calls for this matrix to become a CI gate.
//
// How the tests work:
//   - We seed two connections (openai, claude) so the combo has a real
//     "next" candidate to advance to.
//   - `h.installRecordingFetch()` records dispatched requests so we can
//     tell which providers were actually contacted.
//   - `h.failure(status, body)` is the harness's helper to script a
//     specific upstream response shape for a given dispatch.
//   - `BaseExecutor.RETRY_CONFIG.delayMs = 0` keeps the test fast.
//
// What the assertion surface is:
//   - "advance"   → both providers were dispatched, the second one's
//                   response (or the harness's terminal success) is what
//                   the caller sees.
//   - "stop"      → only the first provider was dispatched, the harness
//                   surfaces that error to the caller.
//   - "retry"     → same provider was dispatched at least twice before
//                   the harness stopped.

import test from "node:test";
import assert from "node:assert/strict";
import { createComboRoutingHarness } from "../_comboRoutingHarness.ts";

const h = await createComboRoutingHarness("combo-decision-matrix");
const { BaseExecutor, handleChat, buildRequest, seedConnection, resetStorage, settingsDb } = h;

function body(model: string) {
  return {
    model,
    stream: false,
    messages: [{ role: "user", content: "hello" }],
  };
}

// No-auth providers (synthetic credentials) would otherwise pollute the
// candidate pool and make dispatch non-deterministic. The siblings in this
// directory already block them via settings.blockedProviders; we do the same.
const NO_AUTH_PROVIDER_IDS = [
  "opencode",
  "duckduckgo-web",
  "felo-web",
  "theoldllm",
  "chipotle",
  "veoaifree-web",
  "mimocode",
  "auggie",
];

test.beforeEach(async () => {
  BaseExecutor.RETRY_CONFIG.delayMs = 0;
  await resetStorage();
  await settingsDb.updateSettings({ blockedProviders: NO_AUTH_PROVIDER_IDS });
});
test.afterEach(async () => {
  BaseExecutor.RETRY_CONFIG.delayMs = h.originalRetryDelayMs;
  await resetStorage();
});
test.after(async () => {
  await h.cleanup();
});

// ── Case 1: model-scoped 400 — combo must advance to the next provider ──────
//
// ── Case 2: 400 with model-scoped body — combo must advance to next provider ────
//
// The contract is: a 400 whose body explicitly says "model X not supported"
// means *this provider* does not support the requested model. Advancing to
// the next provider in the combo (where the same model might be supported)
// is the correct behavior. This is the historical bug fixed by #8252.
//
// If this test fails, the response-classification logic has regressed and
// the user is seeing a 400 instead of getting a successful response from
// a provider that does support their model.
//
// KNOWN ISSUE: at chat.ts:1340, `PROVIDER_BREAKER_FAILURE_STATUSES` is
// referenced but never imported (it lives in comboPredicates.ts:127).
// Running this test currently throws `ReferenceError: ... is not defined`,
// which is a real upstream bug. Tracking it separately in PR-β finding #1;
// the test is left enabled so CI catches it.
test("400 model-scoped: combo advances to the next provider", async () => {
  await seedConnection("openai", { apiKey: "sk-openai-400m" });
  await seedConnection("claude", { apiKey: "sk-claude-400m" });

  h.installRecordingFetch({
    openai: { status: 400, body: "invalid_request_error: model X not supported" },
  });

  const r = await handleChat(buildRequest({ body: body("gpt-4") }));
  assert.equal(r.status, 200, `Expected 200 from claude (advance), got ${r.status}`);

  const seen = h.providersSeen();
  assert.deepEqual(
    seen,
    ["openai", "claude"],
    `Expected [openai, claude] (advance), got: ${JSON.stringify(seen)}`
  );
});

// ── Case 2: 401 unauthorized — combo must stop and surface the error ─────────
//
// The contract is: a 401 means the connection is not authenticated, and
// no other provider can rescue that. The combo must stop and the caller
// must see the 401.
//
// If this test fails, the combo is now spending budget retrying 401s
// across providers — which burns rate limits and adds latency without
// any chance of success.
test("401 unauthorized: combo stops and surfaces the error", async () => {
  await seedConnection("openai", { apiKey: "sk-openai-401" });
  await seedConnection("claude", { apiKey: "sk-claude-401" });

  h.installRecordingFetch({
    openai: { status: 401, body: "Unauthorized" },
  });

  const r = await handleChat(buildRequest({ body: body("gpt-4") }));
  assert.equal(r.status, 401, `Expected 401 surfaced, got ${r.status}`);

  const seen = h.providersSeen();
  assert.deepEqual(
    seen,
    ["openai"],
    `Expected only openai dispatched, got: ${JSON.stringify(seen)}`
  );
});

// ── Case 3: 429 rate limit — combo must retry the same provider then stop ────
//
// The contract is: a 429 is a transient backoff signal. The combo must
// retry the same provider (giving backoff a chance) and then surface
// the 429 if retries are exhausted.
//
// If this test fails, the combo is either skipping the retry (and
// burning rate limits by hammering user-visible errors) or never
// surfacing the 429 (and silently failing for the user).
test("429 rate limit: combo retries the same provider then surfaces the error", async () => {
  await seedConnection("openai", { apiKey: "sk-openai-429" });
  await seedConnection("claude", { apiKey: "sk-claude-429" });

  h.installRecordingFetch({
    openai: { status: 429, body: "Rate limit reached" },
  });

  const r = await handleChat(buildRequest({ body: body("gpt-4") }));
  assert.equal(r.status, 429, `Expected 429 surfaced, got ${r.status}`);

  const seen = h.providersSeen();
  // The retry contract: at least 2 dispatches to openai, then stop.
  // (advance to claude would require the response to be classified as
  //  retryable AND the next pool entry to be retried, which is not
  //  the case for 429 — see #5249.)
  assert.ok(
    seen.length >= 2 && seen[0] === "openai" && !seen.includes("claude"),
    `Expected openai-only retry-then-stop, got: ${JSON.stringify(seen)}`
  );
});

// ── Case 4: 400 with generic body — combo must stop on the first provider ────
//
// The contract is: a 400 whose body is NOT model-scoped (e.g. "empty
// body" or "invalid message format") means the request itself is
// broken. Advancing to another provider would just hit the same bug.
// The combo must stop and surface the 400.
//
// If this test fails, the response-classification logic is now treating
// generic 400s as model-scoped and would cycle through every provider
// before failing — wasting the user's quota.
test("400 with generic body: combo stops on the first provider", async () => {
  await seedConnection("openai", { apiKey: "sk-openai-400g" });
  await seedConnection("claude", { apiKey: "sk-claude-400g" });

  h.installRecordingFetch({
    openai: { status: 400, body: "Bad Request: empty body" },
  });

  const r = await handleChat(buildRequest({ body: body("gpt-4") }));
  assert.equal(r.status, 400, `Expected 400 surfaced, got ${r.status}`);

  const seen = h.providersSeen();
  assert.deepEqual(
    seen,
    ["openai"],
    `Expected only openai dispatched (generic 400 must not advance), got: ${JSON.stringify(seen)}`
  );
});
