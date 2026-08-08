import test from "node:test";
import assert from "node:assert/strict";
import { validateResponseQuality } from "../../open-sse/services/combo/validateQuality.ts";

/**
 * An SSE stream may legally open with a comment line.
 *
 * Per the EventSource spec a line starting with `:` is a comment, and it is the
 * conventional keepalive: TCB opens every stream with `: keepalive`. The
 * quality gate recognised only `data:` and `event:` prefixes, so those streams
 * were parsed as JSON, failed, and reported "response is not valid JSON" —
 * taking the whole combo down with "All models failed" while the model had in
 * fact answered 200 with real content.
 *
 * Observed in production 2026-08-08: every TCB-only combo (`spec-plan-review`,
 * `REVIEW - AUTO`) failed on every request, while VERBOO-first combos worked
 * because VERBOO opens with `data:`.
 */

// isStreaming=false: e o ramo que produziu "response is not valid JSON" em producao.
const sse = (body: string) =>
  new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });

test("a stream opening with a keepalive comment is accepted", async () => {
  const body = ': keepalive\n\ndata: {"choices":[{"delta":{"content":"oi"}}]}\n\ndata: [DONE]\n';
  const r = await validateResponseQuality(sse(body), false, {});
  assert.equal(r.valid, true, `rejeitado: ${r.reason}`);
});

test("a stream opening with data: is still accepted", async () => {
  const body = 'data: {"choices":[{"delta":{"content":"oi"}}]}\n\ndata: [DONE]\n';
  assert.equal((await validateResponseQuality(sse(body), false, {})).valid, true);
});

test("a stream opening with event: is still accepted", async () => {
  const body = 'event: message\ndata: {"choices":[{"delta":{"content":"oi"}}]}\n';
  assert.equal((await validateResponseQuality(sse(body), false, {})).valid, true);
});

test("the omniroute header preamble is accepted", async () => {
  // The proxy emits its own metadata as SSE comments before any data frame.
  const body =
    ": x-omniroute-cache-hit=false\n: x-omniroute-latency-ms=1\n\n" +
    'data: {"choices":[{"delta":{"content":"oi"}}]}\n';
  const r = await validateResponseQuality(sse(body), false, {});
  assert.equal(r.valid, true, `rejeitado: ${r.reason}`);
});

test("genuinely malformed bodies are still rejected", async () => {
  // The gate must keep catching upstreams that answer 200 with garbage.
  const r = await validateResponseQuality(
    new Response("<html>502 Bad Gateway</html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    }),
    false,
    {}
  );
  assert.equal(r.valid, false);
});

test("an empty body is still rejected", async () => {
  const r = await validateResponseQuality(sse(""), false, {});
  assert.equal(r.valid, false);
});
