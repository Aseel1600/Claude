import test from "node:test";
import assert from "node:assert/strict";

import { FreebuffExecutor, FREEBUFF_BASE_URL } from "../../open-sse/executors/freebuff.ts";
import type { ExecuteInput } from "../../open-sse/executors/base.ts";
import { normalizeExecutorResult } from "../../open-sse/handlers/chatCore/upstreamTimeouts.ts";

/** Unwrap the executor result union into its Response. */
function resultResponse(res: Awaited<ReturnType<FreebuffExecutor["execute"]>>): Response {
  return normalizeExecutorResult(res).response;
}
import { freebuffProvider } from "../../open-sse/config/providers/registry/freebuff/index.ts";
import { APIKEY_PROVIDERS_GATEWAYS } from "../../src/shared/constants/providers/apikey/gateways.ts";
import { validateFreebuffProvider } from "../../src/lib/providers/validation.ts";

const originalFetch = globalThis.fetch;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Route fetch calls by URL fragment; missing routes fall through to the real fetch. */
function stubFetch(routes: Record<string, (url: string, init?: RequestInit) => Promise<Response> | Response>) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    for (const [fragment, handler] of Object.entries(routes)) {
      if (url.includes(fragment)) return handler(url, init);
    }
    throw new Error(`Unexpected fetch URL in test: ${url}`);
  }) as typeof fetch;
}

const baseInput = {
  model: "deepseek/deepseek-v4-flash",
  body: { messages: [{ role: "user", content: "hello" }] },
  stream: false,
  credentials: { apiKey: "test-token" },
} as unknown as ExecuteInput;

test.after(() => {
  globalThis.fetch = originalFetch;
});

test("FreebuffExecutor: constructor initializes provider name and config correctly", () => {
  const executor = new FreebuffExecutor();
  assert.equal(executor.getProvider(), "freebuff");
  assert.equal(executor.config.baseUrl, FREEBUFF_BASE_URL);
});

test("FreebuffExecutor: returns 401 response when credentials are missing", async () => {
  const executor = new FreebuffExecutor();
  const res = await executor.execute({
    model: "deepseek/deepseek-v4-flash",
    body: { messages: [{ role: "user", content: "hello" }] },
    stream: false,
    credentials: { apiKey: "" },
  } as unknown as ExecuteInput);

  const response = resultResponse(res);
  assert.equal(response.status, 401);
  const data = (await response.json()) as { error: { message: string } };
  assert.match(data.error.message, /Freebuff Auth Token required/i);
});

test("FreebuffExecutor: full lifecycle acquires session, starts agent run, completes, and finishes", async () => {
  const calls: string[] = [];
  stubFetch({
    "/freebuff/session": (url, init) => {
      calls.push("session");
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      assert.equal(init?.headers?.["x-freebuff-model"], "deepseek/deepseek-v4-flash");
      assert.deepEqual(body, {});
      return jsonResponse({ instanceId: "inst-123" });
    },
    "/agent-runs": (url, init) => {
      const action = (JSON.parse(String(init?.body)) as { action?: string }).action;
      calls.push(`run-${action}`);
      if (action === "START") return jsonResponse({ runId: "run-456" });
      return jsonResponse({ ok: true });
    },
    "/chat/completions": (url, init) => {
      calls.push("completion");
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      // Buffy system prompt injected
      const messages = body.messages as Array<{ role: string; content: unknown }>;
      assert.equal(messages[0].role, "system");
      assert.match(String(messages[0].content), /You are Buffy/);
      assert.equal(body.model, "deepseek/deepseek-v4-flash");
      assert.equal(body.stream, false);
      assert.equal(init?.headers?.["x-freebuff-instance-id"], "inst-123");
      assert.equal(init?.headers?.["x-codebuff-run-id"], "run-456");
      assert.equal(init?.headers?.["x-codebuff-agent-id"], "base2-free-deepseek-flash");
      return jsonResponse({ choices: [{ message: { role: "assistant", content: "hi" } }] });
    },
  });

  const executor = new FreebuffExecutor();
  const res = await executor.execute(baseInput);
  assert.equal(resultResponse(res).status, 200);
  // FINISH is fire-and-forget; wait a tick for it to flush
  await new Promise((r) => setTimeout(r, 10));

  assert.ok(calls.includes("session"), "session acquisition called");
  assert.ok(calls.includes("run-START"), "agent run START called");
  assert.ok(calls.includes("completion"), "chat completion called");
  assert.ok(calls.includes("run-FINISH"), "agent run FINISH called");
  assert.equal(calls.filter((c) => c === "run-FINISH").length, 1);
});

test("FreebuffExecutor: injects Buffy prompt only when no system prompt exists", async () => {
  const completions: Array<Record<string, unknown>> = [];
  stubFetch({
    "/freebuff/session": () => jsonResponse({ instanceId: "inst-1" }),
    "/agent-runs": () => jsonResponse({}),
    "/chat/completions": (url, init) => {
      completions.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return jsonResponse({ choices: [] });
    },
  });

  const executor = new FreebuffExecutor();
  await executor.execute(baseInput);
  const messages = completions[0].messages as Array<{ role: string; content: string }>;
  assert.equal(messages[0].role, "system");
  assert.match(messages[0].content, /You are Buffy/);

  // Second call: client already supplies a Buffy system prompt — no duplicate injection.
  await executor.execute({
    ...baseInput,
    body: {
      messages: [
        { role: "system", content: "You are Buffy, the strategic coding assistant." },
        { role: "user", content: "hello" },
      ],
    },
  } as unknown as ExecuteInput);
  const messages2 = completions[1].messages as Array<{ role: string; content: string }>;
  assert.equal(messages2.filter((m) => m.role === "system").length, 1);
});

test("FreebuffExecutor: strips freebuff/ model prefix and maps to agent", async () => {
  let seenModel = "";
  let seenAgent = "";
  stubFetch({
    "/freebuff/session": () => jsonResponse({ instanceId: "inst-1" }),
    "/agent-runs": () => jsonResponse({ runId: "run-1" }),
    "/chat/completions": (url, init) => {
      seenModel = (JSON.parse(String(init?.body)) as { model: string }).model;
      seenAgent = String(init?.headers?.["x-codebuff-agent-id"]);
      return jsonResponse({ choices: [] });
    },
  });

  const executor = new FreebuffExecutor();
  await executor.execute({ ...baseInput, model: "freebuff/z-ai/glm-5.2" } as unknown as ExecuteInput);
  assert.equal(seenModel, "z-ai/glm-5.2");
  assert.equal(seenAgent, "base2-free-glm");
});

test("FreebuffExecutor: surfaces sanitized error on session failure", async () => {
  stubFetch({
    "/freebuff/session": () =>
      new Response(
        "upstream boom /home/user/.codebuff/src/secret.ts Authorization: Bearer abc123def\n" +
          "at Object.execute (C:\\Users\\me\\omniroute\\open-sse\\executors\\freebuff.ts:30:1)\n" +
          "at processTicksAndRejections (node:internal/process/task_queues:95:5)",
        { status: 500 }
      ),
  });

  const executor = new FreebuffExecutor();
  const res = await executor.execute(baseInput);
  assert.equal(resultResponse(res).status, 500);
  const data = (await resultResponse(res).json()) as { error: { message: string } };
  assert.match(data.error.message, /Freebuff session failed \(500\)/);
  // Raw upstream text must not leak source paths, credentials, or stack tails
  assert.ok(!data.error.message.includes("/home/"), "absolute source path redacted");
  assert.ok(!data.error.message.includes("secret.ts"), "source filename redacted");
  assert.ok(!data.error.message.includes("abc123def"), "Bearer token redacted");
  assert.ok(!data.error.message.includes("processTicks"), "stack tail stripped");
});

test("FreebuffExecutor: returns 502 on session network error", async () => {
  stubFetch({
    "/freebuff/session": () => {
      throw new TypeError("fetch failed");
    },
  });

  const executor = new FreebuffExecutor();
  const res = await executor.execute(baseInput);
  assert.equal(resultResponse(res).status, 502);
  const data = (await resultResponse(res).json()) as { error: { message: string } };
  assert.match(data.error.message, /Freebuff session network error/);
});

test("FreebuffExecutor: completes even when agent-run START fails (best-effort)", async () => {
  const calls: string[] = [];
  stubFetch({
    "/freebuff/session": () => jsonResponse({ instanceId: "inst-1" }),
    "/agent-runs": () => {
      calls.push("run");
      return jsonResponse({ error: "boom" }, 500);
    },
    "/chat/completions": () => {
      calls.push("completion");
      return jsonResponse({ choices: [] });
    },
  });

  const executor = new FreebuffExecutor();
  const res = await executor.execute(baseInput);
  assert.equal(resultResponse(res).status, 200);
  assert.ok(calls.includes("completion"), "completion still called when START fails");
});

test("freebuffProvider: registry entry has valid structure and catalog", () => {
  assert.equal(freebuffProvider.id, "freebuff");
  assert.equal(freebuffProvider.format, "openai");
  assert.equal(freebuffProvider.executor, "freebuff");
  assert.equal(freebuffProvider.baseUrl, "https://www.codebuff.com/api/v1");
  assert.ok(Array.isArray(freebuffProvider.models));
  assert.ok(freebuffProvider.models.length >= 8);

  const flash = freebuffProvider.models.find((m) => m.id === "deepseek/deepseek-v4-flash");
  assert.ok(flash, "deepseek/deepseek-v4-flash must exist in freebuff models");
  assert.equal(flash?.supportsReasoning, true);

  const minimax = freebuffProvider.models.find((m) => m.id === "minimax/minimax-m3");
  assert.ok(minimax, "minimax/minimax-m3 must exist in freebuff models");
  assert.equal(minimax?.supportsVision, true);
});

test("APIKEY_PROVIDERS_GATEWAYS: freebuff gateway metadata is defined", () => {
  const fb = APIKEY_PROVIDERS_GATEWAYS.freebuff;
  assert.ok(fb, "freebuff must be in APIKEY_PROVIDERS_GATEWAYS");
  assert.equal(fb.id, "freebuff");
  assert.equal(fb.name, "Freebuff");
  assert.equal(fb.color, "#10B981");
  assert.equal(fb.hasFree, true);
});

test("validateFreebuffProvider: returns invalid when apiKey is empty", async () => {
  const res = await validateFreebuffProvider({ apiKey: "" });
  assert.equal(res.valid, false);
  assert.match(res.error || "", /Freebuff Auth Token required/i);
});

test("validateFreebuffProvider: valid on session ok, invalid on 401, canned on 500", async () => {
  stubFetch({
    "/freebuff/session": () => jsonResponse({ instanceId: "x" }),
  });
  const ok = await validateFreebuffProvider({ apiKey: "tok" });
  assert.equal(ok.valid, true);

  stubFetch({
    "/freebuff/session": () => new Response("nope", { status: 401 }),
  });
  const bad = await validateFreebuffProvider({ apiKey: "tok" });
  assert.equal(bad.valid, false);
  assert.match(bad.error || "", /Invalid or expired Freebuff Auth Token/);

  stubFetch({
    "/freebuff/session": () => new Response("boom", { status: 500 }),
  });
  const serverErr = await validateFreebuffProvider({ apiKey: "tok" });
  assert.equal(serverErr.valid, false);
  // Canned message — no raw upstream body leaks into the error
  assert.match(serverErr.error || "", /Freebuff upstream unavailable/);
  assert.ok(!(serverErr.error || "").includes("boom"), "raw upstream body not leaked");
});
