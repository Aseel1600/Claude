import type { RegistryEntry } from "../../shared.ts";

export const uncloseaiProvider: RegistryEntry = {
  id: "uncloseai",
  alias: "unc",
  format: "openai",
  executor: "default",
  baseUrl: "https://hermes.ai.unturf.com/v1/chat/completions",
  // Live model catalog for the no-auth discovery path. UncloseAI is a no-auth
  // provider (#8864/#11064), so /api/providers/[id]/models routes through
  // buildNoAuthModelsResponse, which only performs live discovery when the
  // registry entry declares a modelsUrl (otherwise it serves the static seed
  // below). Point it at the upstream /v1/models list so the keyless catalog
  // stays fresh; the `models` array remains the offline fallback.
  modelsUrl: "https://hermes.ai.unturf.com/v1/models",
  authType: "optional",
  authHeader: "bearer",
  models: [
    {
      id: "adamo1139/Hermes-3-Llama-3.1-8B-FP8-Dynamic",
      name: "Hermes 3 Llama 3.1 8B (🆓 Free)",
    },
    { id: "qwen3.6:27b", name: "Qwen3 Coder 27B (🆓 Free)" },
    { id: "gemma4:31b", name: "Gemma 4 31B (🆓 Free)" },
  ],
};
