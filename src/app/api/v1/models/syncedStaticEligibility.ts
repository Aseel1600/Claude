/**
 * #9167 — "synced replaces static" skip decision for the /v1/models catalog builder,
 * extracted as a pure leaf for unit testing.
 *
 * When a non-curated provider has synced ≥1 live model, the builder prefers synced
 * rows over static registry rows to avoid duplicate ids. The original guard skipped
 * EVERY static registry model for such a provider, which dropped brand-new registry
 * models (e.g. `claude-opus-5` / `claude-sonnet-5`) that the upstream provider's live
 * `/v1/models` does not advertise yet. This restores those by skipping a static entry
 * only when the synced set actually carries the same id.
 */
export function shouldSkipStaticForSynced(
  providerModels: Array<{ id: string }>,
  modelId: string,
  hasSyncedModels: boolean,
  syncedIds: Set<string> | undefined,
  isRegisteredEffortVariant: (pm: Array<{ id: string }>, id: string) => boolean
): boolean {
  if (!hasSyncedModels) return false;
  // Effort variants are gateway-synthesized, never synced — they must always survive.
  if (isRegisteredEffortVariant(providerModels, modelId)) return false;
  return syncedIds?.has(modelId) === true;
}
