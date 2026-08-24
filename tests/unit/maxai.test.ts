/**
 * Unit tests for the MaxAI executor helpers (signer, context assembly, SSE/think).
 *
 * The signer vectors are REAL captured web-app requests: computeMaxaiProof must
 * reproduce the exact `p` proof the MaxAI web app produced (decrypted from real
 * `X-Authorization` blobs, MaxAI v3 tests/fixtures/wire_signed_samples.json).
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  computeMaxaiProof,
  maxaiAesEncrypt,
  buildMaxaiSignedHeaders,
} from "../../open-sse/executors/maxai/signing.ts";
import {
  assembleMaxaiContext,
  buildMaxaiChatBody,
  contentToText,
} from "../../open-sse/executors/maxai/protocol.ts";
import {
  splitThink,
  ThinkSplitter,
  parseMaxaiSseText,
  estimateMaxaiTokens,
} from "../../open-sse/executors/maxai/stream.ts";
import { userIdFromJwt } from "../../open-sse/executors/maxai/credentials.ts";
import {
  maxaiAccessTokenNeedsRefresh,
  maxaiRefreshAccessToken,
  MAXAI_REFRESH_PATH,
} from "../../open-sse/executors/maxai/refresh.ts";
import {
  requestMaxaiEmailCode,
  verifyMaxaiEmailCode,
  MAXAI_SIGNIN_EMAIL_PATH,
  MAXAI_VERIFY_CODE_PATH,
} from "../../open-sse/executors/maxai/emailLogin.ts";

const USER_ID = "217f0819-965c-4926-8397-6059aacd2dcd";

// ── Signer: byte-exact vs real captured web-app requests ─────────────────────

test("computeMaxaiProof reproduces the real captured `p` (sample 0)", () => {
  const p = computeMaxaiProof("/conversation/get_conversation_list", 1784594159681, USER_ID);
  assert.equal(p, "3afc648d5beeb200a8292cdd274cded12bce273aa2cb0a2ae1b3aed56ca50afa");
});

test("computeMaxaiProof reproduces the real captured `p` (sample 1)", () => {
  const p = computeMaxaiProof(
    "/conversation/get_group_and_conversation_list",
    1784594159681,
    USER_ID
  );
  assert.equal(p, "503837e5569e71844a6fda7ba5229e4a75d51e8f5ea62c7663bb848e940cc2e0");
});

test("computeMaxaiProof blanks the user id only on /oauth/* routes", () => {
  // A blank-user route yields a different proof than the same route with a uid,
  // proving the uid is dropped for /oauth/* (and only there).
  const t = 1784594159681;
  const oauthWithUid = computeMaxaiProof("/oauth/signin_with_email", t, USER_ID);
  const oauthNoUid = computeMaxaiProof("/oauth/signin_with_email", t, "");
  assert.equal(oauthWithUid, oauthNoUid); // uid ignored for /oauth/*
  const chatWithUid = computeMaxaiProof("/gpt/cwc/chat", t, USER_ID);
  const chatNoUid = computeMaxaiProof("/gpt/cwc/chat", t, "");
  assert.notEqual(chatWithUid, chatNoUid); // uid honored elsewhere
});

test("maxaiAesEncrypt produces a CryptoJS Salted__ envelope, deterministic with a fixed salt", () => {
  const salt = Buffer.from("0011223344556677", "hex");
  const a = maxaiAesEncrypt("payload", undefined, salt);
  const b = maxaiAesEncrypt("payload", undefined, salt);
  assert.equal(a, b); // same salt → deterministic
  const raw = Buffer.from(a, "base64");
  assert.equal(raw.subarray(0, 8).toString("ascii"), "Salted__");
  assert.equal(raw.subarray(8, 16).toString("hex"), "0011223344556677");
  // Random salt differs each call.
  assert.notEqual(maxaiAesEncrypt("payload"), maxaiAesEncrypt("payload"));
});

test("buildMaxaiSignedHeaders emits the X-App/X-Browser companions + X-Authorization", () => {
  const h = buildMaxaiSignedHeaders({
    path: "/gpt/cwc/chat",
    userId: USER_ID,
    deviceId: "118a857e-c96f-4dfd-86ce-55ee910f748a",
    now: () => 1784594159681,
    random: () => "950484",
  });
  assert.equal(h["X-Browser-Name"], "Firefox");
  assert.equal(h["X-Browser-Version"], "150.0");
  assert.equal(h["X-App-Version"], "webpage_8.18.0");
  assert.equal(h["X-App-Env"], "MaxAI-Browser-Extension");
  assert.ok(h["X-Authorization"].length > 0);
  assert.equal(Buffer.from(h["X-Authorization"], "base64").subarray(0, 8).toString("ascii"), "Salted__");
});

// ── Context assembly ─────────────────────────────────────────────────────────

test("assembleMaxaiContext: single user turn is sent bare", () => {
  const text = assembleMaxaiContext([{ role: "user", content: "hello there" }]);
  assert.equal(text, "hello there");
});

test("assembleMaxaiContext: system leads, history labeled, current fenced last", () => {
  const text = assembleMaxaiContext([
    { role: "system", content: "You are helpful." },
    { role: "user", content: "first question" },
    { role: "assistant", content: "first answer" },
    { role: "user", content: "second question" },
  ]);
  assert.match(text, /^You are helpful\./);
  assert.match(text, /=== Conversation so far \(for context\) ===/);
  assert.match(text, /User: first question/);
  assert.match(text, /Assistant: first answer/);
  assert.match(text, /=== Current request \(respond to THIS\) ===\n\nsecond question$/);
});

test("assembleMaxaiContext: tool turns render as tool_response / tool_call blocks", () => {
  const text = assembleMaxaiContext([
    { role: "user", content: "search for X" },
    {
      role: "assistant",
      content: "",
      tool_calls: [{ function: { name: "web_search", arguments: '{"q":"X"}' } }],
    },
    { role: "tool", tool_call_id: "call_1", content: "result: found X" },
    { role: "user", content: "summarize" },
  ]);
  assert.match(text, /<tool_call>/);
  assert.match(text, /web_search/);
  assert.match(text, /<tool_response tool_call_id="call_1">/);
  assert.match(text, /result: found X/);
});

test("assembleMaxaiContext throws when there is nothing to send", () => {
  assert.throws(() => assembleMaxaiContext([]), /no content/);
});

test("contentToText flattens multipart content, dropping non-text parts", () => {
  assert.equal(contentToText("plain"), "plain");
  assert.equal(
    contentToText([
      { type: "text", text: "a" },
      { type: "image_url", image_url: { url: "x" } },
      { type: "text", text: "b" },
    ]),
    "a\nb"
  );
});

test("buildMaxaiChatBody pins field order + constants", () => {
  const body = buildMaxaiChatBody({ conversationId: "conv-1", text: "hi", modelName: "gpt-5.6" });
  const keys = Object.keys(body);
  assert.equal(keys[0], "chat_mode");
  assert.equal(keys[3], "message_content");
  assert.equal(body.chat_mode, "pro_chat");
  assert.deepEqual(body.chat_history, []);
  assert.deepEqual(body.message_content, [{ type: "text", text: "hi" }]);
  assert.equal(body.model_name, "gpt-5.6");
  assert.equal(body.streaming, true);
  assert.equal(body.platform_feature, "web_app");
});

// ── SSE / think split ────────────────────────────────────────────────────────

test("parseMaxaiSseText extracts only mergeable text frames", () => {
  const raw = [
    'data: {"data_key":"text","text":"Hello","need_merge":true}',
    "",
    'data: {"data_key":"next_action","action":{}}',
    "",
    'data: {"data_key":"text","text":" world","need_merge":true}',
    "",
    "data: [DONE]",
  ].join("\n");
  assert.equal(parseMaxaiSseText(raw), "Hello world");
});

test("splitThink separates reasoning from answer", () => {
  const { reasoning, answer } = splitThink("<think>let me think</think>The answer is 42.");
  assert.equal(reasoning, "let me think");
  assert.equal(answer, "The answer is 42.");
});

test("splitThink: no think tag → all answer", () => {
  const { reasoning, answer } = splitThink("just a plain answer");
  assert.equal(reasoning, "");
  assert.equal(answer, "just a plain answer");
});

test("ThinkSplitter handles a tag split across frames", () => {
  const s = new ThinkSplitter();
  let reasoning = "";
  let answer = "";
  // "<thi" then "nk>reason</thi" then "nk>ans"
  for (const delta of ["<thi", "nk>reason</thi", "nk>ans"]) {
    const out = s.feed(delta);
    reasoning += out.reasoning;
    answer += out.answer;
  }
  const tail = s.flush();
  reasoning += tail.reasoning;
  answer += tail.answer;
  assert.equal(reasoning, "reason");
  assert.equal(answer, "ans");
});

test("estimateMaxaiTokens ~ 4 chars/token", () => {
  assert.equal(estimateMaxaiTokens(""), 0);
  assert.equal(estimateMaxaiTokens("abcd"), 1);
  assert.equal(estimateMaxaiTokens("abcde"), 2);
});

// ── Credentials ──────────────────────────────────────────────────────────────

test("userIdFromJwt decodes subject.user_id (no signature verification)", () => {
  // Build a fake JWT with { subject: { user_id } }.
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ subject: { user_id: USER_ID } })).toString(
    "base64url"
  );
  const jwt = `${header}.${payload}.sig`;
  assert.equal(userIdFromJwt(jwt), USER_ID);
});

// ── Browserless access-token refresh ─────────────────────────────────────────

/** Build a fake (unsigned) JWT carrying an `exp` and optional subject.user_id. */
function fakeJwt(expEpochSeconds: number, userId?: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const claims: Record<string, unknown> = { exp: expEpochSeconds };
  if (userId) claims.subject = { user_id: userId };
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${header}.${payload}.sig`;
}

test("maxaiAccessTokenNeedsRefresh: absent / unparseable / near-expiry / fresh", () => {
  const now = () => 1_000_000_000_000; // fixed ms clock
  const nowSec = 1_000_000_000;
  assert.equal(maxaiAccessTokenNeedsRefresh("", 3600, now), true); // absent
  assert.equal(maxaiAccessTokenNeedsRefresh("not-a-jwt", 3600, now), true); // unparseable
  // exp 30 min out with a 1h margin → needs refresh.
  assert.equal(maxaiAccessTokenNeedsRefresh(fakeJwt(nowSec + 1800), 3600, now), true);
  // exp 5h out with a 1h margin → still fresh.
  assert.equal(maxaiAccessTokenNeedsRefresh(fakeJwt(nowSec + 5 * 3600), 3600, now), false);
});

test("maxaiRefreshAccessToken sends the exact web-app request + parses data.access_token", async () => {
  const nowSec = Math.floor(Date.now() / 1000);
  const refreshToken = fakeJwt(nowSec + 365 * 24 * 3600, USER_ID); // 1y refresh token
  const newAccess = fakeJwt(nowSec + 24 * 3600, USER_ID);
  let seen: { url: string; init: RequestInit } | null = null;

  const fakeFetch = (async (url: string, init: RequestInit) => {
    seen = { url: String(url), init };
    return new Response(JSON.stringify({ data: { access_token: newAccess } }), { status: 200 });
  }) as unknown as typeof fetch;

  const result = await maxaiRefreshAccessToken({
    refreshToken,
    deviceId: "118a857e-c96f-4dfd-86ce-55ee910f748a",
    fetchImpl: fakeFetch,
  });

  assert.equal(result.ok, true);
  assert.equal(result.accessToken, newAccess);
  assert.ok(result.expiresAt && result.expiresAt > nowSec);

  // Request shape: bare refresh path, refresh token as Bearer, noAuthLogout, app body.
  assert.ok(seen);
  const { url, init } = seen!;
  assert.ok(url.endsWith(MAXAI_REFRESH_PATH));
  assert.equal(init.method, "POST");
  const headers = init.headers as Record<string, string>;
  assert.equal(headers["Authorization"], `Bearer ${refreshToken}`);
  assert.equal(headers["noAuthLogout"], "true");
  assert.ok(headers["X-Authorization"] && headers["X-Authorization"].length > 0);
  assert.equal(init.body, JSON.stringify({ app: "maxai_webapp" }));
});

test("maxaiRefreshAccessToken returns a structured error on non-200 (no throw)", async () => {
  const nowSec = Math.floor(Date.now() / 1000);
  const fakeFetch = (async () =>
    new Response("nope", { status: 418 })) as unknown as typeof fetch;
  const result = await maxaiRefreshAccessToken({
    refreshToken: fakeJwt(nowSec + 1000, USER_ID),
    deviceId: "dev",
    fetchImpl: fakeFetch,
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 418);
});

test("maxaiRefreshAccessToken refuses when required inputs are missing", async () => {
  const result = await maxaiRefreshAccessToken({ refreshToken: "", deviceId: "" });
  assert.equal(result.ok, false);
  assert.equal(result.status, 0);
});

// ── Email login (browserless device-pair) ────────────────────────────────────

test("requestMaxaiEmailCode posts the signed signin request + treats status OK as success", async () => {
  let seen: { url: string; init: RequestInit } | null = null;
  const fakeFetch = (async (url: string, init: RequestInit) => {
    seen = { url: String(url), init };
    return new Response(JSON.stringify({ data: { status: "OK" } }), { status: 200 });
  }) as unknown as typeof fetch;

  const r = await requestMaxaiEmailCode({
    email: "arminantondm@gmail.com",
    deviceId: "46a0703d-8841-44b9-9287-efbc49091454",
    fetchImpl: fakeFetch,
  });

  assert.equal(r.ok, true);
  assert.ok(seen);
  const { url, init } = seen!;
  assert.ok(url.endsWith(MAXAI_SIGNIN_EMAIL_PATH));
  assert.equal(init.method, "POST");
  assert.equal(init.body, JSON.stringify({ email: "arminantondm@gmail.com", app: "maxai_webapp" }));
  const headers = init.headers as Record<string, string>;
  assert.ok(headers["X-Authorization"] && headers["X-Authorization"].length > 0);
});

test("requestMaxaiEmailCode surfaces a non-OK detail as an error", async () => {
  const fakeFetch = (async () =>
    new Response(JSON.stringify({ data: { status: "FAIL", detail: "Invalid email" } }), {
      status: 200,
    })) as unknown as typeof fetch;
  const r = await requestMaxaiEmailCode({ email: "x@y.z", deviceId: "dev", fetchImpl: fakeFetch });
  assert.equal(r.ok, false);
  assert.match(r.error ?? "", /Invalid email/);
});

test("verifyMaxaiEmailCode returns the full credential from auth_user", async () => {
  const nowSec = Math.floor(Date.now() / 1000);
  const accessToken = "acc.jwt.token";
  const refreshToken = "ref.jwt.token";
  let seen: { url: string; init: RequestInit } | null = null;
  const fakeFetch = (async (url: string, init: RequestInit) => {
    seen = { url: String(url), init };
    return new Response(
      JSON.stringify({
        data: {
          status: "OK",
          auth_user: {
            accessToken,
            refreshToken,
            userId: USER_ID,
            email: "arminantondm@gmail.com",
            clientUserId: "client-uuid-1",
          },
        },
      }),
      { status: 200 }
    );
  }) as unknown as typeof fetch;

  const r = await verifyMaxaiEmailCode({
    email: "arminantondm@gmail.com",
    code: "123456",
    deviceId: "device-uuid-1",
    clientUserId: "client-uuid-1",
    fetchImpl: fakeFetch,
  });

  assert.equal(r.ok, true);
  assert.deepEqual(r.credential, {
    accessToken,
    refreshToken,
    userId: USER_ID,
    email: "arminantondm@gmail.com",
    deviceId: "device-uuid-1",
    clientUserId: "client-uuid-1",
  });
  assert.ok(nowSec > 0); // sanity anchor

  // Request shape: verify path + pinned body fields.
  const { url, init } = seen!;
  assert.ok(url.endsWith(MAXAI_VERIFY_CODE_PATH));
  const body = JSON.parse(String(init.body));
  assert.equal(body.email, "arminantondm@gmail.com");
  assert.equal(body.secret_code, "123456");
  assert.equal(body.app, "maxai_webapp");
  assert.equal(body.env, "prod_co");
  assert.equal(body.client_user_id, "client-uuid-1");
});

test("verifyMaxaiEmailCode maps code 10119 to an expired-code message", async () => {
  const fakeFetch = (async () =>
    new Response(JSON.stringify({ data: { status: "FAIL", code: 10119 } }), {
      status: 200,
    })) as unknown as typeof fetch;
  const r = await verifyMaxaiEmailCode({
    email: "x@y.z",
    code: "000000",
    deviceId: "dev",
    clientUserId: "cu",
    fetchImpl: fakeFetch,
  });
  assert.equal(r.ok, false);
  assert.match(r.error ?? "", /expired|too many/i);
});

test("verifyMaxaiEmailCode defaults to an invalid-code message otherwise", async () => {
  const fakeFetch = (async () =>
    new Response(JSON.stringify({ data: { status: "FAIL" } }), { status: 200 })) as unknown as typeof fetch;
  const r = await verifyMaxaiEmailCode({
    email: "x@y.z",
    code: "999999",
    deviceId: "dev",
    clientUserId: "cu",
    fetchImpl: fakeFetch,
  });
  assert.equal(r.ok, false);
  assert.match(r.error ?? "", /Invalid code/);
});

test("email login guards missing inputs", async () => {
  assert.equal((await requestMaxaiEmailCode({ email: "", deviceId: "" })).ok, false);
  assert.equal(
    (await verifyMaxaiEmailCode({ email: "", code: "", deviceId: "", clientUserId: "" })).ok,
    false
  );
});

// ── Tool calling (prompted <tool> protocol) ──────────────────────────────────

import { MaxAiExecutor } from "../../open-sse/executors/maxai.ts";

const TOOL_CRED = {
  providerSpecificData: {
    maxaiAccessToken: "acc.tok.en",
    maxaiDeviceId: "dev-1",
    maxaiUserId: USER_ID,
  },
  accessToken: "acc.tok.en",
};

const WEATHER_TOOL = {
  type: "function",
  function: {
    name: "get_weather",
    description: "Get the current weather for a city.",
    parameters: {
      type: "object",
      properties: { city: { type: "string" } },
      required: ["city"],
    },
  },
};

/** Build a MaxAI SSE body streaming `full` as one mergeable text frame. */
function maxaiSseBody(full: string): string {
  return (
    `data: ${JSON.stringify({ data_key: "text", need_merge: true, text: full })}\n\n` +
    "data: [DONE]\n\n"
  );
}

/** Run MaxAiExecutor.execute with a stubbed global fetch returning `sseText`. */
async function runToolExecute(opts: {
  sseText: string;
  stream: boolean;
  tools?: unknown[];
}): Promise<{ captured: { url: string; body: string } | null; response: Response }> {
  const realFetch = globalThis.fetch;
  let captured: { url: string; body: string } | null = null;
  globalThis.fetch = (async (url: unknown, init: unknown) => {
    captured = {
      url: String(url),
      body: String((init as RequestInit)?.body ?? ""),
    };
    return new Response(opts.sseText, { status: 200 });
  }) as unknown as typeof fetch;
  try {
    const executor = new MaxAiExecutor();
    const result = await executor.execute({
      model: "gpt-5.6-luna",
      stream: opts.stream,
      credentials: TOOL_CRED,
      body: {
        model: "gpt-5.6-luna",
        messages: [{ role: "user", content: "what's the weather in Paris?" }],
        ...(opts.tools ? { tools: opts.tools } : {}),
        stream: opts.stream,
      },
    } as unknown as Parameters<MaxAiExecutor["execute"]>[0]);
    const response = "response" in result ? result.response : (result as Response);
    return { captured, response };
  } finally {
    globalThis.fetch = realFetch;
  }
}

test("executor injects the <tool> contract into the upstream text when tools are present", async () => {
  const { captured } = await runToolExecute({
    sseText: maxaiSseBody("Sure, let me check."),
    stream: false,
    tools: [WEATHER_TOOL],
  });
  assert.ok(captured);
  const chatBody = JSON.parse(captured!.body);
  const sentText = chatBody.message_content[0].text as string;
  // The prompted-tool contract + the tool name reach the model.
  assert.match(sentText, /<tool>/);
  assert.match(sentText, /get_weather/);
});

test("executor parses a <tool> block from the reply into OpenAI tool_calls (non-stream)", async () => {
  const toolBlock =
    '<tool>{"name": "get_weather", "arguments": {"city": "Paris"}, "_nonce": "NONCE"}</tool>';
  // The parser needs the SAME nonce serializeToolsToPrompt derived from tools[].
  // getToolNonce is deterministic per tools ref+content, so re-derive it here.
  const { getToolNonce } = await import("../../open-sse/translator/webTools.ts");
  const tools = [WEATHER_TOOL];
  const nonce = getToolNonce(tools);
  const reply = `<tool>{"name": "get_weather", "arguments": {"city": "Paris"}, "_nonce": "${nonce}"}</tool>`;
  void toolBlock;

  const { response } = await runToolExecute({
    sseText: maxaiSseBody(reply),
    stream: false,
    tools,
  });
  assert.equal(response.status, 200);
  const json = await response.json();
  const choice = json.choices[0];
  assert.equal(choice.finish_reason, "tool_calls");
  assert.ok(Array.isArray(choice.message.tool_calls));
  assert.equal(choice.message.tool_calls[0].function.name, "get_weather");
  assert.deepEqual(JSON.parse(choice.message.tool_calls[0].function.arguments), { city: "Paris" });
});

test("executor tool mode emits a terminal SSE replay with tool_calls (stream)", async () => {
  const { getToolNonce } = await import("../../open-sse/translator/webTools.ts");
  const tools = [WEATHER_TOOL];
  const nonce = getToolNonce(tools);
  const reply = `<tool>{"name": "get_weather", "arguments": {"city": "Paris"}, "_nonce": "${nonce}"}</tool>`;

  const { response } = await runToolExecute({
    sseText: maxaiSseBody(reply),
    stream: true,
    tools,
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("Content-Type") ?? "", /text\/event-stream/);
  const sse = await response.text();
  assert.match(sse, /"tool_calls"/);
  assert.match(sse, /get_weather/);
  assert.match(sse, /\[DONE\]/);
});

test("executor without tools streams normally (no tool_calls, plain content)", async () => {
  const { response } = await runToolExecute({
    sseText: maxaiSseBody("Paris is sunny today."),
    stream: false,
  });
  assert.equal(response.status, 200);
  const json = await response.json();
  assert.equal(json.choices[0].finish_reason, "stop");
  assert.equal(json.choices[0].message.content, "Paris is sunny today.");
  assert.equal(json.choices[0].message.tool_calls, undefined);
});
