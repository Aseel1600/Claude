import test from "node:test";
import assert from "node:assert/strict";

const { geminiToClaudeResponse } =
  await import("../../open-sse/translator/response/gemini-to-claude.ts");
const { buildGeminiThoughtSignatureKey, getGeminiThoughtSignature } =
  await import("../../open-sse/services/geminiThoughtSignatureStore.ts");

function flatten(items) {
  return items.flatMap((item) => item || []);
}

test("Gemini -> Claude stream: text block stays open across sequential text chunks", () => {
  const state = {};
  const first = geminiToClaudeResponse(
    {
      responseId: "resp-1",
      modelVersion: "gemini-2.5-pro",
      candidates: [{ content: { parts: [{ text: "Hello" }] } }],
    },
    state
  );
  const second = geminiToClaudeResponse(
    {
      candidates: [{ content: { parts: [{ text: " world" }] } }],
    },
    state
  );
  const result = flatten([first, second]);

  assert.equal(result[0].type, "message_start");
  assert.equal(result[1].type, "content_block_start");
  assert.equal(result[1].index, 0);
  assert.equal(result[2].delta.text, "Hello");
  assert.equal(result[3].type, "content_block_delta");
  assert.equal(result[3].index, 0);
  assert.equal(result[3].delta.text, " world");
});

test("Gemini -> Claude stream: thinking chunk closes text block and emits thinking block", () => {
  const state = {};
  geminiToClaudeResponse(
    {
      responseId: "resp-2",
      modelVersion: "gemini-2.5-pro",
      candidates: [{ content: { parts: [{ text: "Hello" }] } }],
    },
    state
  );

  const result = geminiToClaudeResponse(
    {
      candidates: [{ content: { parts: [{ thought: true, text: "Plan" }] } }],
    },
    state
  );

  assert.equal(result[0].type, "content_block_stop");
  assert.equal(result[0].index, 0);
  assert.equal(result[1].content_block.type, "thinking");
  assert.equal(result[2].delta.thinking, "Plan");
  assert.equal(result[3].type, "content_block_stop");
});

test("Gemini -> Claude stream: functionCall becomes tool_use and MAX_TOKENS maps to max_tokens", () => {
  const state = {
    toolNameMap: new Map([
      [
        "read_multiple_files_bundle_ab12cd34",
        "mcp__filesystem__read_multiple_files_with_validation_and_metadata_bundle_v2",
      ],
    ]),
  };
  const result = geminiToClaudeResponse(
    {
      responseId: "resp-3",
      modelVersion: "gemini-2.5-pro",
      candidates: [
        {
          content: {
            parts: [
              {
                functionCall: {
                  name: "read_multiple_files_bundle_ab12cd34",
                  args: { path: "/tmp/a" },
                },
              },
            ],
          },
          finishReason: "MAX_TOKENS",
        },
      ],
      usageMetadata: {
        promptTokenCount: 5,
        candidatesTokenCount: 3,
        thoughtsTokenCount: 2,
        cachedContentTokenCount: 1,
      },
    },
    state
  );

  assert.equal(result[1].content_block.type, "tool_use");
  assert.equal(
    result[1].content_block.name,
    "mcp__filesystem__read_multiple_files_with_validation_and_metadata_bundle_v2"
  );
  assert.match(result[1].content_block.id, /^toolu_/);
  assert.equal(result[2].delta.partial_json, JSON.stringify({ path: "/tmp/a" }));
  assert.equal(result[3].type, "content_block_stop");
  assert.equal(result[4].delta.stop_reason, "tool_use");
  assert.equal(result[4].usage.input_tokens, 5);
  assert.equal(result[4].usage.output_tokens, 5);
  assert.equal(result[4].usage.cache_read_input_tokens, 1);
  assert.equal(result[5].type, "message_stop");
});

test("Gemini -> Claude stream: STOP after prior tool use still maps to tool_use", () => {
  const state = {};
  geminiToClaudeResponse(
    {
      responseId: "resp-4",
      modelVersion: "gemini-2.5-pro",
      candidates: [
        {
          content: {
            parts: [{ functionCall: { name: "weather", args: { city: "Sao Paulo" } } }],
          },
        },
      ],
    },
    state
  );

  const result = geminiToClaudeResponse(
    {
      candidates: [{ content: { parts: [] }, finishReason: "STOP" }],
    },
    state
  );

  assert.equal(result[0].type, "message_delta");
  assert.equal(result[0].delta.stop_reason, "tool_use");
  assert.equal(result[1].type, "message_stop");
});

test("Gemini -> Claude stream: response wrapper is supported and promptFeedback-only chunk is ignored", () => {
  const wrapped = geminiToClaudeResponse(
    {
      response: {
        responseId: "resp-5",
        modelVersion: "gemini-2.5-pro",
        candidates: [{ content: { parts: [{ text: "wrapped" }] } }],
      },
    },
    {}
  );

  assert.equal(wrapped[0].type, "message_start");
  assert.equal(wrapped[2].delta.text, "wrapped");
  assert.equal(geminiToClaudeResponse({ promptFeedback: { blockReason: "SAFETY" } }, {}), null);
});

test("Gemini -> Claude stream: persists the thought_signature keyed by the emitted tool_use id", () => {
  const state = { signatureNamespace: "conn-sig" };
  const result = geminiToClaudeResponse(
    {
      responseId: "resp-sig",
      modelVersion: "gemini-2.5-pro",
      candidates: [
        {
          content: {
            parts: [
              {
                thoughtSignature: "SIG_ABC",
                functionCall: { id: "fc-sig-1", name: "Bash", args: { cmd: "ls" } },
              },
            ],
          },
          finishReason: "STOP",
        },
      ],
    },
    state
  );

  assert.equal(result[1].content_block.type, "tool_use");
  assert.equal(result[1].content_block.id, "fc-sig-1");
  // The signature must be cached (namespaced like the request side) so claude-to-gemini can
  // re-attach it to the functionCall on the next turn — without this the direct Gemini path
  // 400s every relayed tool call with "missing a thought_signature".
  assert.equal(
    getGeminiThoughtSignature(buildGeminiThoughtSignatureKey("conn-sig", "fc-sig-1")),
    "SIG_ABC"
  );
});

test("Gemini -> Claude stream: preserves the client's exact tool casing and strips default_api: prefix", () => {
  // TitleCase Claude Code client: tool_use must come back as "Bash", not force-lowercased
  // "bash" (REVERSE_MAP applies only to Anthropic-target lowercase clients, never Gemini).
  const state = { toolNameMap: new Map([["Bash", "Bash"]]) };
  const result = geminiToClaudeResponse(
    {
      responseId: "resp-case",
      modelVersion: "gemini-2.5-pro",
      candidates: [
        {
          content: {
            parts: [{ functionCall: { id: "fc-1", name: "default_api:Bash", args: {} } }],
          },
          finishReason: "STOP",
        },
      ],
    },
    state
  );
  assert.equal(result[1].content_block.type, "tool_use");
  assert.equal(result[1].content_block.name, "Bash");

  // Unknown tool not in the map: keep the (prefix-stripped) Gemini name as-is.
  const emptyMapState = { toolNameMap: new Map() };
  const fallback = geminiToClaudeResponse(
    {
      responseId: "resp-case-2",
      modelVersion: "gemini-2.5-pro",
      candidates: [
        {
          content: {
            parts: [{ functionCall: { id: "fc-2", name: "default_api:WebSearch", args: {} } }],
          },
          finishReason: "STOP",
        },
      ],
    },
    emptyMapState
  );
  assert.equal(fallback[1].content_block.name, "WebSearch");
});
