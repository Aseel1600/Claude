import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-copilot-test-"));
process.env.DATA_DIR = TEST_DATA_DIR;

const core = await import("../../src/lib/db/core.ts");
const providersDb = await import("../../src/lib/db/providers.ts");
const chatRoute = await import("../../src/app/api/v1/chat/completions/route.ts");
const modelsRoute = await import("../../src/app/api/v1/models/route.ts");

async function flushBackgroundWork() {
  await new Promise((resolve) => setTimeout(resolve, 20));
  await new Promise((resolve) => setImmediate(resolve));
}

async function resetStorage() {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
}

test.beforeEach(async () => {
  await resetStorage();
});

test.afterEach(async () => {
  await flushBackgroundWork();
});

test.after(async () => {
  await flushBackgroundWork();
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

test("GET /v1/models returns a valid list of models", async () => {
  const req = new Request("http://localhost/v1/models", {
    method: "GET",
  });
  const res = await modelsRoute.GET(req);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert(Array.isArray(body.data));
  const modelIds = (body.data as { id: string }[]).map((m) => m.id);
  assert(modelIds.includes("auto/coding:free"));
  assert(modelIds.includes("auto/coding"));
});

test("POST /v1/chat/completions with missing model returns 400 Bad Request", async () => {
  const req = new Request("http://localhost/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [{ role: "user", content: "hello" }],
    }),
  });
  const res = await chatRoute.POST(req);
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error?.message, "Missing model");
});

test("POST /v1/chat/completions with auto/coding:free reaches routing layer", async () => {
  // Add a fake active provider connection so routing passes authentication and matches targets
  await providersDb.createProviderConnection({
    provider: "opencode",
    authType: "apikey",
    name: "opencode-copilot-test",
    apiKey: "", // Keyless/free connection
    isActive: true,
    testStatus: "active",
  });

  // Mock global fetch to return a dummy LLM completion
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    Response.json({
      id: "chatcmpl-copilot-test",
      choices: [{ message: { role: "assistant", content: "This is a free coding response" } }],
    })) as unknown as typeof globalThis.fetch;

  try {
    const req = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "auto/coding:free",
        messages: [{ role: "user", content: "write python code" }],
      }),
    });
    const res = await chatRoute.POST(req);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.choices[0].message.content, "This is a free coding response");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("POST /v1/chat/completions with auto/coding (premium model requires key) returns 402 or routes", async () => {
  // If we don't have a premium connection, it should fail with 402 or similar,
  // indicating it reached the routing/executor layer.
  const req = new Request("http://localhost/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "auto/coding",
      messages: [{ role: "user", content: "write rust code" }],
    }),
  });
  const res = await chatRoute.POST(req);
  // It shouldn't be a 400 validation error; if it has no premium credentials,
  // it might 402 (Payment Required) or 503 depending on routing candidates.
  // The key is that it passes the initial admissions and gets past Zod validation.
  assert.notEqual(res.status, 400);
});

test("POST /v1/chat/completions with tool-calling requests is supported", async () => {
  await providersDb.createProviderConnection({
    provider: "opencode",
    authType: "apikey",
    name: "opencode-tool-test",
    apiKey: "",
    isActive: true,
    testStatus: "active",
  });

  const originalFetch = globalThis.fetch;
  let sentBody: Record<string, unknown> | null = null;
  globalThis.fetch = (async (url, options) => {
    if (options && typeof options.body === "string") {
      sentBody = JSON.parse(options.body) as Record<string, unknown>;
    }
    return Response.json({
      id: "chatcmpl-tool-test",
      choices: [{ message: { role: "assistant", content: "Executing tool" } }],
    });
  }) as unknown as typeof globalThis.fetch;

  try {
    const req = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "auto/coding:free",
        messages: [{ role: "user", content: "check status" }],
        tools: [
          {
            type: "function",
            function: {
              name: "get_weather",
              description: "Get the current weather",
              parameters: {
                type: "object",
                properties: {
                  location: { type: "string" },
                },
                required: ["location"],
              },
            },
          },
        ],
      }),
    });
    const res = await chatRoute.POST(req);
    assert.equal(res.status, 200);
    // Verify that the tools array was correctly parsed, validated, and sent upstream
    assert(sentBody && Array.isArray(sentBody.tools));
    assert.equal(sentBody.tools[0].function.name, "get_weather");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
