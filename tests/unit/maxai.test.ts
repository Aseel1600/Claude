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
