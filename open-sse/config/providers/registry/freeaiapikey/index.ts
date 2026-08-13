import type { RegistryEntry } from "../../shared.ts";

export const freeaiapikeyProvider: RegistryEntry = {
  id: "freeaiapikey",
  alias: "faik",
  format: "openai",
  executor: "default",
  // 2026-08-13: the apex host answers 410 `endpoint_moved` on every /v1 route and
  // names its own replacement — "Please update your base_url to
  // https://api.freeaiapikey.com/v1". The api. host serves /v1/models (200) and
  // /v1/chat/completions (405 on GET, i.e. POST-only as expected).
  baseUrl: "https://api.freeaiapikey.com/v1/chat/completions",
  modelsUrl: "https://api.freeaiapikey.com/v1/models",
  authType: "apikey",
  authHeader: "bearer",
  defaultContextLength: 128000,
  models: [
    { id: "openai/gpt-5", name: "GPT-5 (via FreeAIAPIKey)", contextLength: 400000 },
    { id: "openai/gpt-4o", name: "GPT-4o (via FreeAIAPIKey)" },
    { id: "openai/gpt-5.2-codex", name: "GPT-5.2 Codex (via FreeAIAPIKey)" },
    {
      id: "anthropic/claude-opus-4.6",
      name: "Claude Opus 4.6 (via FreeAIAPIKey)",
      contextLength: 1000000,
    },
    {
      id: "anthropic/claude-sonnet-4.6",
      name: "Claude Sonnet 4.6 (via FreeAIAPIKey)",
      contextLength: 1000000,
    },
    {
      id: "Alibaba/qwen3.5",
      name: "Qwen 3.5 (via FreeAIAPIKey)",
      contextLength: 128000,
    },
    {
      id: "Alibaba/qwen3-vl:235b",
      name: "Qwen 3 VL 235B (via FreeAIAPIKey)",
      contextLength: 128000,
    },
  ],
};
