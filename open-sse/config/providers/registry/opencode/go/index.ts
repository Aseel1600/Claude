import type { RegistryEntry } from "../../../shared.ts";

export const opencode_goProvider: RegistryEntry = {
  id: "opencode-go",
  alias: "opencode-go",
  format: "openai",
  executor: "opencode",
  baseUrl: "https://opencode.ai/zen/go/v1",
  // (#532) Key validation must hit the main zen endpoint (same key works for both tiers)
  testKeyBaseUrl: "https://opencode.ai/zen/v1",
  authType: "apikey",
  authHeader: "Authorization",
  authPrefix: "Bearer",
  defaultContextLength: 200000,
  models: [
    { id: "glm-5.3", name: "GLM-5.3", supportsReasoning: true },
    { id: "glm-5.2-max", name: "GLM-5.2 (max)", supportsReasoning: true },
    { id: "glm-5.2-high", name: "GLM-5.2 (high)", supportsReasoning: true },
    { id: "glm-5.2", name: "GLM-5.2", supportsReasoning: true },
    // OpenAI
    { id: "gpt-5.6-luna", name: "GPT 5.6 Luna", contextLength: 1048576, supportsReasoning: true },
    //Kimi
    { id: "kimi-k3-max", name: "Kimi K3 (max)", supportsReasoning: true },
    { id: "kimi-k3", name: "Kimi K3", supportsReasoning: true },
    { id: "kimi-k2.7-code", name: "Kimi K2.7 Code" },
    //MiMo
    { id: "mimo-v2.5-pro", name: "MiMo-V2.5-Pro", supportsReasoning: true },
    { id: "mimo-v2.5-max", name: "MiMo-V2.5 (max)", supportsReasoning: true },
    { id: "mimo-v2.5-high", name: "MiMo-V2.5 (high)", supportsReasoning: true },
    { id: "mimo-v2.5", name: "MiMo-V2.5", supportsReasoning: true },
    //MiniMax
    { id: "minimax-m3", name: "MiniMax M3", targetFormat: "claude", contextLength: 1048576, supportsVision: true },
    //Qwen
    { id: "qwen3.8-max", name: "Qwen3.8 Max", targetFormat: "claude", supportsVision: false },
    { id: "qwen3.7-max-max", name: "Qwen3.7 Max (max)", targetFormat: "claude", supportsVision: false, supportsReasoning: true },
    { id: "qwen3.7-max-high", name: "Qwen3.7 Max (high)", targetFormat: "claude", supportsVision: false, supportsReasoning: true },
    { id: "qwen3.7-max", name: "Qwen3.7 Max", targetFormat: "claude", supportsVision: false },
    { id: "qwen3.7-plus-max", name: "Qwen3.7 Plus (max)", targetFormat: "claude", supportsVision: false, supportsReasoning: true },
    { id: "qwen3.7-plus-high", name: "Qwen3.7 Plus (high)", targetFormat: "claude", supportsVision: false, supportsReasoning: true },
    { id: "qwen3.7-plus", name: "Qwen3.7 Plus", targetFormat: "claude", supportsVision: false },
    // Hunyuan
    { id: "hy3-high", name: "Hunyuan3 (high)", contextLength: 256000, supportsReasoning: true },
    { id: "hy3-low", name: "Hunyuan3 (low)", contextLength: 256000, supportsReasoning: true },
    { id: "hy3", name: "Hunyuan3", contextLength: 256000, supportsReasoning: true },
    //Grok
    { id: "grok-4.5-high", name: "Grok 4.5 (high)", supportsReasoning: true },
    { id: "grok-4.5-medium", name: "Grok 4.5 (medium)", supportsReasoning: true },
    { id: "grok-4.5-low", name: "Grok 4.5 (low)", supportsReasoning: true },
    { id: "grok-4.5", name: "Grok 4.5", supportsReasoning: true },
    //DeepSeek
    { id: "deepseek-v4-pro-max", name: "DeepSeek V4 Pro (max)", supportsReasoning: true },
    { id: "deepseek-v4-pro-high", name: "DeepSeek V4 Pro (high)", supportsReasoning: true },
    { id: "deepseek-v4-pro-medium", name: "DeepSeek V4 Pro (medium)", supportsReasoning: true },
    { id: "deepseek-v4-pro-low", name: "DeepSeek V4 Pro (low)", supportsReasoning: true },
    { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", supportsReasoning: true },
    { id: "deepseek-v4-flash-max", name: "DeepSeek V4 Flash (max)", supportsReasoning: true },
    { id: "deepseek-v4-flash-high", name: "DeepSeek V4 Flash (high)", supportsReasoning: true },
    { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash", supportsReasoning: true },
  ],
};
