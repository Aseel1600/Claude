import test from "node:test";
import assert from "node:assert/strict";
import {
  shouldPassthroughUpstreamError,
  buildPassthroughErrorResponse,
} from "../../open-sse/utils/upstreamErrorPassthrough.ts";

test("upstream error passthrough", async (t) => {
  await t.test("4xx com corpo JSON de erro do provider é elegível", () => {
    const body = {
      type: "error",
      error: { type: "invalid_request_error", message: "thinking.type: adaptive is not supported" },
    };
    assert.equal(shouldPassthroughUpstreamError(400, body), true);
  });
  await t.test("5xx NÃO é elegível (segue sanitizado)", () => {
    assert.equal(shouldPassthroughUpstreamError(500, { error: { message: "x" } }), false);
  });
  await t.test("corpo com cara de vazamento interno (stack trace) NÃO é elegível", () => {
    assert.equal(
      shouldPassthroughUpstreamError(400, {
        error: { message: "Error\n    at /usr/lib/node_modules/omniroute/x.js:1" },
      }),
      false
    );
  });
  await t.test(
    "401/407 NÃO são elegíveis (credencial nossa pode vazar em www-authenticate)",
    () => {
      assert.equal(shouldPassthroughUpstreamError(401, { error: { message: "bad key" } }), false);
    }
  );
  await t.test("buildPassthroughErrorResponse preserva corpo byte-a-byte", async () => {
    const body = {
      type: "error",
      error: { type: "invalid_request_error", message: "thinking.type: nope" },
    };
    const res = buildPassthroughErrorResponse(400, body);
    assert.ok(res);
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), body);
  });
  await t.test("retorna null quando inelegível", () => {
    assert.equal(buildPassthroughErrorResponse(500, {}), null);
  });
});
