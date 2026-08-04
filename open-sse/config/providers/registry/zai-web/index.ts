import type { RegistryEntry } from "../../shared.ts";

export const zai_webProvider: RegistryEntry = {
  id: "zai-web",
  alias: "zw",
  format: "openai",
  executor: "zai-web",
  // Free consumer web chat at chat.z.ai (Zhipu AI) — see
  // `open-sse/executors/zai-web.ts` for the cookie/session wire format.
  // Distinct from the API-key `zai`/`glm` providers (api.z.ai).
  baseUrl: "https://chat.z.ai",
  authType: "apikey",
  authHeader: "cookie",
  // Catalog verified live against GET https://chat.z.ai/api/models (2026-08-04).
  // `glm-4.6` / `glm-4.5` / `glm-4.5v` were retired upstream — glm-4.6 now
  // answers HTTP 500 and the other two are absent from the catalog entirely.
  // Context/vision/tool flags come from each entry's `info.params.max_tokens`
  // and `info.meta.capabilities`. Ids the SPA marks `hidden: true` are still
  // routable and kept here. Refresh via the provider's model-discovery flow.
  models: [
    { id: "glm-5.2", name: "GLM-5.2", toolCalling: true, contextLength: 64064 },
    { id: "GLM-5.1", name: "GLM-5.1", toolCalling: true, contextLength: 32000 },
    { id: "GLM-5-Turbo", name: "GLM-5-Turbo", toolCalling: true, contextLength: 32000 },
    { id: "GLM-5v-Turbo", name: "GLM-5V-Turbo", toolCalling: true, supportsVision: true },
    { id: "glm-4.7", name: "GLM-4.7", toolCalling: true, contextLength: 40000 },
    {
      id: "glm-4.6v",
      name: "GLM-4.6V (Vision)",
      toolCalling: true,
      supportsVision: true,
      contextLength: 16000,
    },
    { id: "0727-106B-API", name: "GLM-4.5-Air", toolCalling: true, contextLength: 80000 },
    { id: "0727-360B-API", name: "GLM-4.5", toolCalling: true, contextLength: 80000 },
    {
      id: "GLM-4.1V-Thinking-FlashX",
      name: "GLM-4.1V-9B-Thinking",
      toolCalling: true,
      supportsVision: true,
      supportsReasoning: true,
    },
    { id: "0808-360B-DR", name: "0808-360B-DR", toolCalling: true },
    { id: "deep-research", name: "Z1-Rumination", supportsReasoning: true },
    { id: "zero", name: "Z1-32B", supportsReasoning: true, contextLength: 4096 },
    { id: "glm-4-air-250414", name: "GLM-4-32B" },
    { id: "glm-4-flash", name: "GLM-4-Flash" },
  ],
};
