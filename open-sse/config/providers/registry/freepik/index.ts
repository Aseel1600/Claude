/**
 * Freepik (Magnific Mystic) image provider registry entry.
 * Extracted into its own module to keep open-sse/config/imageRegistry.ts
 * under the file-size cap (god-file decomposition; semantic split).
 */
export const FREEPIK_IMAGE_PROVIDER = {
  id: "freepik",
  // Freepik's developer API rebranded to Magnific. Official host/header are
  // api.magnific.com + x-magnific-api-key (docs.magnific.com). The legacy
  // api.freepik.com / x-freepik-api-key pair still accepts the same keys
  // during the transition, but new integrations should use Magnific.
  alias: "magnific",
  baseUrl: "https://api.magnific.com/v1/ai/mystic",
  statusUrl: "https://api.magnific.com/v1/ai/mystic",
  authType: "apikey",
  authHeader: "x-magnific-api-key",
  format: "freepik-image", // custom: async submit task_id, then poll GET /{task_id}
  models: [
    { id: "realism", name: "Mystic Realism" },
    { id: "fluid", name: "Mystic Fluid (Imagen 3)" },
    { id: "zen", name: "Mystic Zen" },
    { id: "flexible", name: "Mystic Flexible" },
    { id: "super_real", name: "Mystic Super Real" },
    { id: "editorial_portraits", name: "Mystic Editorial Portraits" },
  ],
  supportedSizes: ["1024x1024", "1024x1792", "1792x1024"],
};
