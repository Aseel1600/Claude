import test from "node:test";
import assert from "node:assert/strict";

import { KiroExecutor } from "../../open-sse/executors/kiro.ts";

const textEncoder = new TextEncoder();

function crc32(bytes: Uint8Array): number {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let value = i;
    for (let bit = 0; bit < 8; bit++) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[i] = value >>> 0;
  }

  let value = 0xffffffff;
  for (const byte of bytes) {
    value = table[(value ^ byte) & 0xff] ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function encodeHeader(name: string, value: string): Uint8Array {
  const nameBytes = textEncoder.encode(name);
  const valueBytes = textEncoder.encode(value);
  const header = new Uint8Array(1 + nameBytes.length + 1 + 2 + valueBytes.length);
  let offset = 0;
  header[offset++] = nameBytes.length;
  header.set(nameBytes, offset);
  offset += nameBytes.length;
  header[offset++] = 7;
  header[offset++] = (valueBytes.length >> 8) & 0xff;
  header[offset++] = valueBytes.length & 0xff;
  header.set(valueBytes, offset);
  return header;
}

function encodeEventFrame(eventType: string, payload: Record<string, unknown>): Uint8Array {
  const headers = encodeHeader(":event-type", eventType);
  const payloadBytes = textEncoder.encode(JSON.stringify(payload));
  const totalLength = 12 + headers.length + payloadBytes.length + 4;
  const frame = new Uint8Array(totalLength);
  const view = new DataView(frame.buffer);
  view.setUint32(0, totalLength, false);
  view.setUint32(4, headers.length, false);
  view.setUint32(8, crc32(frame.slice(0, 8)), false);
  frame.set(headers, 12);
  frame.set(payloadBytes, 12 + headers.length);
  view.setUint32(totalLength - 4, crc32(frame.slice(0, totalLength - 4)), false);
  return frame;
}

function eventStreamResponse(frames: Uint8Array[], status = 200): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const frame of frames) controller.enqueue(frame);
        controller.close();
      },
    }),
    { status, statusText: status === 200 ? "OK" : "Bad Gateway" }
  );
}

function controlledEventStreamResponse(initialFrames: Uint8Array[] = []) {
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | undefined;
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controllerRef = controller;
        for (const frame of initialFrames) controller.enqueue(frame);
      },
    }),
    { status: 200, statusText: "OK" }
  );
  return {
    response,
    enqueue(frame: Uint8Array) {
      controllerRef?.enqueue(frame);
    },
    close() {
      controllerRef?.close();
    },
  };
}

function collectDataChunks(text: string): Array<Record<string, unknown>> {
  return text
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => line.slice(6).trim())
    .filter((data) => data && data !== "[DONE]")
    .map((data) => JSON.parse(data) as Record<string, unknown>);
}

test("Kiro retries a malformed pre-output tool_call wrapper exactly once", async () => {
  const originalFetch = globalThis.fetch;
  const requests: RequestInit[] = [];
  const responses = [
    eventStreamResponse([
      encodeEventFrame("toolUseEvent", {
        toolUseId: "call_1",
        name: "tool_call",
        input: { arguments: { q: "router" } },
      }),
      encodeEventFrame("messageStopEvent", {}),
    ]),
    eventStreamResponse([
      encodeEventFrame("toolUseEvent", {
        toolUseId: "call_2",
        name: "tool_call",
        input: { name: "mcp_search", arguments: { q: "router" } },
      }),
      encodeEventFrame("messageStopEvent", {}),
    ]),
  ];

  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    requests.push(init || {});
    const response = responses.shift();
    assert.ok(response, "unexpected extra Kiro request");
    return response;
  }) as typeof globalThis.fetch;

  try {
    const result = await new KiroExecutor().execute({
      model: "kr/claude-opus-4.8",
      body: {
        conversationState: {
          currentMessage: { userInputMessage: { content: "base" } },
        },
      },
      stream: true,
      credentials: { accessToken: "test-token", providerSpecificData: {} },
    });
    const text = await result.response.text();
    const toolCalls = collectDataChunks(text).flatMap((chunk) => {
      const choices = Array.isArray(chunk.choices) ? chunk.choices : [];
      const choice = choices[0] as Record<string, unknown> | undefined;
      const delta = choice?.delta as Record<string, unknown> | undefined;
      return Array.isArray(delta?.tool_calls)
        ? (delta.tool_calls as Array<Record<string, unknown>>)
        : [];
    });
    const argumentsText = toolCalls
      .map((toolCall) => {
        const fn = toolCall.function as Record<string, unknown> | undefined;
        return typeof fn?.arguments === "string" ? fn.arguments : "";
      })
      .join("");

    assert.equal(requests.length, 2);
    assert.doesNotMatch(text, /invalid_kiro_tool_call/);
    assert.deepEqual(JSON.parse(argumentsText), {
      name: "mcp_search",
      arguments: { q: "router" },
    });
    const retryBody = JSON.parse(String(requests[1].body)) as Record<string, unknown>;
    const retryContent = (
      (retryBody.conversationState as Record<string, unknown>).currentMessage as Record<
        string,
        unknown
      >
    ).userInputMessage as Record<string, unknown>;
    assert.match(String(retryContent.content), /Previous validation error/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Kiro opens a valid stream before the upstream response completes", async () => {
  const originalFetch = globalThis.fetch;
  const upstream = controlledEventStreamResponse([
    encodeEventFrame("assistantResponseEvent", { content: "hello" }),
  ]);
  globalThis.fetch = (async () => upstream.response) as typeof globalThis.fetch;

  try {
    const result = await new KiroExecutor().execute({
      model: "kr/claude-opus-4.8",
      body: { conversationState: {} },
      stream: true,
      credentials: { accessToken: "test-token", providerSpecificData: {} },
    });
    const reader = result.response.body?.getReader();
    assert.ok(reader);
    const firstRead = await reader.read();
    assert.equal(firstRead.done, false);
    assert.match(new TextDecoder().decode(firstRead.value), /hello/);
    upstream.enqueue(encodeEventFrame("messageStopEvent", {}));
    upstream.close();
    await reader.cancel("test complete").catch(() => {});
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Kiro propagates client cancellation to the gated upstream reader", async () => {
  const originalFetch = globalThis.fetch;
  let cancelCount = 0;
  let cancelReason: unknown;
  globalThis.fetch = (async () =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encodeEventFrame("assistantResponseEvent", { content: "hello" }));
        },
        cancel(reason) {
          cancelCount += 1;
          cancelReason = reason;
        },
      }),
      { status: 200, statusText: "OK" }
    )) as typeof globalThis.fetch;

  try {
    const result = await new KiroExecutor().execute({
      model: "kr/claude-opus-4.8",
      body: { conversationState: {} },
      stream: true,
      credentials: { accessToken: "test-token", providerSpecificData: {} },
    });
    const reader = result.response.body?.getReader();
    assert.ok(reader);
    assert.equal((await reader.read()).done, false);
    await reader.cancel("client cancelled");
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(cancelCount, 1);
    assert.equal(cancelReason, "client cancelled");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Kiro returns a retry HTTP 429 instead of wrapping it as a 200 SSE error", async () => {
  const originalFetch = globalThis.fetch;
  let callCount = 0;
  globalThis.fetch = (async () => {
    callCount += 1;
    if (callCount === 1) {
      return eventStreamResponse([
        encodeEventFrame("toolUseEvent", {
          toolUseId: "call_1",
          name: "tool_call",
          input: { arguments: { q: "router" } },
        }),
        encodeEventFrame("messageStopEvent", {}),
      ]);
    }
    return new Response("rate limited", { status: 429, statusText: "Too Many Requests" });
  }) as typeof globalThis.fetch;

  try {
    const result = await new KiroExecutor().execute({
      model: "kr/claude-opus-4.8",
      body: { conversationState: {} },
      stream: true,
      credentials: { accessToken: "test-token", providerSpecificData: {} },
    });
    assert.equal(callCount, 2);
    assert.equal(result.response.status, 429);
    assert.equal(await result.response.text(), "rate limited");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Kiro emits a distinct repair retry failure when the second wrapper is malformed", async () => {
  const originalFetch = globalThis.fetch;
  let callCount = 0;
  globalThis.fetch = (async () => {
    callCount += 1;
    return eventStreamResponse([
      encodeEventFrame("toolUseEvent", {
        toolUseId: `call_${callCount}`,
        name: "tool_call",
        input: { arguments: { q: "router" } },
      }),
      encodeEventFrame("messageStopEvent", {}),
    ]);
  }) as typeof globalThis.fetch;

  try {
    const result = await new KiroExecutor().execute({
      model: "kr/claude-opus-4.8",
      body: { conversationState: {} },
      stream: true,
      credentials: { accessToken: "test-token", providerSpecificData: {} },
    });
    const text = await result.response.text();
    assert.equal(callCount, 2);
    assert.match(text, /kiro_tool_call_repair_retry_failed/);
    assert.doesNotMatch(text, /invalid_kiro_tool_call/);
    assert.match(text, /missing nested MCP tool name/);
    assert.doesNotMatch(text, /"tool_calls"/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Kiro enforces the repair buffer cap", async () => {
  const originalFetch = globalThis.fetch;
  const previous = process.env.KIRO_TOOL_CALL_REPAIR_BUFFER_MAX_BYTES;
  process.env.KIRO_TOOL_CALL_REPAIR_BUFFER_MAX_BYTES = "8";
  globalThis.fetch = (async () =>
    eventStreamResponse([
      encodeEventFrame("assistantResponseEvent", { content: "hello" }),
    ])) as typeof globalThis.fetch;

  try {
    const result = await new KiroExecutor().execute({
      model: "kr/claude-opus-4.8",
      body: { conversationState: {} },
      stream: true,
      credentials: { accessToken: "test-token", providerSpecificData: {} },
    });
    assert.match(await result.response.text(), /kiro_tool_call_repair_buffer_exceeded/);
  } finally {
    if (previous === undefined) delete process.env.KIRO_TOOL_CALL_REPAIR_BUFFER_MAX_BYTES;
    else process.env.KIRO_TOOL_CALL_REPAIR_BUFFER_MAX_BYTES = previous;
    globalThis.fetch = originalFetch;
  }
});

test("Kiro uses the configured inter-chunk stall timeout", async () => {
  const originalFetch = globalThis.fetch;
  const previous = process.env.KIRO_TOOL_CALL_REPAIR_STALL_TIMEOUT_MS;
  process.env.KIRO_TOOL_CALL_REPAIR_STALL_TIMEOUT_MS = "1";
  globalThis.fetch = (async () =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encodeEventFrame("toolUseEvent", { toolUseId: "call_1", name: "tool_call" })
          );
        },
      }),
      { status: 200, statusText: "OK" }
    )) as typeof globalThis.fetch;

  try {
    const result = await new KiroExecutor().execute({
      model: "kr/claude-opus-4.8",
      body: { conversationState: {} },
      stream: true,
      credentials: { accessToken: "test-token", providerSpecificData: {} },
    });
    assert.match(await result.response.text(), /Kiro tool_call repair stalled/);
  } finally {
    if (previous === undefined) delete process.env.KIRO_TOOL_CALL_REPAIR_STALL_TIMEOUT_MS;
    else process.env.KIRO_TOOL_CALL_REPAIR_STALL_TIMEOUT_MS = previous;
    globalThis.fetch = originalFetch;
  }
});

test("Kiro uses the configured TTFT timeout before the first upstream frame", async () => {
  const originalFetch = globalThis.fetch;
  const previous = process.env.KIRO_TOOL_CALL_REPAIR_TTFT_TIMEOUT_MS;
  process.env.KIRO_TOOL_CALL_REPAIR_TTFT_TIMEOUT_MS = "1";
  globalThis.fetch = (async () =>
    new Response(new ReadableStream<Uint8Array>({ start() {} }), {
      status: 200,
      statusText: "OK",
    })) as typeof globalThis.fetch;

  try {
    const result = await new KiroExecutor().execute({
      model: "kr/claude-opus-4.8",
      body: { conversationState: {} },
      stream: true,
      credentials: { accessToken: "test-token", providerSpecificData: {} },
    });
    assert.match(await result.response.text(), /timed out before first chunk/);
  } finally {
    if (previous === undefined) delete process.env.KIRO_TOOL_CALL_REPAIR_TTFT_TIMEOUT_MS;
    else process.env.KIRO_TOOL_CALL_REPAIR_TTFT_TIMEOUT_MS = previous;
    globalThis.fetch = originalFetch;
  }
});

test("Kiro aborts a gated attempt and cancels its upstream body", async () => {
  const originalFetch = globalThis.fetch;
  let cancelReason: unknown;
  globalThis.fetch = (async () =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encodeEventFrame("toolUseEvent", { toolUseId: "call_1", name: "tool_call" })
          );
        },
        cancel(reason) {
          cancelReason = reason;
        },
      }),
      { status: 200, statusText: "OK" }
    )) as typeof globalThis.fetch;
  const abortController = new AbortController();

  try {
    const promise = new KiroExecutor().execute({
      model: "kr/claude-opus-4.8",
      body: { conversationState: {} },
      stream: true,
      credentials: { accessToken: "test-token", providerSpecificData: {} },
      signal: abortController.signal,
    });
    abortController.abort("client aborted");
    await assert.rejects(promise, (error: Error) => error.name === "AbortError");
    assert.notEqual(cancelReason, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Kiro does not retry a valid wrapper", async () => {
  const originalFetch = globalThis.fetch;
  let callCount = 0;
  globalThis.fetch = (async () => {
    callCount += 1;
    return eventStreamResponse([
      encodeEventFrame("toolUseEvent", {
        toolUseId: "call_1",
        name: "tool_call",
        input: { name: "mcp_search", arguments: { q: "router" } },
      }),
      encodeEventFrame("messageStopEvent", {}),
    ]);
  }) as typeof globalThis.fetch;

  try {
    const result = await new KiroExecutor().execute({
      model: "kr/claude-opus-4.8",
      body: { conversationState: {} },
      stream: true,
      credentials: { accessToken: "test-token", providerSpecificData: {} },
    });
    const text = await result.response.text();
    assert.equal(callCount, 1);
    assert.doesNotMatch(text, /kiro_tool_call_repair/);
    assert.match(text, /"tool_calls"/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Kiro repair errors sanitize stack paths and credentials", () => {
  const executor = new KiroExecutor() as unknown as {
    createKiroRepairErrorResponse: (response: Response, message: string, code: string) => Response;
  };
  const response = executor.createKiroRepairErrorResponse(
    new Response(null, { status: 200 }),
    "failure at /tmp/omniroute/open-sse/executors/kiro.ts:1499 Bearer super-secret-token\n    at KiroExecutor.execute (file:///srv/app/kiro.ts:1:2)",
    "kiro_tool_call_repair_failed"
  );

  return response.text().then((text) => {
    assert.doesNotMatch(text, /\/tmp\/omniroute\/open-sse\/executors\/kiro\.ts/);
    assert.doesNotMatch(text, /super-secret-token/);
    assert.match(text, /<path>/);
    assert.match(text, /Bearer \[REDACTED\]/);
  });
});
