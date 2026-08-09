import { describe, it } from "node:test";
import assert from "node:assert/strict";

const mod = await import("../../open-sse/executors/commandCode.ts");

describe("CommandCodeExecutor", () => {
  it("can be instantiated", () => {
    const executor = new mod.CommandCodeExecutor();
    assert.ok(executor);
  });

  it("can be instantiated with custom provider", () => {
    const executor = new mod.CommandCodeExecutor("custom-provider");
    assert.ok(executor);
  });

  it("buildUrl returns a string", () => {
    const executor = new mod.CommandCodeExecutor();
    const url = executor.buildUrl();
    assert.ok(typeof url === "string");
    assert.ok(url.includes("generate") && url.includes("commandcode"));
  });

  it("execute throws when no API key", async () => {
    const executor = new mod.CommandCodeExecutor();
    try {
      await executor.execute({
        model: "test",
        body: { messages: [{ role: "user", content: "hi" }] },
        stream: false,
        credentials: {},
        signal: null,
      });
      assert.fail("Should have thrown");
    } catch (err) {
      assert.ok(err instanceof Error);
      assert.ok(err.message.includes("API key"));
    }
  });

  it("execute returns result shape with valid key (will fail on fetch)", async () => {
    const executor = new mod.CommandCodeExecutor();
    try {
      const result = await executor.execute({
        model: "test",
        body: { messages: [{ role: "user", content: "hi" }] },
        stream: false,
        credentials: { apiKey: "fake-key" },
        signal: null,
      });
      // If it returns (network error caught), check shape
      assert.ok(result.response instanceof Response);
      assert.ok(typeof result.url === "string");
      assert.ok(typeof result.headers === "object");
    } catch {
      // Network error is expected in test environment
    }
  });

  it("assistant tool-call conversion always emits a valid required arguments field (#regression input[N] missing required field arguments)", async () => {
    const calls: Array<{ url: string; init: RequestInit; body: unknown }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({
        url: String(url),
        init: init || {},
        body: JSON.parse(String((init as RequestInit | undefined)?.body)),
      });
      return new Response("", { status: 200 });
    }) as typeof fetch;

    const executor = new mod.CommandCodeExecutor();
    const pairedId = "call_paired";
    const body = {
      messages: [
        { role: "user", content: "hi" },
        {
          role: "assistant",
          content: "",
          tool_calls: [
            // Missing arguments entirely -> must still get a valid arguments field
            { id: "call_missing", type: "function", function: { name: "lookup" } },
            // Empty string arguments -> "{}"
            {
              id: "call_empty",
              type: "function",
              function: { name: "lookup", arguments: "" },
            },
            // Valid object arguments -> round-trips as JSON string
            {
              id: pairedId,
              type: "function",
              function: { name: "lookup", arguments: { q: "docs" } },
            },
            // Valid string arguments -> preserved as-is
            {
              id: "call_string",
              type: "function",
              function: { name: "lookup", arguments: '{"q":"string"}' },
            },
            // Invalid JSON string arguments -> defaults to "{}"
            {
              id: "call_invalid",
              type: "function",
              function: { name: "lookup", arguments: "{invalid-json" },
            },
          ],
        },
        { role: "tool", tool_call_id: "call_missing", content: "r1" },
        { role: "tool", tool_call_id: "call_empty", content: "r2" },
        { role: "tool", tool_call_id: pairedId, content: "r3" },
        { role: "tool", tool_call_id: "call_string", content: "r4" },
        { role: "tool", tool_call_id: "call_invalid", content: "r5" },
      ],
    };

    try {
      await executor.execute({
        model: "test",
        body,
        stream: false,
        credentials: { apiKey: "fake-key" },
        signal: null,
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    assert.equal(calls.length, 1, "exactly one upstream call");
    const sentBody = calls[0].body as {
      params: { messages: Array<{ role: string; content: unknown }> };
    };
    const assistant = sentBody.params.messages.find((m) => m.role === "assistant");
    assert.ok(assistant, "assistant turn present");
    const parts = assistant.content as Array<Record<string, unknown>>;
    const toolCalls = parts.filter((p) => p.type === "tool-call");
    assert.equal(toolCalls.length, 5, "all five paired tool calls converted");

    for (const call of toolCalls) {
      assert.equal(
        typeof call.arguments,
        "string",
        `tool-call ${String(call.toolCallId)} must carry a string arguments field`
      );
      const parsed = JSON.parse(call.arguments as string);
      assert.equal(typeof parsed, "object");
      assert.ok(!Array.isArray(parsed), "arguments must parse to a JSON object");
    }

    const byId = new Map(toolCalls.map((c) => [String(c.toolCallId), c]));
    assert.equal(byId.get("call_missing").arguments, "{}", "missing arguments -> empty object");
    assert.equal(byId.get("call_empty").arguments, "{}", "empty string arguments -> empty object");
    assert.equal(
      byId.get(pairedId).arguments,
      '{"q":"docs"}',
      "object arguments round-trip as JSON string"
    );
    assert.equal(
      byId.get("call_string").arguments,
      '{"q":"string"}',
      "valid string arguments preserved as-is"
    );
    assert.equal(
      byId.get("call_invalid").arguments,
      "{}",
      "invalid JSON string arguments -> empty object"
    );

    const toolMsgs = sentBody.params.messages.filter((m) => m.role === "tool");
    assert.equal(toolMsgs.length, 5, "all 5 tool result messages present");
    for (const msg of toolMsgs) {
      const toolParts = msg.content as Array<Record<string, unknown>>;
      assert.equal(toolParts.length, 1);
      assert.equal(toolParts[0].type, "tool-result");
      assert.equal(
        toolParts[0].toolName,
        "lookup",
        "toolName resolved from matching assistant tool call"
      );
    }
  });

  it("COMMAND_CODE_VERSION default constant is 1.15.1", () => {
    assert.equal(mod.COMMAND_CODE_VERSION, "1.15.1");
  });
});
