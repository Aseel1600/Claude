import test from "node:test";
import assert from "node:assert/strict";

const { createResponsesApiTransformStream } =
  await import("../../open-sse/transformer/responsesTransformer.ts");
const { openaiToOpenAIResponsesResponse } =
  await import("../../open-sse/translator/response/openai-responses.ts");
const { initState } = await import("../../open-sse/translator/index.ts");
const { FORMATS } = await import("../../open-sse/translator/formats.ts");

const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function runTransformStream(chunks) {
  const stream = createResponsesApiTransformStream(null, 3000, { parseTextualReasoningTags: true });
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();

  const output = [];
  const readerTask = (async () => {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      output.push(decoder.decode(value));
    }
  })();

  for (const chunk of chunks) {
    await writer.write(encoder.encode(chunk));
  }
  await writer.close();
  await readerTask;

  return output.join("");
}

function parseSseOutput(output) {
  return output
    .trim()
    .split("\n\n")
    .map((entry) => {
      const lines = entry.split("\n");
      const eventLine = lines.find((line) => line.startsWith("event: "));
      const dataLine = lines.find((line) => line.startsWith("data: "));
      return {
        event: eventLine ? eventLine.slice("event: ".length) : null,
        data: dataLine ? dataLine.slice("data: ".length) : null,
      };
    });
}

test("ResponsesTransformer: should not skip tool_calls when reasoning is present in same chunk", async () => {
  const output = await runTransformStream([
    'data: {"choices":[{"index":0,"delta":{"content":"<think>Thinking...</think>","tool_calls":[{"index":0,"id":"call_1","function":{"name":"test","arguments":"{}"}}]}}]}\n\n',
    'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"arguments":"{}"}}]},"finish_reason":"tool_calls"}]}\n\n',
  ]);

  const events = parseSseOutput(output);
  const toolCallAdded = events.find(
    (e) =>
      e.event === "response.output_item.added" && JSON.parse(e.data).item.type === "function_call"
  );
  assert.ok(toolCallAdded, "Tool call should be added even if reasoning is in the same chunk");
});

test("ResponsesTransformer: should process all choices in a chunk", async () => {
  const output = await runTransformStream([
    'data: {"choices":[{"index":0,"delta":{"content":" "}},{"index":1,"delta":{"content":"Done"},"finish_reason":"stop"}]}\n\n',
  ]);

  const events = parseSseOutput(output);
  const item1Done = events.find(
    (e) => e.event === "response.output_item.done" && JSON.parse(e.data).output_index === 1
  );
  assert.ok(item1Done, "Choice 1 should be processed even if Choice 0 triggered a skip/trim");
});

test("openaiToOpenAIResponsesResponse: should not skip tool_calls when reasoning is present in same chunk", () => {
  const state = initState(FORMATS.OPENAI_RESPONSES);
  const chunk = {
    id: "1",
    model: "deepseek-r1",
    choices: [
      {
        index: 0,
        delta: {
          content: "<think>Thinking...",
          tool_calls: [{ index: 0, id: "call_1", function: { name: "test", arguments: "{}" } }],
        },
      },
    ],
  };

  const events = openaiToOpenAIResponsesResponse(chunk, state);
  const toolCallAdded = events.find(
    (e) => e.event === "response.output_item.added" && e.data.item.type === "function_call"
  );
  assert.ok(toolCallAdded, "Tool call should be added even if reasoning is in the same chunk");
});
