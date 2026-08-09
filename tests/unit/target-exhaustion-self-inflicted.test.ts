/**
 * #1731v2 must not exhaust a connection over a failure OmniRoute inflicted on itself.
 *
 * `markConnectionLevelExhaustion` treats any 408/5xx as evidence that the provider
 * connection is bad and skips every remaining target on that connection for the
 * rest of the request. That is right for a real connection error — and wrong for
 * the two cases where the provider never rejected anything: our own request queue
 * dropping a job (503 + `local_queue_timeout`) and our own deadline firing while
 * the upstream was still working (504 + `upstream_timeout`).
 *
 * Production, 2026-08-08 (24h): the connection-cooldown and model-lockout layers
 * already spare these cases, but `#1731v2` fired 7 times and cost 2 requests their
 * untried fallback. At 16:08:18 a queue drop on deepseek-v4-flash skipped BOTH
 * remaining targets (glm-4.7-flash, mimo-v2.5) and returned "All models failed" —
 * with two healthy models sitting unused on the same connection.
 *
 * The predicate is shared with the cooldown layer (`isSelfInflictedFailure`) so the
 * two resilience layers cannot drift apart on what counts as our own fault.
 */
import test from "node:test";
import assert from "node:assert/strict";

const { applyComboTargetExhaustion } = await import(
  "../../open-sse/services/combo/targetExhaustion.ts"
);

const PROVIDER = "openai-compatible-chat-6775f68a";
const CONN = "021cd8d3-a95a-4a0a-8bf1-cb9f5bc7a676";

function createSets() {
  return {
    exhaustedProviders: new Set<string>(),
    exhaustedConnections: new Set<string>(),
    transientRateLimitedProviders: new Set<string>(),
  };
}

const silentLog = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

/** Runs the real decision point and reports whether the connection got skipped. */
function applyFailure(opts: {
  status: number;
  errorType?: string;
  provider?: string;
  errorText?: string;
}) {
  const sets = createSets();
  applyComboTargetExhaustion(
    {
      provider: opts.provider ?? PROVIDER,
      connectionId: CONN,
      model: "deepseek-v4-flash",
    } as Parameters<typeof applyComboTargetExhaustion>[0],
    {
      result: { status: opts.status, headers: null },
      fallbackResult: { shouldFallback: true } as Parameters<
        typeof applyComboTargetExhaustion
      >[1]["fallbackResult"],
      errorText: opts.errorText ?? "",
      rawModel: "deepseek-v4-flash",
      isTokenLimitBreach: false,
      allAccountsRateLimited: false,
      sets,
      log: silentLog,
      tag: "COMBO",
      exhaustedLogLevel: "info",
      structuredError: opts.errorType ? { type: opts.errorType } : undefined,
    }
  );
  return sets.exhaustedConnections.has(`${opts.provider ?? PROVIDER}:${CONN}`);
}

test("a local queue drop does not skip the sibling targets", () => {
  assert.equal(
    applyFailure({ status: 503, errorType: "local_queue_timeout" }),
    false,
    "the request never reached the provider — the connection is healthy and its other models must stay eligible"
  );
});

test("our own deadline timeout does not skip the sibling targets", () => {
  assert.equal(
    applyFailure({ status: 504, errorType: "upstream_timeout" }),
    false,
    "we stopped waiting; the provider did not reject anything"
  );
});

test("a genuine provider 503 still exhausts the connection", () => {
  assert.equal(
    applyFailure({ status: 503, errorText: "Service Unavailable" }),
    true,
    "a real upstream 503 must keep skipping the connection's remaining targets"
  );
});

test("a genuine connection 502 still exhausts the connection", () => {
  assert.equal(
    applyFailure({ status: 502, errorText: "Bad Gateway" }),
    true,
    "a real connection-level error must keep its existing behavior"
  );
});

test("antigravity keeps its own pre-response-timeout policy on 504", () => {
  assert.equal(
    applyFailure({ status: 504, errorType: "upstream_timeout", provider: "antigravity" }),
    true,
    "antigravity owns its timeout handling — the 504 exception must not apply to it"
  );
});

test("the queue drop has no antigravity exception — the queue is ours for everyone", () => {
  assert.equal(
    applyFailure({ status: 503, errorType: "local_queue_timeout", provider: "antigravity" }),
    false,
    "the local queue belongs to OmniRoute for every provider alike"
  );
});
