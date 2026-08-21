import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateDifyProvider } from "../../src/lib/providers/validation/specialtyInline.ts";

describe("dify provider validation probe (#11002)", () => {
  it("probes /v1/chat-messages endpoint and returns valid for HTTP 200/400", async () => {
    const originalFetch = globalThis.fetch;
    let probedUrl = "";
    let probedMethod = "";
    let probedBody = "";

    // @ts-ignore
    globalThis.fetch = async (url: string | URL | Request, init?: RequestInit) => {
      probedUrl = url.toString();
      probedMethod = init?.method || "GET";
      probedBody = (init?.body as string) || "";
      return new Response(JSON.stringify({ code: "invalid_param" }), { status: 400 });
    };

    try {
      const res = await validateDifyProvider({
        apiKey: "test-dify-app-key-12345",
        providerSpecificData: { baseUrl: "https://api.dify.ai/v1" },
        isLocal: true,
      });

      assert.equal(probedUrl, "https://api.dify.ai/v1/chat-messages");
      assert.equal(probedMethod, "POST");
      assert.ok(probedBody.includes('"user":"omniroute-probe"'));
      assert.equal(res.valid, true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("returns invalid for HTTP 401 unauthorized", async () => {
    const originalFetch = globalThis.fetch;
    // @ts-ignore
    globalThis.fetch = async () => {
      return new Response(JSON.stringify({ code: "unauthorized" }), { status: 401 });
    };

    try {
      const res = await validateDifyProvider({
        apiKey: "test-dify-app-key-invalid",
        providerSpecificData: { baseUrl: "https://api.dify.ai/v1" },
        isLocal: true,
      });

      assert.equal(res.valid, false);
      assert.ok(res.error?.includes("Invalid API key"));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
