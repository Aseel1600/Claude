export const OMNIROUTE_RESPONSE_HEADERS = {
  cache: "X-OmniRoute-Cache",
  cacheHit: "X-OmniRoute-Cache-Hit",
  compression: "X-OmniRoute-Compression",
  contextMaxInput: "X-OmniRoute-Context-Max-Input",
  contextMaxOutput: "X-OmniRoute-Context-Max-Output",
  contextSource: "X-OmniRoute-Context-Source",
  contextWindow: "X-OmniRoute-Context-Window",
  costSaved: "X-OmniRoute-Cost-Saved",
  decision: "X-OmniRoute-Decision",
  fallbackAttempts: "X-OmniRoute-Fallback-Attempts",
  latencyMs: "X-OmniRoute-Latency-Ms",
  model: "X-OmniRoute-Model",
  progress: "X-OmniRoute-Progress",
  provider: "X-OmniRoute-Provider",
  requestId: "X-OmniRoute-Request-Id",
  responseCost: "X-OmniRoute-Response-Cost",
  tokensIn: "X-OmniRoute-Tokens-In",
  tokensOut: "X-OmniRoute-Tokens-Out",
  version: "X-OmniRoute-Version",
} as const;

/**
 * Provenance of the context-window figures reported by `X-OmniRoute-Context-*`,
 * ordered from most to least trustworthy. It mirrors the resolution chain in
 * `open-sse/services/contextManager.ts::resolveTokenLimit` so a caller can tell a
 * measured window from an inferred one.
 *
 * The distinction matters for clients that schedule compaction against the
 * advertised window: `heuristic` (derived from the model NAME) and `default`
 * (generic catch-all) are guesses, and a client that treats them like a
 * catalog-backed figure will either compact too early or overflow upstream.
 *
 * Closed set on purpose — `buildOmniRouteResponseMetaHeaders` refuses to emit
 * anything outside it, so the header can never carry a free-form internal string.
 */
export const OMNIROUTE_CONTEXT_SOURCES = [
  /** Operator-set environment override for the provider. */
  "env",
  /** Operator-set per-model override (`model_context_overrides`, source `manual`). */
  "override:manual",
  /** Reconciled from provider discovery (`model_context_overrides`, source `auto:discovery`). */
  "override:auto",
  /** Synced model catalog (models.dev / provider import). */
  "catalog",
  /** Provider default from the registry — not model-specific. */
  "registry",
  /** Inferred from the model name. A guess. */
  "heuristic",
  /** Generic catch-all default. A guess with no provider/model signal at all. */
  "default",
] as const;

export type OmniRouteContextSource = (typeof OMNIROUTE_CONTEXT_SOURCES)[number];

/** Type guard for {@link OMNIROUTE_CONTEXT_SOURCES}. */
export function isOmniRouteContextSource(value: unknown): value is OmniRouteContextSource {
  return (
    typeof value === "string" && (OMNIROUTE_CONTEXT_SOURCES as readonly string[]).includes(value)
  );
}
