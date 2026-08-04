import { describe, it } from "node:test";
import assert from "node:assert/strict";

const mod = await import("../../open-sse/executors/zai-web.ts");

describe("ZaiWebExecutor", () => {
  it("can be instantiated", () => {
    const executor = new mod.ZaiWebExecutor();
    assert.ok(executor);
  });

  it("extracts the token cookie value from a full Cookie header", () => {
    assert.equal(mod.extractZaiToken("token=abc123; other=xyz"), "abc123");
    assert.equal(mod.extractZaiToken("Cookie: other=xyz; token=abc123"), "abc123");
  });

  it("accepts a bare JWT/token with no cookie name prefix", () => {
    // a bare token with no '=' and no ';' falls through to the raw string
    assert.equal(
      mod.extractZaiToken("eyJhbGciOiJIUzI1NiJ9.payload.sig"),
      "eyJhbGciOiJIUzI1NiJ9.payload.sig"
    );
    assert.equal(mod.extractZaiToken("plainsessiontoken"), "plainsessiontoken");
  });

  it("returns empty string when no cookie is provided", () => {
    assert.equal(mod.extractZaiToken(""), "");
  });

  it("parses the internal z.ai delta_content/phase SSE envelope", () => {
    const delta = mod.parseZaiFrame({
      type: "chat:completion",
      data: { delta_content: "Hello", phase: "answer", done: false },
    });
    assert.deepEqual(delta, { content: "Hello", reasoning: "", done: false });
  });

  it("routes thinking-phase content into the reasoning field", () => {
    const delta = mod.parseZaiFrame({
      type: "chat:completion",
      data: { delta_content: "pondering...", phase: "thinking", done: false },
    });
    assert.deepEqual(delta, { content: "", reasoning: "pondering...", done: false });
  });

  it("detects end-of-stream from the internal envelope", () => {
    const delta = mod.parseZaiFrame({
      type: "chat:completion",
      data: { phase: "done", done: true },
    });
    assert.equal(delta?.done, true);
  });

  it("parses an OpenAI-shaped pass-through frame", () => {
    const delta = mod.parseZaiFrame({
      choices: [{ delta: { content: "Hi there" }, finish_reason: null }],
    });
    assert.deepEqual(delta, { content: "Hi there", reasoning: "", done: false });
  });

  it("detects end-of-stream from an OpenAI-shaped finish_reason", () => {
    const delta = mod.parseZaiFrame({
      choices: [{ delta: {}, finish_reason: "stop" }],
    });
    assert.equal(delta?.done, true);
  });

  it("returns null for frames with no usable delta", () => {
    assert.equal(mod.parseZaiFrame(null), null);
    assert.equal(mod.parseZaiFrame({}), null);
    assert.equal(mod.parseZaiFrame({ data: { phase: "answer" } }), null);
  });

  it("folds non-string message content into JSON strings", () => {
    const folded = mod.foldMessages([
      { role: "user", content: "hi" },
      { role: "user", content: { foo: "bar" } },
    ]);
    assert.deepEqual(folded, [
      { role: "user", content: "hi" },
      { role: "user", content: '{"foo":"bar"}' },
    ]);
  });

  it("returns a credential error when no cookie is provided", async () => {
    const executor = new mod.ZaiWebExecutor();
    const result = await executor.execute({
      model: "glm-4.7",
      body: { messages: [{ role: "user", content: "hi" }] },
      stream: false,
      credentials: { apiKey: "" },
      signal: null,
    });

    assert.equal(result.response.status, 400);
    assert.equal(new URL(result.url).hostname, "chat.z.ai");
    const parsed = await result.response.json();
    assert.match(parsed.error.message, /Z\.ai session/);
  });

  it("sends the cookie + bearer token and builds the request body", async () => {
    const originalFetch = globalThis.fetch;
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedInit = init;
      return new Response("data: [DONE]\n\n", {
        headers: { "Content-Type": "text/event-stream" },
      });
    }) as typeof fetch;

    try {
      const executor = new mod.ZaiWebExecutor();
      await executor.execute({
        model: "glm-4.7",
        body: { messages: [{ role: "user", content: "hello" }] },
        stream: false,
        credentials: { apiKey: `${["token", "abc123"].join("=")}; foo=bar` },
        signal: null,
      });

      const parsedUrl = new URL(capturedUrl);
      assert.equal(
        parsedUrl.origin + parsedUrl.pathname,
        "https://chat.z.ai/api/v2/chat/completions"
      );
      // The signature covers the timestamp, so it has to travel in the query.
      const timestamp = parsedUrl.searchParams.get("signature_timestamp");
      assert.match(String(timestamp), /^\d{13}$/);
      assert.equal(parsedUrl.searchParams.get("timestamp"), timestamp);
      assert.ok(parsedUrl.searchParams.get("requestId"));

      const headers = capturedInit?.headers as Record<string, string>;
      assert.equal(headers.Cookie, `${["token", "abc123"].join("=")}; foo=bar`);
      assert.equal(headers.Authorization, "Bearer abc123");
      // Presence of X-FE-Version is what clears the in-SSE 426 gate.
      assert.equal(headers["X-FE-Version"], mod.ZAI_FE_VERSION);
      assert.equal(headers["Accept-Language"], "en-US");
      assert.match(headers["X-Signature"], /^[0-9a-f]{64}$/);

      const parsedBody = JSON.parse(String(capturedInit?.body));
      assert.equal(parsedBody.model, "glm-4.7");
      assert.equal(parsedBody.stream, true);
      assert.deepEqual(parsedBody.messages, [{ role: "user", content: "hello" }]);
      assert.equal(parsedBody.features.web_search, false);
      // Must match the string fed to the signature.
      assert.equal(parsedBody.signature_prompt, "hello");
      // No operator-supplied token → the field is omitted entirely.
      assert.equal("captcha_verify_param" in parsedBody, false);

      // Recompute the signature independently from the wire values.
      const expected = mod.signZaiRequest(
        [
          `requestId,${parsedUrl.searchParams.get("requestId")}`,
          `timestamp,${timestamp}`,
          `user_id,${parsedUrl.searchParams.get("user_id")}`,
        ].join(","),
        "hello",
        String(timestamp)
      );
      assert.equal(headers["X-Signature"], expected);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("aggregates streamed internal-envelope deltas into a non-streaming completion", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        [
          `data: ${JSON.stringify({ type: "chat:completion", data: { delta_content: "Hel", phase: "answer", done: false } })}`,
          `data: ${JSON.stringify({ type: "chat:completion", data: { delta_content: "lo", phase: "answer", done: false } })}`,
          `data: ${JSON.stringify({ type: "chat:completion", data: { phase: "done", done: true } })}`,
          "data: [DONE]",
          "",
          "",
        ].join("\n"),
        { headers: { "Content-Type": "text/event-stream" } }
      )) as typeof fetch;

    try {
      const executor = new mod.ZaiWebExecutor();
      const result = await executor.execute({
        model: "glm-4.7",
        body: { messages: [{ role: "user", content: "hi" }] },
        stream: false,
        credentials: { apiKey: "token=abc123" },
        signal: null,
      });

      const completion = await result.response.json();
      assert.equal(completion.choices[0].message.content, "Hello");
      assert.equal(completion.choices[0].finish_reason, "stop");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("streams internal-envelope deltas as OpenAI-shaped SSE chunks", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        [
          `data: ${JSON.stringify({ type: "chat:completion", data: { delta_content: "Hi", phase: "answer", done: false } })}`,
          `data: ${JSON.stringify({ type: "chat:completion", data: { phase: "done", done: true } })}`,
          "",
          "",
        ].join("\n"),
        { headers: { "Content-Type": "text/event-stream" } }
      )) as typeof fetch;

    try {
      const executor = new mod.ZaiWebExecutor();
      const result = await executor.execute({
        model: "glm-4.7",
        body: { messages: [{ role: "user", content: "hi" }] },
        stream: true,
        credentials: { apiKey: "token=abc123" },
        signal: null,
      });

      const text = await result.response.text();
      assert.match(text, /"content":"Hi"/);
      assert.match(text, /"finish_reason":"stop"/);
      assert.match(text, /data: \[DONE\]/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("propagates upstream HTTP errors", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response("session expired", { status: 401 })) as typeof fetch;

    try {
      const executor = new mod.ZaiWebExecutor();
      const result = await executor.execute({
        model: "glm-4.7",
        body: { messages: [{ role: "user", content: "hi" }] },
        stream: false,
        credentials: { apiKey: "token=abc123" },
        signal: null,
      });

      assert.equal(result.response.status, 401);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("surfaces the in-SSE captcha error as a real HTTP error instead of an empty completion", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        `data: ${JSON.stringify({
          type: "chat:completion",
          data: {
            done: true,
            error: {
              code: "FRONTEND_CAPTCHA_REQUIRED",
              captcha_error_type: "missing_param",
              detail: "captcha required",
            },
          },
        })}\n\n`,
        { status: 200, headers: { "Content-Type": "text/event-stream" } }
      )) as typeof fetch;

    try {
      const executor = new mod.ZaiWebExecutor();
      const result = await executor.execute({
        model: "glm-4.7",
        body: { messages: [{ role: "user", content: "hi" }] },
        stream: true,
        credentials: { apiKey: "token=abc123" },
        signal: null,
      });

      assert.equal(result.response.status, 403);
      const parsed = await result.response.json();
      assert.match(parsed.error.message, /captchaVerifyParam/);
      assert.equal(parsed.error.message.includes("at /"), false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("attaches an operator-supplied captcha token and spends it once", async () => {
    const originalFetch = globalThis.fetch;
    const bodies: Array<Record<string, unknown>> = [];
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response("data: [DONE]\n\n", {
        headers: { "Content-Type": "text/event-stream" },
      });
    }) as typeof fetch;

    mod.clearZaiCaptchaTokens("conn-spend");
    try {
      const executor = new mod.ZaiWebExecutor();
      const credentials = {
        apiKey: "token=abc123",
        connectionId: "conn-spend",
        providerSpecificData: { captchaVerifyParam: "tok-one" },
      };
      const input = {
        model: "glm-4.7",
        body: { messages: [{ role: "user", content: "hi" }] },
        stream: false,
        signal: null,
      };

      await executor.execute({ ...input, credentials });
      // Second call reuses the same credentials, but the token is already spent
      // and Aliyun tokens only verify once — it must not be replayed.
      await executor.execute({
        ...input,
        credentials: { apiKey: "token=abc123", connectionId: "conn-spend" },
      });

      assert.equal(bodies[0].captcha_verify_param, "tok-one");
      assert.equal("captcha_verify_param" in bodies[1], false);
    } finally {
      globalThis.fetch = originalFetch;
      mod.clearZaiCaptchaTokens("conn-spend");
    }
  });
});

describe("zai-web signature", () => {
  it("signs only the three identity fields and is deterministic per timestamp", () => {
    const fingerprint = mod.buildZaiFingerprint("user-1", 1770000000000);
    assert.equal(
      fingerprint.sortedPayload,
      `requestId,${fingerprint.requestId},timestamp,1770000000000,user_id,user-1`
    );
    const first = mod.signZaiRequest(fingerprint.sortedPayload, "hello", "1770000000000");
    const second = mod.signZaiRequest(fingerprint.sortedPayload, "hello", "1770000000000");
    assert.match(first, /^[0-9a-f]{64}$/);
    assert.equal(first, second);
    // Prompt and timestamp are both signature inputs.
    assert.notEqual(
      first,
      mod.signZaiRequest(fingerprint.sortedPayload, "hello!", "1770000000000")
    );
    assert.notEqual(first, mod.signZaiRequest(fingerprint.sortedPayload, "hello", "1770000600000"));
  });

  it("keeps the browser fingerprint out of the signed payload", () => {
    const fingerprint = mod.buildZaiFingerprint("user-1", 1770000000000);
    const params = new URLSearchParams(fingerprint.urlParams);
    assert.equal(params.get("user_id"), "user-1");
    assert.equal(params.get("screen_resolution"), "1920x1080");
    assert.equal(fingerprint.sortedPayload.includes("screen_resolution"), false);
  });

  it("reads the user id from an unverified session JWT", () => {
    const claims = Buffer.from(JSON.stringify({ id: "u-42" })).toString("base64url");
    assert.equal(mod.extractZaiUserId(`header.${claims}.sig`), "u-42");
    assert.equal(mod.extractZaiUserId("not-a-jwt"), "");
    assert.equal(mod.extractZaiUserId("header.@@@notbase64.sig"), "");
  });

  it("signs the last user turn, joining multi-part text content", () => {
    assert.equal(
      mod.resolveSignaturePrompt([
        { role: "user", content: "first" },
        { role: "assistant", content: "reply" },
        { role: "user", content: "  second  " },
      ]),
      "second"
    );
    assert.equal(
      mod.resolveSignaturePrompt([
        {
          role: "user",
          content: [
            { type: "text", text: "describe" },
            { type: "image_url", image_url: { url: "https://example.test/a.png" } },
            { type: "text", text: "this" },
          ],
        },
      ]),
      "describe\nthis"
    );
    assert.equal(mod.resolveSignaturePrompt([{ role: "assistant", content: "x" }]), "");
  });
});

describe("zai-web captcha token pool", () => {
  it("reads tokens from credentials, body and client headers in precedence order", () => {
    assert.deepEqual(
      mod.readZaiCaptchaTokens(
        { providerSpecificData: { captchaVerifyParam: "cred" } },
        null,
        null
      ),
      ["cred"]
    );
    assert.deepEqual(mod.readZaiCaptchaTokens(null, { captcha_verify_param: "body" }, null), [
      "body",
    ]);
    assert.deepEqual(mod.readZaiCaptchaTokens(null, null, { "X-Omniroute-Zai-Captcha": "hdr" }), [
      "hdr",
    ]);
    // Credentials win, and every distinct source still contributes to the pool.
    assert.deepEqual(
      mod.readZaiCaptchaTokens(
        { captchaToken: "cred" },
        { captchaVerifyParam: "body" },
        {
          "x-omniroute-zai-captcha": "cred",
        }
      ),
      ["cred", "body"]
    );
    assert.deepEqual(mod.readZaiCaptchaTokens({ captchaVerifyParam: ["a", " b ", ""] }, null), [
      "a",
      "b",
    ]);
    assert.deepEqual(mod.readZaiCaptchaTokens(null, null, null), []);
  });

  it("spends pooled tokens oldest-first and only once", () => {
    mod.clearZaiCaptchaTokens("pool-1");
    assert.equal(mod.takeZaiCaptchaToken("pool-1", ["t1", "t2"]), "t1");
    assert.equal(mod.countZaiCaptchaTokens("pool-1"), 1);
    assert.equal(mod.takeZaiCaptchaToken("pool-1", []), "t2");
    assert.equal(mod.takeZaiCaptchaToken("pool-1", []), null);
    mod.clearZaiCaptchaTokens("pool-1");
  });

  it("keeps pools isolated per connection", () => {
    mod.clearZaiCaptchaTokens();
    mod.takeZaiCaptchaToken("conn-a", ["a1", "a2"]);
    assert.equal(mod.takeZaiCaptchaToken("conn-b", []), null);
    assert.equal(mod.takeZaiCaptchaToken("conn-a", []), "a2");
    mod.clearZaiCaptchaTokens();
  });

  it("drops tokens older than the TTL instead of spending a stale one", () => {
    mod.clearZaiCaptchaTokens("pool-ttl");
    const t0 = 1770000000000;
    mod.takeZaiCaptchaToken("pool-ttl", ["stale", "also-stale"], t0);
    assert.equal(mod.countZaiCaptchaTokens("pool-ttl", t0), 1);
    // 6 minutes later — past the 5 minute TTL.
    assert.equal(mod.countZaiCaptchaTokens("pool-ttl", t0 + 6 * 60 * 1000), 0);
    assert.equal(mod.takeZaiCaptchaToken("pool-ttl", [], t0 + 6 * 60 * 1000), null);
    mod.clearZaiCaptchaTokens("pool-ttl");
  });
});

describe("zai-web upstream error classification", () => {
  it("distinguishes a missing captcha token from a rejected one", () => {
    const missing = mod.detectZaiUpstreamError({
      data: {
        error: { code: "FRONTEND_CAPTCHA_REQUIRED", captcha_error_type: "missing_param" },
      },
    });
    assert.equal(missing?.status, 403);
    assert.match(String(missing?.message), /requires a per-message Aliyun captcha token/);

    const rejected = mod.detectZaiUpstreamError({
      error: {
        code: "FRONTEND_CAPTCHA_REQUIRED",
        captcha_error_type: "verify_failed",
        verify_code: "F003",
      },
    });
    assert.equal(rejected?.status, 403);
    assert.match(String(rejected?.message), /single-use/);
    assert.match(String(rejected?.message), /F003/);
  });

  it("maps the version, model-level and session error codes", () => {
    assert.equal(mod.detectZaiUpstreamError({ data: { error: { code: "426" } } })?.status, 426);
    assert.equal(
      mod.detectZaiUpstreamError({ data: { error: { code: "426" } } })?.code,
      "CLIENT_VERSION_OUTDATED"
    );
    assert.equal(
      mod.detectZaiUpstreamError({
        data: { error: { code: "403", detail: "Model not available for current user level" } },
      })?.code,
      "MODEL_NOT_AVAILABLE"
    );
    assert.equal(mod.detectZaiUpstreamError({ data: { error: { code: "401" } } })?.status, 401);
    // Unknown codes still become a real failure rather than an empty answer.
    assert.equal(mod.detectZaiUpstreamError({ data: { error: { code: "WEIRD" } } })?.status, 502);
  });

  it("returns null for normal content frames", () => {
    assert.equal(mod.detectZaiUpstreamError(null), null);
    assert.equal(
      mod.detectZaiUpstreamError({
        type: "chat:completion",
        data: { delta_content: "hi", phase: "answer" },
      }),
      null
    );
  });

  it("detects the SPA signature-rejection strings", () => {
    assert.equal(
      mod.detectZaiSignatureError("Missing signature header")?.code,
      "SIGNATURE_REJECTED"
    );
    assert.equal(
      mod.detectZaiSignatureError("Signature validation failed")?.code,
      "SIGNATURE_REJECTED"
    );
    assert.equal(mod.detectZaiSignatureError("plain 500"), null);
    assert.equal(mod.detectZaiSignatureError(""), null);
  });
});

describe("zai-web signing key", () => {
  it("is embedded via publicCreds rather than a string literal", async () => {
    const { resolvePublicCred } = await import("../../open-sse/utils/publicCreds.ts");
    // Shape only — never assert the literal, so this file stays free of the
    // plaintext key (same convention as tests/unit/publicCreds.test.ts).
    const resolved = resolvePublicCred("zai_web_signature_key", "ZAI_WEB_SIGNATURE_KEY");
    assert.equal(typeof resolved, "string");
    assert.ok(resolved.length >= 16);
    // The executor must not carry the key inline (Hard Rule #11).
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(
      new URL("../../open-sse/executors/zai-web/signature.ts", import.meta.url),
      "utf8"
    );
    assert.ok(source.includes('resolvePublicCred("zai_web_signature_key"'));
    assert.equal(source.includes(resolved), false);
  });
});
