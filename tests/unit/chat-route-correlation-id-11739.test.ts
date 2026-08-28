import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-correlation-11739-"));
process.env.DATA_DIR = TEST_DATA_DIR;

const core = await import("../../src/lib/db/core.ts");
const providersDb = await import("../../src/lib/db/providers.ts");
const chatRoute = await import("../../src/app/api/v1/chat/completions/route.ts");
const originalFetch = globalThis.fetch;

async function seedHealthyConnection() {
  await providersDb.createProviderConnection({
    provider: "openai",
    authType: "apikey",
    name: "correlation-route-test",
    apiKey: "sk-correlation-route-test",
    isActive: true,
    testStatus: "active",
  });
}

function request(correlationId: string, stream = false) {
  return new Request("http://localhost/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Correlation-Id": correlationId,
      "X-OmniRoute-No-Cache": "true",
    },
    body: JSON.stringify({
      model: "openai/gpt-4.1",
      messages: [{ role: "user", content: "Correlation contract test" }],
      stream,
    }),
  });
}

async function resetStorage() {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
}

test.beforeEach(async () => {
  globalThis.fetch = originalFetch;
  await resetStorage();
  await seedHealthyConnection();
});

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test.after(() => {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

test("#11739 preserves caller correlation IDs for JSON, streaming, and provider failures", async () => {
  const correlationId = "caller-correlation-11739";

  globalThis.fetch = async () =>
    Response.json({
      id: "chatcmpl-correlation-json",
      choices: [{ message: { role: "assistant", content: "OK" } }],
    });
  const jsonResponse = await chatRoute.POST(request(correlationId));
  assert.equal(jsonResponse.status, 200);
  assert.equal(jsonResponse.headers.get("x-correlation-id"), correlationId);

  globalThis.fetch = async () =>
    new Response(
      `data: ${JSON.stringify({ choices: [{ delta: { content: "OK" } }] })}\n\ndata: [DONE]\n\n`,
      { status: 200, headers: { "Content-Type": "text/event-stream" } }
    );
  const streamingResponse = await chatRoute.POST(request(correlationId, true));
  assert.equal(streamingResponse.status, 200);
  assert.equal(streamingResponse.headers.get("x-correlation-id"), correlationId);
  await streamingResponse.text();

  globalThis.fetch = async () => new Response("synthetic provider failure", { status: 400 });
  const errorResponse = await chatRoute.POST(request(correlationId));
  assert.notEqual(errorResponse.status, 200);
  assert.equal(errorResponse.headers.get("x-correlation-id"), correlationId);
});
