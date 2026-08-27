import test from "node:test";
import assert from "node:assert/strict";

const { splitMarkdownBoundary } =
  await import("../../open-sse/translator/helpers/markdownBoundary.ts");
const { openaiToClaudeResponse } =
  await import("../../open-sse/translator/response/openai-to-claude.ts");
const { geminiToClaudeResponse } =
  await import("../../open-sse/translator/response/gemini-to-claude.ts");

function flatten(items: (unknown[] | null)[]) {
  return items.flatMap((item) => item || []);
}

function getTextDeltas(events: unknown[]) {
  return events
    .filter(
      (e) =>
        (e as Record<string, unknown>)?.type === "content_block_delta" &&
        ((e as Record<string, unknown>).delta as Record<string, unknown>)?.type === "text_delta"
    )
    .map(
      (e) =>
        (((e as Record<string, unknown>).delta as Record<string, unknown>).text as string) ?? ""
    );
}

// -- splitMarkdownBoundary unit cases ---------------------------------------

test("splitMarkdownBoundary: no boundary emits everything", () => {
  const { emit, hold } = splitMarkdownBoundary("Hello world");
  assert.equal(emit, "Hello world");
  assert.equal(hold, "");
});

test("splitMarkdownBoundary: defers single trailing backtick in opener context", () => {
  const { emit, hold } = splitMarkdownBoundary("Use `git");
  assert.equal(emit, "Use ");
  assert.equal(hold, "`git");
});

test("splitMarkdownBoundary: defers two trailing backticks", () => {
  const { emit, hold } = splitMarkdownBoundary("code ``");
  assert.equal(emit, "code ");
  assert.equal(hold, "``");
});

test("splitMarkdownBoundary: defers fence opener plus partial language", () => {
  const { emit, hold } = splitMarkdownBoundary("\n```p");
  assert.equal(emit, "\n");
  assert.equal(hold, "```p");
});

test("splitMarkdownBoundary: emits plain triple backticks unchanged", () => {
  const { emit, hold } = splitMarkdownBoundary("code\n```");
  assert.equal(emit, "code\n```");
  assert.equal(hold, "");
});

test("splitMarkdownBoundary: defers single trailing asterisk in opener context", () => {
  const { emit, hold } = splitMarkdownBoundary("This is *");
  assert.equal(emit, "This is ");
  assert.equal(hold, "*");
});

test("splitMarkdownBoundary: does not defer closing delimiter after alphanumerics", () => {
  const { emit, hold } = splitMarkdownBoundary("code`");
  assert.equal(emit, "code`");
  assert.equal(hold, "");
});

test("splitMarkdownBoundary: preserves whitespace boundaries", () => {
  const { emit, hold } = splitMarkdownBoundary("Hello, ");
  assert.equal(emit, "Hello, ");
  assert.equal(hold, "");
});

// -- OpenAI to Claude streaming boundary cases -------------------------------

function createOpenAIState() {
  return {
    toolCalls: new Map(),
    _pendingXmlToolCalls: [],
    _xmlInvokeBuffer: "",
    _markdownBuffer: "",
  };
}

test("OpenAI to Claude: code fence language is not split across chunks", () => {
  const state = createOpenAIState();
  const chunk1 = openaiToClaudeResponse(
    {
      id: "chatcmpl-md1",
      model: "gpt-4.1",
      choices: [{ index: 0, delta: { content: "Here is code:\n\n```p" }, finish_reason: null }],
    },
    state
  );
  const chunk2 = openaiToClaudeResponse(
    {
      id: "chatcmpl-md1",
      model: "gpt-4.1",
      choices: [
        { index: 0, delta: { content: "ython\nprint(1)\n```" }, finish_reason: "stop" },
      ],
      usage: { prompt_tokens: 2, completion_tokens: 10, total_tokens: 12 },
    },
    state
  );
  const result = flatten([chunk1, chunk2]);
  const textDeltas = getTextDeltas(result);
  assert.deepEqual(textDeltas, ["Here is code:\n\n", "```python\nprint(1)\n```"]);
});

test("OpenAI to Claude: bold marker is not split across chunks", () => {
  const state = createOpenAIState();
  const chunk1 = openaiToClaudeResponse(
    {
      id: "chatcmpl-md2",
      model: "gpt-4.1",
      choices: [{ index: 0, delta: { content: "This is **" }, finish_reason: null }],
    },
    state
  );
  const chunk2 = openaiToClaudeResponse(
    {
      id: "chatcmpl-md2",
      model: "gpt-4.1",
      choices: [{ index: 0, delta: { content: "bold** text" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 2, completion_tokens: 5, total_tokens: 7 },
    },
    state
  );
  const result = flatten([chunk1, chunk2]);
  const textDeltas = getTextDeltas(result);
  assert.deepEqual(textDeltas, ["This is ", "**bold** text"]);
});

test("OpenAI to Claude: flushes held boundary on finish", () => {
  const state = createOpenAIState();
  const chunk1 = openaiToClaudeResponse(
    {
      id: "chatcmpl-md3",
      model: "gpt-4.1",
      choices: [{ index: 0, delta: { content: "inline `code" }, finish_reason: null }],
    },
    state
  );
  const chunk2 = openaiToClaudeResponse(
    {
      id: "chatcmpl-md3",
      model: "gpt-4.1",
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
    },
    state
  );
  const result = flatten([chunk1, chunk2]);
  const textDeltas = getTextDeltas(result);
  assert.deepEqual(textDeltas, ["inline ", "`code"]);
});

test("OpenAI to Claude: finish flushes a fully-held boundary before message stop", () => {
  const state = createOpenAIState();
  const chunk1 = openaiToClaudeResponse(
    {
      id: "chatcmpl-held-finish",
      model: "gpt-4.1",
      choices: [{ index: 0, delta: { content: "`" }, finish_reason: null }],
    },
    state
  );
  const chunk2 = openaiToClaudeResponse(
    {
      id: "chatcmpl-held-finish",
      model: "gpt-4.1",
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    },
    state
  );
  const result = flatten([chunk1, chunk2]);

  assert.deepEqual(getTextDeltas(result), ["`"]);
  assert.equal(state._markdownBuffer, "");
  assert.deepEqual(
    result.slice(1).map((event) => (event as Record<string, unknown>).type),
    [
      "content_block_start",
      "content_block_delta",
      "content_block_stop",
      "message_delta",
      "message_stop",
    ]
  );
});

test("OpenAI to Claude: tool call flushes a fully-held boundary before tool use", () => {
  const state = createOpenAIState();
  const chunk1 = openaiToClaudeResponse(
    {
      id: "chatcmpl-held-tool",
      model: "gpt-4.1",
      choices: [{ index: 0, delta: { content: "`" }, finish_reason: null }],
    },
    state
  );
  const chunk2 = openaiToClaudeResponse(
    {
      id: "chatcmpl-held-tool",
      model: "gpt-4.1",
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: 0,
                id: "call_held_tool",
                function: { name: "bash", arguments: '{"command":"pwd"}' },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
    },
    state
  );
  const result = flatten([chunk1, chunk2]);
  const contentEvents = result.filter((event) =>
    String((event as Record<string, unknown>).type).startsWith("content_block_")
  );

  assert.deepEqual(getTextDeltas(result), ["`"]);
  assert.equal(state._markdownBuffer, "");
  assert.deepEqual(
    contentEvents.map((event) => {
      const record = event as Record<string, unknown>;
      const contentBlock = record.content_block as Record<string, unknown> | undefined;
      const delta = record.delta as Record<string, unknown> | undefined;
      return [record.type, contentBlock?.type ?? delta?.type ?? null];
    }),
    [
      ["content_block_start", "text"],
      ["content_block_delta", "text_delta"],
      ["content_block_stop", null],
      ["content_block_start", "tool_use"],
      ["content_block_delta", "input_json_delta"],
      ["content_block_stop", null],
    ]
  );
});

test("OpenAI to Claude: whitespace between chunks is still preserved", () => {
  const state = createOpenAIState();
  const chunk1 = openaiToClaudeResponse(
    {
      id: "chatcmpl-space",
      model: "gpt-4.1",
      choices: [{ index: 0, delta: { content: "Hello, " }, finish_reason: null }],
    },
    state
  );
  const chunk2 = openaiToClaudeResponse(
    {
      id: "chatcmpl-space",
      model: "gpt-4.1",
      choices: [{ index: 0, delta: { content: "world." }, finish_reason: "stop" }],
      usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
    },
    state
  );
  const result = flatten([chunk1, chunk2]);
  const textDeltas = getTextDeltas(result);
  assert.deepEqual(textDeltas, ["Hello, ", "world."]);
  assert.equal(textDeltas.join(""), "Hello, world.");
});

// -- Gemini to Claude streaming boundary cases -------------------------------

function createGeminiState() {
  return {
    _xmlInvokeBuffer: "",
    _markdownBuffer: "",
  };
}

function geminiChunk(text: string, finish = false) {
  return {
    responseId: "msg-md-gemini",
    modelVersion: "gemini-2.0",
    candidates: [
      {
        content: { parts: [{ text }] },
        finishReason: finish ? "STOP" : undefined,
      },
    ],
  };
}

test("Gemini to Claude: code fence language is not split across chunks", () => {
  const state = createGeminiState();
  const chunk1 = geminiToClaudeResponse(geminiChunk("Here is code:\n\n```p"), state);
  const chunk2 = geminiToClaudeResponse(geminiChunk("ython\nprint(1)\n```", true), state);
  const result = flatten([chunk1, chunk2]);
  const textDeltas = getTextDeltas(result);
  assert.deepEqual(textDeltas, ["Here is code:\n\n", "```python\nprint(1)\n```"]);
});

test("Gemini to Claude: bold marker is not split across chunks", () => {
  const state = createGeminiState();
  const chunk1 = geminiToClaudeResponse(geminiChunk("This is **"), state);
  const chunk2 = geminiToClaudeResponse(geminiChunk("bold** text", true), state);
  const result = flatten([chunk1, chunk2]);
  const textDeltas = getTextDeltas(result);
  assert.deepEqual(textDeltas, ["This is ", "**bold** text"]);
});

test("Gemini to Claude: flushes held boundary before tool call transition", () => {
  const state = createGeminiState();
  const chunk1 = geminiToClaudeResponse(geminiChunk("Run `ls"), state);
  const chunk2 = geminiToClaudeResponse(
    {
      responseId: "msg-md-gemini",
      modelVersion: "gemini-2.0",
      candidates: [
        {
          content: {
            parts: [
              { text: "` then" },
              {
                functionCall: {
                  name: "bash",
                  args: { command: "ls -la" },
                },
              },
            ],
          },
          finishReason: "STOP",
        },
      ],
    },
    state
  );
  const result = flatten([chunk1, chunk2]);
  const textDeltas = getTextDeltas(result);
  assert.deepEqual(textDeltas, ["Run ", "`ls` then"]);
  const toolStart = result.find(
    (e) =>
      (e as Record<string, unknown>)?.type === "content_block_start" &&
      ((e as Record<string, unknown>).content_block as Record<string, unknown>)?.type === "tool_use"
  );
  assert.ok(toolStart, "expected tool_use block after flushed text");
});

test("Gemini to Claude: fully-held chunk emits no empty text_delta (#11606 R1)", () => {
  const state = createGeminiState();
  // Chunk 1 ends with a single backtick (opener context) -> fully held.
  const chunk1 = geminiToClaudeResponse(geminiChunk("Run `", false), state);
  // Chunk 2 continues with the inline code body + closing backtick.
  const chunk2 = geminiToClaudeResponse(geminiChunk("ls` done", true), state);
  const result = flatten([chunk1, chunk2]);
  const textDeltas = getTextDeltas(result);
  // No zero-length delta may appear; the boundary flushes joined on chunk 2.
  assert.ok(
    textDeltas.every((d) => d.length > 0),
    `zero-length text_delta emitted: ${JSON.stringify(textDeltas)}`
  );
  assert.deepEqual(textDeltas, ["Run ", "`ls` done"]);
  // The trailing backtick is held; only the real text "Run " is emitted on
  // chunk 1. In particular NO zero-length text_delta may appear (the R1
  // finding: a fully-held "cleaned" chunk used to open a text block and fire
  // an empty delta for nothing).
  const chunk1TextDeltas = (chunk1 as unknown as Record<string, unknown>[])
    .filter(
      (e) =>
        (e as Record<string, unknown>)?.type === "content_block_delta" &&
        ((e as Record<string, unknown>).delta as Record<string, unknown>)?.type === "text_delta"
    )
    .map(
      (e) =>
        ((e as Record<string, unknown>).delta as Record<string, unknown>).text ?? ""
    );
  assert.deepEqual(chunk1TextDeltas, ["Run "]);
});
