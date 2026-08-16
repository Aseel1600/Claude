import type { RegistryEntry } from "../../../shared.ts";

export const opencode_zenProvider: RegistryEntry = {
  id: "opencode-zen",
  alias: "opencode-zen",
  format: "openai",
  executor: "opencode",
  baseUrl: "https://opencode.ai/zen/v1",
  modelsUrl: "https://opencode.ai/zen/v1/models",
  authType: "apikey",
  authHeader: "Authorization",
  authPrefix: "Bearer",
  defaultContextLength: 200000,
  // Curated from https://opencode.ai/zen/v1/models, excluding models whose
  // published support window has already ended.
  passthroughModels: true,
  models: [
    // ── GPT ──────────────────────────────────────────
    { id: "gpt-5.6-sol", name: "GPT 5.6 Sol" },
    { id: "gpt-5.6-terra", name: "GPT 5.6 Terra" },
    { id: "gpt-5.6-luna", name: "GPT 5.6 Luna" },
    { id: "gpt-5.5", name: "GPT 5.5" },
    { id: "gpt-5.4", name: "GPT 5.4" },
    { id: "gpt-5.4-mini", name: "GPT 5.4 Mini" },
    { id: "gpt-5.4-nano", name: "GPT 5.4 Nano" },
    { id: "gpt-5.3-codex-spark", name: "GPT 5.3 Codex Spark" },
    { id: "gpt-5.1", name: "GPT 5.1" },
    { id: "gpt-5-nano", name: "GPT 5 Nano", contextLength: 400000 },

    // ── Claude ─────────────────────────────────────────────────
    { id: "claude-fable-5", name: "Claude Fable 5" },
    { id: "claude-opus-5", name: "Claude Opus 5" },
    { id: "claude-sonnet-5", name: "Claude Sonnet 5" },
    { id: "claude-haiku-4-5", name: "Claude Haiku 4.5" },

    // ── Gemini ─────────────────────────────────────────────────
    { id: "gemini-3.7-flash", name: "Gemini 3.7 Flash" },
    { id: "gemini-3.5-flash-lite", name: "Gemini 3.5 Flash Lite" },
    { id: "gemini-3.1-pro", name: "Gemini 3.1 Pro" },
    { id: "gemini-3-flash", name: "Gemini 3 Flash" },

    // ── Grok ───────────────────────────────────────────────────
    { id: "grok-4.6", name: "Grok 4.6" },
    { id: "grok-build-0.1", name: "Grok Build 0.1" },

    // ── Muse ───────────────────────────────────────────────────
    { id: "muse-spark-1.2", name: "Muse Spark 1.2" },

    // ── DeepSeek ───────────────────────────────────────────────
    { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", supportsReasoning: true },
    { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash", supportsReasoning: true },

    // ── GLM / Z.AI ─────────────────────────────────────────────
    { id: "glm-5.2", name: "GLM-5.2" },

    // ── MiniMax ────────────────────────────────────────────────
    { id: "minimax-m3", name: "MiniMax M3", contextLength: 1048576, supportsVision: true },

    // ── Kimi / Moonshot ────────────────────────────────────────
    { id: "kimi-k3", name: "Kimi K3" },
    { id: "kimi-k2.7-code", name: "Kimi K2.7 Code" },

    // ── Qwen ───────────────────────────────────────────────────
    // Issue #2292: Qwen models return Claude-format SSE bodies even
    // when hitting /chat/completions. targetFormat: "claude" routes
    // through /messages and the Claude translator.
    { id: "qwen3.6-plus", name: "Qwen3.6 Plus", targetFormat: "claude", supportsVision: false },
    { id: "qwen3.5-plus", name: "Qwen3.5 Plus", targetFormat: "claude", supportsVision: false },

    // ── Free Tier ──────────────────────────────────────────────
    { id: "big-pickle", name: "Big Pickle", supportsReasoning: true, interleavedField: "reasoning_content" },
    { id: "deepseek-v4-flash-free", name: "DeepSeek V4 Flash Free", supportsReasoning: true },
    { id: "mimo-v2.5-free", name: "MiMo V2.5 Free", contextLength: 200000 },
    { id: "hy3-free", name: "HY3 Free", contextLength: 200000 },
    { id: "nemotron-3-ultra-free", name: "Nemotron 3 Ultra Free", contextLength: 1000000 },
    { id: "nemotron-3.5-lightning-free", name: "Nemotron 3.5 Lightning Free", contextLength: 1000000 },
    { id: "laguna-s-2.1-free", name: "Laguna S 2.1 Free", contextLength: 131000 },
  ],
};
