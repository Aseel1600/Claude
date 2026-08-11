// @ts-nocheck
import assert from "node:assert/strict";
import test from "node:test";

import { buildGovernorRequestOverrides } from "../../../open-sse/governor/autoComboRuntime.ts";
import { handleChatCore } from "../../../open-sse/handlers/chatCore.ts";

const originalFetch = globalThis.fetch;

const plan = {
  reasoningEffort: "medium",
  compressionMode: "rtk",
  maxOutputTokens: 100,
};

const controls = {
  controlReasoning: true,
  controlCompression: true,
  controlOutput: true,
};

function noopLog() {
  return { debug() {}, info() {}, warn() {}, error() {} };
}

function openAIResponse(model: string) {
  return new Response(
    JSON.stringify({
      id: "chatcmpl-governor-final",
      object: "chat.completion",
      model,
      choices: [{ index: 0, message: { role: "assistant", content: "OK" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 4, completion_tokens: 1, total_tokens: 5 },
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

function anthropicResponse(model: string) {
  return new Response(
    JSON.stringify({
      id: "msg_governor_final",
      type: "message",
      role: "assistant",
      model,
      content: [{ type: "text", text: "OK" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 4, output_tokens: 1 },
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

async function dispatch(
  provider: "openai" | "anthropic",
  model: string,
  response: Response
): Promise<Record<string, unknown>> {
  const originalBody = {
    model,
    stream: false,
    max_tokens: 800,
    messages: [{ role: "user", content: "Governor final executor proof" }],
  };
  const overrides = buildGovernorRequestOverrides(originalBody, plan, controls);
  const selectedBody = { ...originalBody, ...overrides };
  let captured: Record<string, unknown> | null = null;

  globalThis.fetch = async (_url, init = {}) => {
    captured = JSON.parse(String(init.body || "{}"));
    return response;
  };

  const result = await handleChatCore({
    body: selectedBody,
    modelInfo: { provider, model, extendedContext: false },
    credentials: { apiKey: "governor-final-executor-key", providerSpecificData: {} },
    log: noopLog(),
    clientRawRequest: {
      endpoint: "/v1/chat/completions",
      body: structuredClone(selectedBody),
      headers: new Headers({ accept: "application/json" }),
    },
    userAgent: "governor-final-executor-test",
    skipResourcePressureGuard: true,
  });

  assert.equal(result.success, true);
  assert.ok(captured, "the real provider executor must receive a request body");
  assert.equal(
    "__omnirouteGovernorCompressionPreference" in captured,
    false,
    "internal Governor compression metadata must not cross the executor boundary"
  );
  return captured;
}

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("generated Governor controls reach OpenAI's final executor request", async () => {
  const captured = await dispatch("openai", "o3-mini", openAIResponse("o3-mini"));

  assert.equal(captured.reasoning_effort, "medium");
  assert.equal(captured.max_completion_tokens ?? captured.max_tokens, 100);
});

test("generated Governor controls become native Claude reasoning at the final executor", async () => {
  const captured = await dispatch(
    "anthropic",
    "claude-opus-4-8",
    anthropicResponse("claude-opus-4-8")
  );

  assert.deepEqual(captured.thinking, { type: "adaptive" });
  assert.deepEqual(captured.output_config, { effort: "medium" });
  assert.equal(captured.reasoning_effort, undefined);
  assert.equal(captured.max_tokens, 100);
});
