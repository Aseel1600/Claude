import test from "node:test";
import assert from "node:assert/strict";

const { openaiToClaudeResponse } =
  await import("../../open-sse/translator/response/openai-to-claude.ts");

function createState() {
  return {
    toolCalls: new Map(),
    _pendingXmlToolCalls: [],
    _xmlInvokeBuffer: "",
  };
}

/**
 * #11817: openaiToClaudeResponse() discarded the real usage block whenever it
 * arrived on a trailing chunk shaped `{choices: [], usage: {...}}` — the shape
 * upstreams using `stream_options.include_usage` (confirmed: Fireworks, e.g.
 * accounts/fireworks/models/kimi-k3) send it in. The early `!chunk.choices?.[0]`
 * guard returned null before the usage-capture block ever ran, so
 * cache_read_input_tokens / cache_creation_input_tokens were silently lost and
 * downstream Claude-format clients only ever saw OmniRoute's own estimate.
 *
 * Companion to #9536 / PR #9657, which fixed the same field mapping on the
 * non-streaming /v1/messages path.
 */

test("#11817: trailing choices:[] chunk with real usage updates state.usage (cache read)", () => {
  const state = createState();

  // Normal content + finish_reason chunk, no usage yet (typical mid-stream shape).
  openaiToClaudeResponse(
    {
      id: "chatcmpl-1",
      model: "accounts/fireworks/models/kimi-k3",
      choices: [{ index: 0, delta: { content: "Hi" }, finish_reason: null }],
    },
    state
  );
  openaiToClaudeResponse(
    {
      id: "chatcmpl-1",
      model: "accounts/fireworks/models/kimi-k3",
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    },
    state
  );

  // Trailing usage-only chunk, exactly as Fireworks sends it.
  const trailing = openaiToClaudeResponse(
    {
      id: "chatcmpl-1",
      model: "accounts/fireworks/models/kimi-k3",
      choices: [],
      usage: {
        prompt_tokens: 6103,
        total_tokens: 6119,
        completion_tokens: 16,
        prompt_tokens_details: { cached_tokens: 6102 },
        completion_tokens_details: { reasoning_tokens: 16 },
      },
    },
    state
  );

  // No choice to process on this chunk, so no Claude events are emitted for it.
  assert.equal(trailing, null);

  // But state.usage must reflect the real, provider-reported numbers.
  assert.equal(state.usage.input_tokens, 1); // 6103 - 6102 cached
  assert.equal(state.usage.cache_read_input_tokens, 6102);
  assert.equal(state.usage.output_tokens, 16);
  assert.equal(state.usage.cache_creation_input_tokens, undefined);
});

test("#11817: trailing choices:[] chunk with no usage is still a safe no-op", () => {
  const state = createState();
  const result = openaiToClaudeResponse({ id: "chatcmpl-2", choices: [] }, state);
  assert.equal(result, null);
  assert.equal(state.usage, undefined);
});
