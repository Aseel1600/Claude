import test from "node:test";
import assert from "node:assert/strict";

const { ChatGptWebExecutor, __resetChatGptWebCachesForTesting } =
  await import("../../open-sse/executors/chatgpt-web.ts");
const { __setTlsFetchOverrideForTesting, TlsClientHangError } =
  await import("../../open-sse/services/chatgptTlsClient.ts");
type TlsFetchOptions = import("../../open-sse/services/chatgptTlsClient.ts").TlsFetchOptions;
type ExecuteInput = import("../../open-sse/executors/base.ts").ExecuteInput;
const { OMNIROUTE_ATTEMPT_RECEIPTS_RESPONSE_HEADER, computeAccountLaneHash } =
  await import("../../open-sse/services/runsteadAttemptReceipts.ts");

const CONNECTION_ID = "conn-123";
const PINNED_CONNECTION_ID = "conn-123";
const CLIENT_REQUEST_ID = "runstead-req-1";
const MODEL = "gpt-5.3-instant";
const CANONICAL_MODEL = "chatgpt-web/gpt-5.3-instant";

function makeHeaders(map: Record<string, string> = {}) {
  const h = new Headers();
  for (const [k, v] of Object.entries(map)) h.set(k, String(v));
  return h;
}

function streamText(parts: string[] = ["Hello, world!"]) {
  const chunks = parts.map(
    (part) =>
      `data: ${JSON.stringify({
        conversation_id: "conv-1",
        message: {
          id: "msg-1",
          author: { role: "assistant" },
          content: { content_type: "text", parts: [part] },
          status: "finished_successfully",
        },
      })}\r\n\r\n`
  );
  chunks.push("data: [DONE]\r\n\r\n");
  return chunks.join("");
}

type ConvBehavior = { status: number; text?: string } | { throwError: unknown } | { abort: true };

function installMock(convBehavior: ConvBehavior = { status: 200 }) {
  const calls = { session: 0, sentinel: 0, conv: 0, urls: [] as string[] };
  __setTlsFetchOverrideForTesting(async (url: string, opts: TlsFetchOptions = {}) => {
    // Mirror the real tlsFetchChatGpt: an already-aborted signal throws
    // before any request is issued.
    if (opts.signal?.aborted) {
      const err = new Error("The operation was aborted");
      err.name = "AbortError";
      throw err;
    }
    const u = String(url);
    calls.urls.push(u);
    if ((u === "https://chatgpt.com/" || u === "https://chatgpt.com") && !opts.method) {
      return {
        status: 200,
        headers: makeHeaders({ "Content-Type": "text/html" }),
        text: '<html data-build="prod-test123"><script src="https://cdn.oaistatic.com/_next/static/chunks/main-test.js"></script></html>',
        body: null,
      };
    }
    if (u.includes("/api/auth/session")) {
      calls.session++;
      return {
        status: 200,
        headers: makeHeaders({ "Content-Type": "application/json" }),
        text: JSON.stringify({
          accessToken: "jwt-abc",
          expires: new Date(Date.now() + 3600_000).toISOString(),
          user: { id: "user-1" },
        }),
        body: null,
      };
    }
    if (u.includes("/sentinel/chat-requirements")) {
      calls.sentinel++;
      return {
        status: 200,
        headers: makeHeaders({ "Content-Type": "application/json" }),
        text: JSON.stringify({ token: "req-token", proofofwork: { required: false } }),
        body: null,
      };
    }
    if (u.includes("/backend-api/f/conversation")) {
      calls.conv++;
      if ("throwError" in convBehavior) throw convBehavior.throwError;
      if ("abort" in convBehavior) {
        const err = new Error("The operation was aborted");
        err.name = "AbortError";
        throw err;
      }
      return {
        status: convBehavior.status,
        headers: makeHeaders({ "Content-Type": "text/event-stream" }),
        text: "text" in convBehavior ? convBehavior.text : streamText(),
        body: null,
      };
    }
    return {
      status: 404,
      headers: makeHeaders(),
      text: "not mocked",
      body: null,
    };
  });
  return {
    calls,
    restore() {
      __setTlsFetchOverrideForTesting(null);
    },
  };
}

function strictInput(overrides: Partial<ExecuteInput> = {}): ExecuteInput {
  return {
    model: MODEL,
    body: { messages: [{ role: "user", content: "hi" }] },
    stream: false,
    credentials: { apiKey: "test-cookie-value", connectionId: CONNECTION_ID },
    signal: AbortSignal.timeout(10_000),
    log: null,
    attemptReceiptStrict: {
      clientRequestId: CLIENT_REQUEST_ID,
      pinnedConnectionId: PINNED_CONNECTION_ID,
      canonicalModel: CANONICAL_MODEL,
    },
    ...overrides,
  };
}

function receiptOf(result: { response: Response }): Record<string, unknown> {
  const raw = result.response.headers.get(OMNIROUTE_ATTEMPT_RECEIPTS_RESPONSE_HEADER);
  assert.ok(raw, "response must carry the X-OmniRoute-Attempt-Receipts header");
  return JSON.parse(raw!);
}

function noReceiptOf(result: { response: Response }): void {
  assert.equal(result.response.headers.get(OMNIROUTE_ATTEMPT_RECEIPTS_RESPONSE_HEADER), null);
}

function reset() {
  __resetChatGptWebCachesForTesting();
}

// ─── A. SUCCESS ─────────────────────────────────────────────────────────────

test("strict receipt: success produces exactly one receipt at the POST boundary", async () => {
  reset();
  const m = installMock();
  try {
    const executor = new ChatGptWebExecutor();
    const result = await executor.execute(strictInput());
    assert.equal(result.response.status, 200);
    assert.equal(m.calls.conv, 1);

    const set = receiptOf(result);
    assert.equal(set.schema_version, 1);
    assert.equal(set.finalized, true);
    assert.equal(set.client_request_id, CLIENT_REQUEST_ID);
    assert.equal(set.receipts.length, 1);

    const r = set.receipts[0];
    assert.equal(r.schema_version, 1);
    assert.ok(typeof r.attempt_id === "string" && r.attempt_id.length > 0);
    assert.equal(r.client_request_id, CLIENT_REQUEST_ID);
    assert.equal(r.sequence, 1);
    assert.equal(r.provider, "chatgpt-web");
    assert.equal(r.model, CANONICAL_MODEL);
    assert.equal(r.account_lane_hash, computeAccountLaneHash(CONNECTION_ID));
    assert.equal(r.outcome, "success");
    assert.equal(r.trigger, "initial");
    assert.equal(r.upstream_reached, true);
    assert.ok(Date.parse(r.started_at) <= Date.parse(r.completed_at));
  } finally {
    m.restore();
  }
});

test("strict receipt: lane hash derives from the REAL connection used", async () => {
  reset();
  const m = installMock();
  try {
    const executor = new ChatGptWebExecutor();
    const result = await executor.execute(strictInput());
    const set = receiptOf(result);
    assert.equal(set.receipts[0].account_lane_hash, computeAccountLaneHash("conn-123"));
    // A different connection must produce a different hash (never hardcoded).
    assert.notEqual(set.receipts[0].account_lane_hash, computeAccountLaneHash("conn-999"));
  } finally {
    m.restore();
  }
});

// ─── B. NO AMPLIFICATION ────────────────────────────────────────────────────

test("strict receipt: upstream 401 → exactly one POST + authentication_expired", async () => {
  reset();
  const m = installMock({ status: 401 });
  try {
    const executor = new ChatGptWebExecutor();
    const result = await executor.execute(strictInput());
    assert.equal(result.response.status, 401);
    assert.equal(m.calls.conv, 1);
    const set = receiptOf(result);
    assert.equal(set.receipts.length, 1);
    assert.equal(set.receipts[0].outcome, "authentication_expired");
    assert.equal(set.receipts[0].upstream_reached, true);
  } finally {
    m.restore();
  }
});

test("strict receipt: upstream 403 → exactly one POST + http_403", async () => {
  reset();
  const m = installMock({ status: 403 });
  try {
    const executor = new ChatGptWebExecutor();
    const result = await executor.execute(strictInput());
    assert.equal(result.response.status, 403);
    assert.equal(m.calls.conv, 1);
    assert.equal(receiptOf(result).receipts[0].outcome, "http_403");
  } finally {
    m.restore();
  }
});

test("strict receipt: upstream 429 → exactly one POST + rate_or_capacity", async () => {
  reset();
  const m = installMock({ status: 429 });
  try {
    const executor = new ChatGptWebExecutor();
    const result = await executor.execute(strictInput());
    assert.equal(result.response.status, 429);
    assert.equal(m.calls.conv, 1);
    assert.equal(receiptOf(result).receipts[0].outcome, "rate_or_capacity");
  } finally {
    m.restore();
  }
});

test("strict receipt: upstream 500 → exactly one POST + upstream_server_failure", async () => {
  reset();
  const m = installMock({ status: 500 });
  try {
    const executor = new ChatGptWebExecutor();
    const result = await executor.execute(strictInput());
    assert.equal(result.response.status, 500);
    assert.equal(m.calls.conv, 1);
    assert.equal(receiptOf(result).receipts[0].outcome, "upstream_server_failure");
  } finally {
    m.restore();
  }
});

test("strict receipt: transport throw → exactly one POST + conservative outcome", async () => {
  reset();
  const m = installMock({ throwError: new Error("network down") });
  try {
    const executor = new ChatGptWebExecutor();
    const result = await executor.execute(strictInput());
    assert.equal(result.response.status, 502);
    assert.equal(m.calls.conv, 1);
    assert.equal(receiptOf(result).receipts[0].outcome, "transport_error");
  } finally {
    m.restore();
  }
});

test("strict receipt: TLS hang → timeout outcome", async () => {
  reset();
  const m = installMock({ throwError: new TlsClientHangError("binding deadlocked") });
  try {
    const executor = new ChatGptWebExecutor();
    const result = await executor.execute(strictInput());
    assert.equal(m.calls.conv, 1);
    assert.equal(receiptOf(result).receipts[0].outcome, "timeout");
  } finally {
    m.restore();
  }
});

test("strict receipt: mid-flight abort → cancelled outcome", async () => {
  reset();
  const m = installMock({ abort: true });
  try {
    const executor = new ChatGptWebExecutor();
    const result = await executor.execute(strictInput());
    assert.equal(m.calls.conv, 1);
    assert.equal(receiptOf(result).receipts[0].outcome, "cancelled");
  } finally {
    m.restore();
  }
});

// ─── C. CONNECTION PIN ──────────────────────────────────────────────────────

test("strict receipt: pinned connection mismatch fails closed before POST", async () => {
  reset();
  const m = installMock();
  try {
    const executor = new ChatGptWebExecutor();
    const result = await executor.execute(
      strictInput({
        attemptReceiptStrict: {
          clientRequestId: CLIENT_REQUEST_ID,
          pinnedConnectionId: "conn-999",
          canonicalModel: CANONICAL_MODEL,
        },
      })
    );
    assert.equal(result.response.status, 400);
    assert.equal(m.calls.conv, 0);
    noReceiptOf(result);
  } finally {
    m.restore();
  }
});

// ─── E. TEXT-ONLY ───────────────────────────────────────────────────────────

test("strict receipt: stream=true rejected before POST, no receipt", async () => {
  reset();
  const m = installMock();
  try {
    const executor = new ChatGptWebExecutor();
    const result = await executor.execute(
      strictInput({ stream: true, body: { messages: [{ role: "user", content: "hi" }] } })
    );
    assert.equal(result.response.status, 400);
    assert.equal(m.calls.conv, 0);
    noReceiptOf(result);
  } finally {
    m.restore();
  }
});

test("strict receipt: tools rejected before POST, no receipt", async () => {
  reset();
  const m = installMock();
  try {
    const executor = new ChatGptWebExecutor();
    const result = await executor.execute(
      strictInput({
        body: {
          messages: [{ role: "user", content: "hi" }],
          tools: [{ type: "function", function: { name: "lookup", parameters: {} } }],
        },
      })
    );
    assert.equal(result.response.status, 400);
    assert.equal(m.calls.conv, 0);
    noReceiptOf(result);
  } finally {
    m.restore();
  }
});

test("strict receipt: image-gen intent rejected before POST, no receipt", async () => {
  reset();
  const m = installMock();
  try {
    const executor = new ChatGptWebExecutor();
    const result = await executor.execute(
      strictInput({
        body: { messages: [{ role: "user", content: "draw a kitten" }] },
      })
    );
    assert.equal(result.response.status, 400);
    assert.equal(m.calls.conv, 0);
    noReceiptOf(result);
  } finally {
    m.restore();
  }
});

// ─── F. ERRORS / UNCERTAINTY ────────────────────────────────────────────────

test("strict receipt: pre-POST failure never fabricates a receipt", async () => {
  reset();
  const m = installMock();
  try {
    const executor = new ChatGptWebExecutor();
    // No apiKey (cookie) → fails before any POST.
    const result = await executor.execute(
      strictInput({
        credentials: { connectionId: CONNECTION_ID },
      })
    );
    assert.equal(result.response.status, 401);
    assert.equal(m.calls.conv, 0);
    noReceiptOf(result);
  } finally {
    m.restore();
  }
});

test("strict receipt: already-aborted signal before POST → no receipt", async () => {
  reset();
  const m = installMock();
  try {
    const ctrl = new AbortController();
    ctrl.abort();
    const executor = new ChatGptWebExecutor();
    const result = await executor.execute(strictInput({ signal: ctrl.signal }));
    assert.equal(m.calls.conv, 0);
    noReceiptOf(result);
  } finally {
    m.restore();
  }
});

test("strict receipt: empty 2xx body → empty_response outcome", async () => {
  reset();
  const m = installMock({ status: 200, text: "" });
  try {
    const executor = new ChatGptWebExecutor();
    const result = await executor.execute(strictInput());
    assert.equal(result.response.status, 502);
    assert.equal(m.calls.conv, 1);
    assert.equal(receiptOf(result).receipts[0].outcome, "empty_response");
  } finally {
    m.restore();
  }
});

// ─── G. REDACTION ───────────────────────────────────────────────────────────

test("strict receipt: no cookie, token, prompt or raw connection id leaks", async () => {
  reset();
  const m = installMock();
  try {
    const executor = new ChatGptWebExecutor();
    const result = await executor.execute(strictInput());
    const raw = result.response.headers.get(OMNIROUTE_ATTEMPT_RECEIPTS_RESPONSE_HEADER);
    assert.ok(raw);
    assert.ok(!raw!.includes("test-cookie-value"));
    assert.ok(!raw!.includes("jwt-abc"));
    assert.ok(!raw!.includes("conn-123"));
    assert.ok(!raw!.includes("Bearer"));
    assert.ok(!raw!.includes("hi"));
    assert.ok(!raw!.includes("Hello, world!"));
  } finally {
    m.restore();
  }
});

// ─── H. NON OPT-IN ──────────────────────────────────────────────────────────

test("non opt-in: normal request keeps prior behavior, no receipt header", async () => {
  reset();
  const m = installMock();
  try {
    const executor = new ChatGptWebExecutor();
    const input = strictInput({ attemptReceiptStrict: null });
    const result = await executor.execute(input);
    assert.equal(result.response.status, 200);
    assert.equal(m.calls.conv, 1);
    assert.equal(m.calls.session, 1);
    assert.equal(m.calls.sentinel, 1);
    noReceiptOf(result);
    const body = await result.response.text();
    assert.ok(body.includes("Hello, world!"));
  } finally {
    m.restore();
  }
});

test("non opt-in: upstream 429 still returns 429 without receipt (no behavior change)", async () => {
  reset();
  const m = installMock({ status: 429 });
  try {
    const executor = new ChatGptWebExecutor();
    const result = await executor.execute(strictInput({ attemptReceiptStrict: null }));
    assert.equal(result.response.status, 429);
    assert.equal(m.calls.conv, 1);
    noReceiptOf(result);
  } finally {
    m.restore();
  }
});
