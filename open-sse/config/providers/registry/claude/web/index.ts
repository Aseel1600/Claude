import type { RegistryEntry } from "../../../shared.ts";

export const claude_webProvider: RegistryEntry = {
  id: "claude-web",
  alias: "cw",
  format: "openai",
  executor: "claude-web",
  baseUrl: "https://claude.ai/api/organizations",
  authType: "apikey",
  authHeader: "cookie",
  models: [
    {
      id: "claude-opus-5",
      name: "Claude Opus 5 (web)",
      toolCalling: false,
      supportsReasoning: true,
      supportsVision: true,
      contextLength: 1000000,
      maxOutputTokens: 128000,
    },
    { id: "claude-sonnet-5", name: "Claude 5 Sonnet (web)" },
    { id: "claude-sonnet-4-6", name: "Claude 4.6 Sonnet (web)" },
    { id: "claude-haiku-4-5", name: "Claude 4.5 Haiku (web)" },
  ],
};
