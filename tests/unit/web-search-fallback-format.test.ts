import test from "node:test";
import assert from "node:assert/strict";

const {
  prepareWebSearchFallbackBody,
  supportsNativeWebSearchFallbackBypass,
  OMNIROUTE_WEB_SEARCH_FALLBACK_TOOL_NAME,
} = await import("../../open-sse/services/webSearchFallback.ts");

// Regression for #2390: when the target is a Responses-API provider, the injected
// omniroute_web_search tool must use the FLAT function shape ({ type, name }), not the
// nested Chat Completions shape ({ type, function: { name } }). On the Responses→Responses
// passthrough path nothing flattens it, so a nested tool reaches the upstream as
// tools[0].function.name and is rejected with "Missing required parameter: 'tools[0].name'".

function makeBody() {
  return {
    model: "gpt-5.5",
    messages: [{ role: "user", content: "search the web" }],
    tools: [{ type: "web_search" }],
  };
}

test("#2390 web_search fallback is FLAT for Responses API target", () => {
  const { body, fallback } = prepareWebSearchFallbackBody(makeBody(), {
    targetFormat: "openai-responses",
    nativeCodexPassthrough: false,
  });

  assert.equal(fallback.enabled, true);
  const injected = body.tools[0] as Record<string, unknown>;
  assert.equal(injected.type, "function");
  assert.equal(injected.name, OMNIROUTE_WEB_SEARCH_FALLBACK_TOOL_NAME);
  assert.equal(
    injected.function,
    undefined,
    "Responses API tool must not be nested under .function"
  );
  assert.ok(injected.parameters, "flat tool keeps top-level parameters");
});

test("#2390 web_search fallback stays NESTED for Chat Completions target", () => {
  const { body, fallback } = prepareWebSearchFallbackBody(makeBody(), {
    targetFormat: "openai",
    nativeCodexPassthrough: false,
  });

  assert.equal(fallback.enabled, true);
  const injected = body.tools[0] as Record<string, unknown>;
  assert.equal(injected.type, "function");
  const fn = injected.function as Record<string, unknown> | undefined;
  assert.ok(fn, "Chat Completions tool must be nested under .function");
  assert.equal(fn?.name, OMNIROUTE_WEB_SEARCH_FALLBACK_TOOL_NAME);
  assert.equal(
    injected.name,
    undefined,
    "Chat Completions tool must not expose a flat top-level name"
  );
});

test("#2390 tool_choice matches the injected tool shape per target format", () => {
  const responses = prepareWebSearchFallbackBody(
    { ...makeBody(), tool_choice: { type: "web_search" } },
    { targetFormat: "openai-responses", nativeCodexPassthrough: false }
  );
  const rChoice = responses.body.tool_choice as Record<string, unknown>;
  assert.equal(rChoice.name, OMNIROUTE_WEB_SEARCH_FALLBACK_TOOL_NAME);
  assert.equal(rChoice.function, undefined);

  const chat = prepareWebSearchFallbackBody(
    { ...makeBody(), tool_choice: { type: "web_search" } },
    { targetFormat: "openai", nativeCodexPassthrough: false }
  );
  const cChoice = chat.body.tool_choice as Record<string, unknown>;
  const cFn = cChoice.function as Record<string, unknown> | undefined;
  assert.equal(cFn?.name, OMNIROUTE_WEB_SEARCH_FALLBACK_TOOL_NAME);
});

// ── Native web-search bypass: predicate coverage for every native path ──

test("bypass predicate: true for native Codex passthrough", () => {
  assert.equal(
    supportsNativeWebSearchFallbackBypass({
      provider: "openai",
      sourceFormat: "openai-responses",
      targetFormat: "openai-responses",
      nativeCodexPassthrough: true,
    }),
    true
  );
});

test("bypass predicate: true when native Responses passthrough flag is set (#8964 xAI)", () => {
  // Callers OR codex|xai into nativeCodexPassthrough (existing flag = "any native lane").
  assert.equal(
    supportsNativeWebSearchFallbackBypass({
      provider: "xai-oauth",
      sourceFormat: "openai-responses",
      targetFormat: "openai-responses",
      nativeCodexPassthrough: true,
    }),
    true
  );
});

test("bypass predicate: true for Gemini target", () => {
  assert.equal(
    supportsNativeWebSearchFallbackBypass({
      provider: "gemini",
      sourceFormat: "openai",
      targetFormat: "gemini",
      nativeCodexPassthrough: false,
    }),
    true
  );
});

test("bypass predicate: true for first-party Claude passthrough", () => {
  assert.equal(
    supportsNativeWebSearchFallbackBypass({
      provider: "claude",
      sourceFormat: "claude",
      targetFormat: "claude",
      nativeCodexPassthrough: false,
    }),
    true
  );
});

test("bypass predicate: false for unknown Claude-compatible providers", () => {
  assert.equal(
    supportsNativeWebSearchFallbackBypass({
      provider: "anthropic-compatible-custom",
      sourceFormat: "claude",
      targetFormat: "claude",
      nativeCodexPassthrough: false,
    }),
    false
  );
});

// #4481: MiniMax's Anthropic-compatible endpoint claims Claude format but does NOT
// implement Anthropic's typed server tools, so forwarding web_search_20250305 untouched
// (the Claude->Claude bypass) makes api.minimax.io return HTTP 400 "invalid params,
// function name or parameters is empty (2013)". For such providers we must NOT bypass —
// the tool has to be converted to the omniroute_web_search function fallback (which the
// model accepts as a normal function tool).
test("bypass predicate: false for Claude -> Claude when provider lacks Anthropic server tools (minimax, #4481)", () => {
  assert.equal(
    supportsNativeWebSearchFallbackBypass({
      provider: "minimax",
      sourceFormat: "claude",
      targetFormat: "claude",
      nativeCodexPassthrough: false,
    }),
    false
  );
});

test("bypass predicate: still true for Claude -> Claude on a real Claude provider (regression guard, #4481)", () => {
  assert.equal(
    supportsNativeWebSearchFallbackBypass({
      provider: "anthropic",
      sourceFormat: "claude",
      targetFormat: "claude",
      nativeCodexPassthrough: false,
    }),
    true
  );
});

test("bypass predicate: false for standard OpenAI -> OpenAI", () => {
  assert.equal(
    supportsNativeWebSearchFallbackBypass({
      provider: "openai",
      sourceFormat: "openai",
      targetFormat: "openai",
      nativeCodexPassthrough: false,
    }),
    false
  );
});

test("bypass predicate: false when only the target is Claude (non-native tool must convert)", () => {
  // An OpenAI-format client hitting a Claude target sends an OpenAI-shaped web_search
  // tool that is NOT native Anthropic format, so it must still be converted. Only the
  // Claude -> Claude passthrough (native body) is bypassed.
  assert.equal(
    supportsNativeWebSearchFallbackBypass({
      provider: "claude",
      sourceFormat: "openai",
      targetFormat: "claude",
      nativeCodexPassthrough: false,
    }),
    false
  );
});

test("bypass predicate: false when only the source is Claude", () => {
  assert.equal(
    supportsNativeWebSearchFallbackBypass({
      provider: "openai",
      sourceFormat: "claude",
      targetFormat: "openai",
      nativeCodexPassthrough: false,
    }),
    false
  );
});

// ── Native web-search bypass: end-to-end body behavior ──

test("Claude -> Claude: native web_search_20250305 forwarded untouched", () => {
  const inputBody = {
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }],
  };
  const { body, fallback } = prepareWebSearchFallbackBody(inputBody, {
    provider: "claude",
    sourceFormat: "claude",
    targetFormat: "claude",
    nativeCodexPassthrough: false,
  });

  assert.equal(fallback.enabled, false);
  assert.equal(fallback.toolName, null);
  assert.equal(fallback.convertedToolCount, 0);
  // Body forwarded verbatim — the native tool reaches the Anthropic upstream as-is.
  assert.deepEqual(body, inputBody);
});

test("Claude -> Claude: bare web_search type also forwarded untouched", () => {
  // Even the bare (unversioned) web_search type is forwarded on the Claude passthrough,
  // because the Anthropic upstream owns web search. This is the explicit protection that
  // no longer depends on the versioned type being absent from the matcher set.
  const inputBody = { tools: [{ type: "web_search" }] };
  const { body, fallback } = prepareWebSearchFallbackBody(inputBody, {
    provider: "claude",
    sourceFormat: "claude",
    targetFormat: "claude",
    nativeCodexPassthrough: false,
  });

  assert.equal(fallback.enabled, false);
  assert.equal(fallback.toolName, null);
  assert.deepEqual(body, inputBody);
});

test("native Codex passthrough: built-in web_search_preview forwarded untouched", () => {
  // Symmetric end-to-end coverage for the Codex bypass.
  const inputBody = { tools: [{ type: "web_search_preview" }] };
  const { body, fallback } = prepareWebSearchFallbackBody(inputBody, {
    provider: "openai",
    sourceFormat: "openai-responses",
    targetFormat: "openai-responses",
    nativeCodexPassthrough: true,
  });

  assert.equal(fallback.enabled, false);
  assert.equal(fallback.toolName, null);
  assert.deepEqual(body, inputBody);
});

test("OpenAI -> Claude (non-passthrough): built-in web_search IS still converted", () => {
  // Regression guard: the new Claude bypass must NOT swallow the conversion path for a
  // non-native (OpenAI-format) client that merely targets a Claude provider.
  const inputBody = {
    tools: [{ type: "web_search", search_context_size: "low" }],
  };
  const { body, fallback } = prepareWebSearchFallbackBody(inputBody, {
    provider: "claude",
    sourceFormat: "openai",
    targetFormat: "claude",
    nativeCodexPassthrough: false,
  });

  assert.equal(fallback.enabled, true);
  assert.equal(fallback.toolName, OMNIROUTE_WEB_SEARCH_FALLBACK_TOOL_NAME);
  assert.equal(fallback.convertedToolCount, 1);
  const tools = (body.tools as Record<string, any>[]) || [];
  const toolNames = tools.map((t) => (t.function ? t.function.name : t.name));
  assert.ok(toolNames.includes(OMNIROUTE_WEB_SEARCH_FALLBACK_TOOL_NAME));
});

// ── #3384: per-model interceptSearch override wins over every native-bypass default ──

test("#3384 interceptSearchOverride=true forces interception even on the Claude->Claude bypass path", () => {
  assert.equal(
    supportsNativeWebSearchFallbackBypass({
      provider: "claude",
      sourceFormat: "claude",
      targetFormat: "claude",
      nativeCodexPassthrough: false,
      interceptSearchOverride: true,
    }),
    false,
    "explicit interceptSearch:true must NOT bypass, overriding the native Claude passthrough"
  );
});

test("#3384 interceptSearchOverride=false forces native passthrough even for a standard provider", () => {
  assert.equal(
    supportsNativeWebSearchFallbackBypass({
      provider: "openai",
      sourceFormat: "openai",
      targetFormat: "openai",
      nativeCodexPassthrough: false,
      interceptSearchOverride: false,
    }),
    true,
    "explicit interceptSearch:false must bypass even though OpenAI->OpenAI has no native default bypass"
  );
});

test("#3384 interceptSearchOverride=undefined falls through to the existing native-bypass defaults", () => {
  assert.equal(
    supportsNativeWebSearchFallbackBypass({
      provider: "claude",
      sourceFormat: "claude",
      targetFormat: "claude",
      nativeCodexPassthrough: false,
      interceptSearchOverride: undefined,
    }),
    true,
    "no override configured — default Claude->Claude bypass still applies"
  );
});

test("#3384 end-to-end: interceptSearchOverride=true converts the tool on the Claude->Claude bypass path", () => {
  const inputBody = { tools: [{ type: "web_search" }] };
  const { fallback } = prepareWebSearchFallbackBody(inputBody, {
    provider: "claude",
    sourceFormat: "claude",
    targetFormat: "claude",
    nativeCodexPassthrough: false,
    interceptSearchOverride: true,
  });

  assert.equal(fallback.enabled, true);
  assert.equal(fallback.toolName, OMNIROUTE_WEB_SEARCH_FALLBACK_TOOL_NAME);
});

// #6459: Claude Code v2.1.220 sends tool_choice as { type: "tool", name: "web_search_20250305" }.
// isBuiltInWebSearchToolChoice only checked .type, missing tool-typed choices where the
// Anthropic server tool name lives in .name. That left tool_choice unrewritten while
// tools were converted to omniroute_web_search — upstream 400 "No tools provided for
// tool choice `web_search`" (Mistral Medium 3.5, 2026-07-27).
test("tool_choice {type:tool, name:web_search_20250305} is rewritten per target format (Chat)", () => {
  const inputBody = {
    tools: [{ type: "web_search_20250305", name: "web_search" }],
    tool_choice: { type: "tool", name: "web_search_20250305" },
  };
  const { body, fallback } = prepareWebSearchFallbackBody(inputBody, {
    provider: "mistral",
    sourceFormat: "claude",
    targetFormat: "openai",
    nativeCodexPassthrough: false,
  });

  assert.equal(fallback.enabled, true);
  assert.equal(fallback.convertedToolCount, 1);
  const cChoice = body.tool_choice as Record<string, unknown>;
  const cFn = cChoice.function as Record<string, unknown> | undefined;
  assert.equal(
    cFn?.name,
    OMNIROUTE_WEB_SEARCH_FALLBACK_TOOL_NAME,
    "tool_choice must be rewritten to reference the injected omniroute_web_search tool"
  );
});

// Production payload from Claude Code v2.1.220 (2026-07-28): the Anthropic
// *tool* carries the dated type, but tool_choice references it by its plain
// name — { type: "tool", name: "web_search" }. Neither field matches the
// dated pattern, so detection missed it and tool_choice stayed pointing at
// "web_search" while tools became omniroute_web_search → Mistral 400
// "No tools provided for tool choice `web_search`".
test("tool_choice {type:tool, name:web_search} (plain name) is rewritten", () => {
  const inputBody = {
    tools: [{ type: "web_search_20250305", name: "web_search" }],
    tool_choice: { type: "tool", name: "web_search" },
  };
  const { body, fallback } = prepareWebSearchFallbackBody(inputBody, {
    provider: "mistral",
    sourceFormat: "claude",
    targetFormat: "openai",
    nativeCodexPassthrough: false,
  });

  assert.equal(fallback.enabled, true);
  const choice = body.tool_choice as Record<string, unknown>;
  const fn = choice.function as Record<string, unknown> | undefined;
  assert.equal(
    fn?.name,
    OMNIROUTE_WEB_SEARCH_FALLBACK_TOOL_NAME,
    "plain-name tool_choice must be rewritten to omniroute_web_search"
  );
});

test("tool_choice {type:tool, name:web_search_20250305} is rewritten per target format (Responses)", () => {
  const inputBody = {
    tools: [{ type: "web_search_20250305", name: "web_search" }],
    tool_choice: { type: "tool", name: "web_search_20250305" },
  };
  const { body, fallback } = prepareWebSearchFallbackBody(inputBody, {
    provider: "mistral",
    sourceFormat: "claude",
    targetFormat: "openai-responses",
    nativeCodexPassthrough: false,
  });

  assert.equal(fallback.enabled, true);
  assert.equal(fallback.convertedToolCount, 1);
  const rChoice = body.tool_choice as Record<string, unknown>;
  assert.equal(
    rChoice.name,
    OMNIROUTE_WEB_SEARCH_FALLBACK_TOOL_NAME,
    "Responses tool_choice must use flat {type, name} pointing to omniroute_web_search"
  );
  assert.equal(rChoice.function, undefined);
});

// Anthropic rejects an EMPTY domain list on its server web-search tool:
// "tools.0.web_search_20250305.blocked_domains: Empty list of domains is
// ambiguous. Provide at least one domain or null." Claude Code sends
// `allowed_domains: []` / `blocked_domains: []`, and the Claude -> Claude
// bypass forwards the tool verbatim, so the 400 lands on the user. Empty
// arrays must be dropped on the native passthrough (omitted == unrestricted).
test("Claude -> Claude: empty allowed_domains/blocked_domains are dropped from the native tool", () => {
  const inputBody = {
    tools: [
      {
        type: "web_search_20250305",
        name: "web_search",
        max_uses: 5,
        allowed_domains: [],
        blocked_domains: [],
      },
    ],
  };
  const { body, fallback } = prepareWebSearchFallbackBody(inputBody, {
    provider: "claude",
    sourceFormat: "claude",
    targetFormat: "claude",
    nativeCodexPassthrough: false,
  });

  // Still a native bypass — the Anthropic upstream owns web search.
  assert.equal(fallback.enabled, false);
  assert.equal(fallback.toolName, null);

  const tool = (body.tools as Record<string, unknown>[])[0];
  assert.equal(tool.allowed_domains, undefined, "empty allowed_domains must be omitted");
  assert.equal(tool.blocked_domains, undefined, "empty blocked_domains must be omitted");
  // Everything else survives untouched.
  assert.equal(tool.type, "web_search_20250305");
  assert.equal(tool.name, "web_search");
  assert.equal(tool.max_uses, 5);
});

test("Claude -> Claude: non-empty domain lists are preserved verbatim", () => {
  const inputBody = {
    tools: [
      {
        type: "web_search_20250305",
        name: "web_search",
        allowed_domains: ["anthropic.com"],
        blocked_domains: [],
      },
    ],
  };
  const { body } = prepareWebSearchFallbackBody(inputBody, {
    provider: "claude",
    sourceFormat: "claude",
    targetFormat: "claude",
    nativeCodexPassthrough: false,
  });

  const tool = (body.tools as Record<string, unknown>[])[0];
  assert.deepEqual(tool.allowed_domains, ["anthropic.com"], "populated list must survive");
  assert.equal(tool.blocked_domains, undefined, "empty sibling must still be dropped");
});

test("fallback schema carries non-empty Anthropic domain constraints", () => {
  const { body, fallback } = prepareWebSearchFallbackBody(
    {
      tools: [
        {
          type: "web_search_20250305",
          name: "web_search",
          allowed_domains: ["edsheeran.com"],
          blocked_domains: ["example.com"],
        },
      ],
    },
    { targetFormat: "openai", nativeCodexPassthrough: false }
  );

  assert.equal(fallback.enabled, true);
  const tool = (body.tools as Array<Record<string, unknown>>)[0];
  const fn = tool.function as Record<string, unknown>;
  const schema = fn.parameters as Record<string, unknown>;
  const properties = schema.properties as Record<string, unknown>;
  const filters = properties.filters as Record<string, unknown>;
  const filterProperties = filters.properties as Record<string, Record<string, unknown>>;
  assert.deepEqual(filterProperties.include_domains.default, ["edsheeran.com"]);
  assert.deepEqual(filterProperties.exclude_domains.default, ["example.com"]);
});

test("Claude -> Claude: tools without empty domain arrays are not cloned unnecessarily", () => {
  // Regression guard for the untouched-passthrough contract: when there is
  // nothing to normalize, the body must be forwarded verbatim.
  const inputBody = {
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }],
  };
  const { body } = prepareWebSearchFallbackBody(inputBody, {
    provider: "claude",
    sourceFormat: "claude",
    targetFormat: "claude",
    nativeCodexPassthrough: false,
  });
  assert.deepEqual(body, inputBody);
});
