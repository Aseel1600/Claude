import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const {
  RUNSTEAD_ATTEMPT_RECEIPTS_REQUEST_HEADER,
  RUNSTEAD_CLIENT_REQUEST_ID_HEADER,
  OMNIROUTE_ATTEMPT_RECEIPTS_RESPONSE_HEADER,
  computeAccountLaneHash,
  parseRunsteadStrictOptIn,
  attemptOutcomeForHttpStatus,
  buildRunsteadAttemptReceiptSet,
  withAttemptReceiptsHeader,
  getAttemptReceiptsHeader,
  validateRunsteadStrictLane,
} = await import("../../open-sse/services/runsteadAttemptReceipts.ts");

function makeHeaders(map: Record<string, string> = {}) {
  const h = new Headers();
  for (const [k, v] of Object.entries(map)) h.set(k, String(v));
  return h;
}

function optInHeaders(overrides: Record<string, string> = {}) {
  return makeHeaders({
    [RUNSTEAD_ATTEMPT_RECEIPTS_REQUEST_HEADER]: "v1",
    [RUNSTEAD_CLIENT_REQUEST_ID_HEADER]: "runstead-req-1",
    "x-omniroute-connection": "conn-123",
    ...overrides,
  });
}

// ─── account_lane_hash v1 derivation ────────────────────────────────────────

test("lane hash: known vector for conn-123", () => {
  // Precomputed with the exact v1 derivation:
  // SHA-256( UTF8("omniroute-connection-v1") || 0x00 || UTF8(connection_id) )
  assert.equal(
    computeAccountLaneHash("conn-123"),
    "33414329e042d702da4d48b44a828c9b86b0813de0f4cae2782593b3a0cdb92e"
  );
  assert.equal(computeAccountLaneHash("conn-123").length, 64);
  assert.match(computeAccountLaneHash("conn-123"), /^[0-9a-f]{64}$/);
});

test("lane hash: different connections never collide", () => {
  assert.notEqual(computeAccountLaneHash("conn-123"), computeAccountLaneHash("conn-456"));
});

test("lane hash: matches independent reference implementation", () => {
  const prefix = Buffer.from("omniroute-connection-v1", "utf8");
  const sep = Buffer.from([0x00]);
  const id = Buffer.from("conn-456", "utf8");
  const expected = createHash("sha256")
    .update(Buffer.concat([prefix, sep, id]))
    .digest("hex");
  assert.equal(computeAccountLaneHash("conn-456"), expected);
});

// ─── strict opt-in parsing ───────────────────────────────────────────────────

test("opt-in: inactive without the header (normal OmniRoute behavior)", () => {
  const result = parseRunsteadStrictOptIn({
    requestHeaders: makeHeaders(),
    body: { model: "chatgpt-web/gpt-5", messages: [] },
    modelStr: "chatgpt-web/gpt-5",
  });
  assert.deepEqual(result, { kind: "inactive" });
});

test("opt-in: inactive for any value other than exact v1", () => {
  for (const version of ["v2", "V1", "1", "true"]) {
    const result = parseRunsteadStrictOptIn({
      requestHeaders: makeHeaders({ [RUNSTEAD_ATTEMPT_RECEIPTS_REQUEST_HEADER]: version }),
      body: {},
      modelStr: "chatgpt-web/gpt-5",
    });
    assert.equal(result.kind, "inactive", `version ${JSON.stringify(version)} must be inactive`);
  }
});

test("opt-in: surrounding whitespace is trimmed (HTTP OWS semantics)", () => {
  // RFC 7230: optional whitespace around a field value is not part of it,
  // so "v1 " and " v1 " are exactly the v1 opt-in.
  const result = parseRunsteadStrictOptIn({
    requestHeaders: makeHeaders({ [RUNSTEAD_ATTEMPT_RECEIPTS_REQUEST_HEADER]: " v1 " }),
    body: {},
    modelStr: "chatgpt-web/gpt-5",
  });
  assert.equal(result.kind, "rejected"); // v1 opt-in active, missing client request id
});

test("opt-in: missing client request id fails closed", () => {
  const headers = optInHeaders();
  headers.delete(RUNSTEAD_CLIENT_REQUEST_ID_HEADER);
  const result = parseRunsteadStrictOptIn({
    requestHeaders: headers,
    body: {},
    modelStr: "chatgpt-web/gpt-5",
  });
  assert.equal(result.kind, "rejected");
  if (result.kind === "rejected") {
    assert.equal(result.status, 400);
    assert.match(result.message, /Client-Request-Id/);
  }
});

test("opt-in: empty client request id fails closed", () => {
  const result = parseRunsteadStrictOptIn({
    requestHeaders: optInHeaders({ [RUNSTEAD_CLIENT_REQUEST_ID_HEADER]: "   " }),
    body: {},
    modelStr: "chatgpt-web/gpt-5",
  });
  assert.equal(result.kind, "rejected");
});

test("opt-in: missing connection pin fails closed", () => {
  const headers = optInHeaders();
  headers.delete("x-omniroute-connection");
  const result = parseRunsteadStrictOptIn({
    requestHeaders: headers,
    body: {},
    modelStr: "chatgpt-web/gpt-5",
  });
  assert.equal(result.kind, "rejected");
  if (result.kind === "rejected") {
    assert.equal(result.status, 400);
    assert.match(result.message, /X-OmniRoute-Connection/);
  }
});

test("opt-in: non-chatgpt-web model fails closed", () => {
  for (const modelStr of ["openai/gpt-5", "gpt-5", "auto/best-fast", "chatgpt-web"]) {
    const result = parseRunsteadStrictOptIn({
      requestHeaders: optInHeaders(),
      body: { model: modelStr },
      modelStr,
    });
    assert.equal(result.kind, "rejected", `model ${modelStr} must be rejected`);
  }
});

test("opt-in: stream=true fails closed", () => {
  const result = parseRunsteadStrictOptIn({
    requestHeaders: optInHeaders(),
    body: { model: "chatgpt-web/gpt-5", stream: true },
    modelStr: "chatgpt-web/gpt-5",
  });
  assert.equal(result.kind, "rejected");
});

test("opt-in: tools fail closed", () => {
  const result = parseRunsteadStrictOptIn({
    requestHeaders: optInHeaders(),
    body: { model: "chatgpt-web/gpt-5", tools: [{ type: "function", function: { name: "x" } }] },
    modelStr: "chatgpt-web/gpt-5",
  });
  assert.equal(result.kind, "rejected");
});

test("opt-in: valid v1 request activates with exact context", () => {
  const result = parseRunsteadStrictOptIn({
    requestHeaders: optInHeaders(),
    body: { model: "chatgpt-web/gpt-5", messages: [], stream: false },
    modelStr: "chatgpt-web/gpt-5",
  });
  assert.deepEqual(result, {
    kind: "active",
    context: {
      clientRequestId: "runstead-req-1",
      pinnedConnectionId: "conn-123",
      canonicalModel: "chatgpt-web/gpt-5",
    },
  });
});

// ─── outcome mapping ─────────────────────────────────────────────────────────

test("outcome: maps observed HTTP status to Runstead v1 vocabulary", () => {
  assert.equal(attemptOutcomeForHttpStatus(200), "success");
  assert.equal(attemptOutcomeForHttpStatus(204), "success");
  assert.equal(attemptOutcomeForHttpStatus(401), "authentication_expired");
  assert.equal(attemptOutcomeForHttpStatus(403), "http_403");
  assert.equal(attemptOutcomeForHttpStatus(429), "rate_or_capacity");
  assert.equal(attemptOutcomeForHttpStatus(500), "upstream_server_failure");
  assert.equal(attemptOutcomeForHttpStatus(502), "upstream_server_failure");
  assert.equal(attemptOutcomeForHttpStatus(404), "http_error");
  assert.equal(attemptOutcomeForHttpStatus(400), "http_error");
});

// ─── receipt set construction ────────────────────────────────────────────────

test("receipt set: finalized v1 with exactly one correlated receipt", () => {
  const json = buildRunsteadAttemptReceiptSet({
    clientRequestId: "runstead-req-1",
    model: "chatgpt-web/gpt-5",
    connectionId: "conn-123",
    outcome: "success",
    startedAt: new Date("2026-08-15T12:00:00.000Z"),
    completedAt: new Date("2026-08-15T12:00:05.000Z"),
    attemptId: "attempt-abc",
  });
  const set = JSON.parse(json);
  assert.equal(set.schema_version, 1);
  assert.equal(set.client_request_id, "runstead-req-1");
  assert.equal(set.finalized, true);
  assert.equal(set.receipts.length, 1);
  const receipt = set.receipts[0];
  assert.equal(receipt.schema_version, 1);
  assert.equal(receipt.attempt_id, "attempt-abc");
  assert.equal(receipt.client_request_id, "runstead-req-1");
  assert.equal(receipt.sequence, 1);
  assert.equal(receipt.provider, "chatgpt-web");
  assert.equal(receipt.model, "chatgpt-web/gpt-5");
  assert.equal(receipt.account_lane_hash, computeAccountLaneHash("conn-123"));
  assert.equal(receipt.started_at, "2026-08-15T12:00:00.000Z");
  assert.equal(receipt.completed_at, "2026-08-15T12:00:05.000Z");
  assert.equal(receipt.outcome, "success");
  assert.equal(receipt.trigger, "initial");
  assert.equal(receipt.upstream_reached, true);
});

test("receipt set: fresh attempt_id when none provided", () => {
  const a = JSON.parse(
    buildRunsteadAttemptReceiptSet({
      clientRequestId: "r1",
      model: "chatgpt-web/gpt-5",
      connectionId: "conn-123",
      outcome: "success",
      startedAt: new Date(),
      completedAt: new Date(),
    })
  );
  const b = JSON.parse(
    buildRunsteadAttemptReceiptSet({
      clientRequestId: "r1",
      model: "chatgpt-web/gpt-5",
      connectionId: "conn-123",
      outcome: "success",
      startedAt: new Date(),
      completedAt: new Date(),
    })
  );
  assert.ok(a.receipts[0].attempt_id);
  assert.notEqual(a.receipts[0].attempt_id, b.receipts[0].attempt_id);
});

test("redaction: receipt JSON never contains raw connection id or secrets", () => {
  const json = buildRunsteadAttemptReceiptSet({
    clientRequestId: "runstead-req-1",
    model: "chatgpt-web/gpt-5",
    connectionId: "conn-123",
    outcome: "rate_or_capacity",
    startedAt: new Date(),
    completedAt: new Date(),
  });
  assert.ok(!json.includes("conn-123"));
  assert.ok(!json.includes("__Secure-next-auth"));
  assert.ok(!json.includes("Bearer"));
  assert.ok(!json.includes("prompt"));
  assert.ok(!json.includes("messages"));
});

test("header helpers: attach and read back the receipt header", () => {
  const json = buildRunsteadAttemptReceiptSet({
    clientRequestId: "runstead-req-1",
    model: "chatgpt-web/gpt-5",
    connectionId: "conn-123",
    outcome: "success",
    startedAt: new Date(),
    completedAt: new Date(),
  });
  const base = new Response("ok", { status: 200 });
  const wrapped = withAttemptReceiptsHeader(base, json);
  assert.equal(getAttemptReceiptsHeader(wrapped), json);
  assert.equal(wrapped.status, 200);
  assert.equal(wrapped.headers.get(OMNIROUTE_ATTEMPT_RECEIPTS_RESPONSE_HEADER), json);
  assert.equal(getAttemptReceiptsHeader(base), null);
});

// ─── strict lane validation ─────────────────────────────────────────────────

const laneCtx = {
  clientRequestId: "r1",
  pinnedConnectionId: "conn-123",
  canonicalModel: "chatgpt-web/gpt-5",
};

test("lane validation: exact match passes", () => {
  assert.equal(
    validateRunsteadStrictLane({
      context: laneCtx,
      provider: "chatgpt-web",
      effectiveModel: "gpt-5",
      selectedConnectionId: "conn-123",
    }),
    null
  );
});

test("lane validation: provider mismatch fails closed", () => {
  assert.ok(
    validateRunsteadStrictLane({
      context: laneCtx,
      provider: "openai",
      effectiveModel: "gpt-5",
      selectedConnectionId: "conn-123",
    })
  );
});

test("lane validation: model reroute fails closed", () => {
  assert.ok(
    validateRunsteadStrictLane({
      context: laneCtx,
      provider: "chatgpt-web",
      effectiveModel: "gpt-5-other",
      selectedConnectionId: "conn-123",
    })
  );
});

test("lane validation: connection swap fails closed", () => {
  assert.ok(
    validateRunsteadStrictLane({
      context: laneCtx,
      provider: "chatgpt-web",
      effectiveModel: "gpt-5",
      selectedConnectionId: "conn-456",
    })
  );
  assert.ok(
    validateRunsteadStrictLane({
      context: laneCtx,
      provider: "chatgpt-web",
      effectiveModel: "gpt-5",
      selectedConnectionId: null,
    })
  );
});
