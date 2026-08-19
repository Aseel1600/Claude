/**
 * Route preview — answer "how much room will this request actually get?" WITHOUT
 * executing it.
 *
 * A client orchestrating across models with heterogeneous windows has to decide
 * whether to compact BEFORE it calls. Today it cannot: the resolved target (and
 * therefore its window) is only observable after the response comes back, so the
 * only safe policy is to compact against the smallest window it might hit —
 * which is a summarisation pass, a fidelity loss, and a reprocessed prefix on
 * every model switch, most of them unnecessary.
 *
 * This handler resolves the target chain structurally and reports the capacity
 * of each hop, plus the NARROWEST hop in the chain. The narrowest is the number
 * that actually matters: a request that fits it survives the entire fallback
 * chain without a mid-flight compaction, so the client can compact once (or not
 * at all) instead of re-compacting per degraded hop.
 *
 * Deliberately does NOT check live quota, cooldown or circuit-breaker state.
 * Those change between the preview and the real call, so reporting them would
 * invite a client to treat a preview as a reservation. Capacity is a property of
 * the model and is stable; availability is not.
 */

import { resolveContextCapacity } from "../services/contextManager.ts";
import type { OmniRouteContextSource } from "../../src/shared/constants/headers.ts";
import { parseModel } from "../services/model.ts";

/** Capacity of one hop in the resolved chain. */
export interface RoutePreviewHop {
  provider: string;
  model: string;
  contextWindow: number | null;
  maxInput: number | null;
  maxOutput: number | null;
  contextSource: OmniRouteContextSource;
}

export interface RoutePreviewResult {
  /** The model id exactly as requested. */
  model: string;
  /** True when the request resolved to a combo rather than a single model. */
  isCombo: boolean;
  /** Combo strategy name, or null for a single model. */
  strategy: string | null;
  /** Targets in the order they would be attempted. */
  chain: RoutePreviewHop[];
  /**
   * The tightest input budget across the whole chain — what a client must fit
   * to be safe for every fallback hop. Null when no hop has a known window.
   */
  narrowestInput: number | null;
  /** Hops whose capacity is unknown; a client cannot budget against these. */
  unknownCapacityHops: number;
}

/** A combo row, narrowed to what the preview actually reads. */
export interface ComboLike {
  name?: string | null;
  strategy?: string | null;
  /**
   * Hops as the database actually stores them: `normalizeComboRecord` emits
   * `{ version: 2, models: ComboStep[] }`, so this — not `targets` — is the
   * field every combo loaded through `getComboByName` carries.
   */
  models?: unknown;
  /**
   * Alternate spelling accepted for callers that hand-build a combo shape.
   * Read only when `models` is absent.
   */
  targets?: unknown;
}

function toHop(provider: string, model: string): RoutePreviewHop {
  const capacity = resolveContextCapacity(provider, model);
  return {
    provider,
    model,
    contextWindow: capacity.contextWindow,
    maxInput: capacity.maxInput,
    maxOutput: capacity.maxOutput,
    contextSource: capacity.source,
  };
}

/**
 * Effective input budget of one hop: the explicit input ceiling when the
 * resolver has a narrower one, else the total window.
 *
 * Conflating the two is exactly what let auto-compaction sail past the real
 * limit in #6191, so the narrowest calculation must prefer maxInput.
 */
export function hopInputBudget(hop: RoutePreviewHop): number | null {
  if (typeof hop.maxInput === "number" && hop.maxInput > 0) return hop.maxInput;
  if (typeof hop.contextWindow === "number" && hop.contextWindow > 0) return hop.contextWindow;
  return null;
}

/** Normalise a combo's stored `targets` into `{provider, model}` pairs. */
export function extractComboTargets(targets: unknown): Array<{ provider: string; model: string }> {
  const raw = typeof targets === "string" ? safeParseJson(targets) : targets;
  if (!Array.isArray(raw)) return [];

  const out: Array<{ provider: string; model: string }> = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const model = typeof record.model === "string" ? record.model.trim() : "";
    if (!model) continue;
    const declaredProvider =
      typeof record.provider === "string" && record.provider.trim() ? record.provider.trim() : null;
    // A target may carry the provider separately or as a `provider/model` id;
    // `parseModel` handles both and returns a null provider for a bare id.
    const parsed = parseModel(model);
    const provider = declaredProvider ?? parsed.provider ?? "unknown";
    out.push({ provider, model: parsed.model ?? model });
  }
  return out;
}

function safeParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/**
 * Build a route preview for `model`.
 *
 * `loadCombo` is injected so the pure shaping logic can be tested without a
 * database, and so the caller owns how combos are looked up.
 */
export function buildRoutePreview(
  model: string,
  loadCombo: (model: string) => ComboLike | null
): RoutePreviewResult {
  const combo = loadCombo(model);

  const chain: RoutePreviewHop[] = combo
    ? extractComboTargets(combo.models ?? combo.targets).map((t) => toHop(t.provider, t.model))
    : [singleModelHop(model)];

  let narrowestInput: number | null = null;
  let unknownCapacityHops = 0;
  for (const hop of chain) {
    const budget = hopInputBudget(hop);
    if (budget === null) {
      unknownCapacityHops++;
      continue;
    }
    if (narrowestInput === null || budget < narrowestInput) narrowestInput = budget;
  }

  return {
    model,
    isCombo: combo !== null,
    strategy: combo ? ((combo.strategy ?? null) as string | null) : null,
    chain,
    narrowestInput,
    unknownCapacityHops,
  };
}

function singleModelHop(model: string): RoutePreviewHop {
  const parsed = parseModel(model);
  return toHop(parsed.provider ?? "unknown", parsed.model ?? model);
}
