/**
 * Context-capacity fields for the OmniRoute response meta headers.
 *
 * Shared by the streaming and non-streaming success paths so both report the
 * same capacity for the same target — a client that sees one window on a
 * streamed reply and another on a buffered one cannot budget against either.
 *
 * Resolution is memoised in `resolveContextCapacity` (measured 810us uncached
 * vs 0.47us cached), so calling this per response is affordable.
 */

import { resolveContextCapacity } from "../../services/contextManager.ts";

type CapacityMeta = {
  contextWindow?: number;
  contextMaxInput?: number;
  contextMaxOutput?: number;
  contextSource?: string;
};

/**
 * Build the capacity fields for a resolved target.
 *
 * Returns `{}` — not zeroed fields — whenever the target or its window is
 * unknown, so `buildOmniRouteResponseMetaHeaders` emits nothing rather than
 * advertising a capacity nobody established. The provenance is withheld
 * alongside the window it describes: a source without a number tells a client
 * how much to trust a value it never received.
 */
export function buildContextCapacityMeta(
  provider: string | null | undefined,
  model: string | null | undefined,
  resolve: typeof resolveContextCapacity = resolveContextCapacity
): CapacityMeta {
  if (!provider || !model) return {};

  let capacity: ReturnType<typeof resolveContextCapacity>;
  try {
    capacity = resolve(provider, model);
  } catch {
    // Capacity reporting is advisory: a lookup failure must never cost the
    // caller their response.
    return {};
  }

  if (typeof capacity.contextWindow !== "number" || capacity.contextWindow <= 0) return {};

  return {
    contextWindow: capacity.contextWindow,
    ...(typeof capacity.maxInput === "number" && capacity.maxInput > 0
      ? { contextMaxInput: capacity.maxInput }
      : {}),
    ...(typeof capacity.maxOutput === "number" && capacity.maxOutput > 0
      ? { contextMaxOutput: capacity.maxOutput }
      : {}),
    contextSource: capacity.source,
  };
}
