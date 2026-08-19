/**
 * Context requirements filtering for combo targets.
 * Applies minContextWindow, preferLargeContext, and contextFilterMode
 * from combo config to filter and sort targets by context window size.
 */

import { getModelContextLimit } from "../../../src/lib/modelCapabilities";
import type { ComboLogger, ResolvedComboTarget } from "./types.ts";

export interface ContextRequirements {
  minContextWindow?: number;
  maxContextWindow?: number;
  preferLargeContext?: boolean;
  contextFilterMode?: "strict" | "strict-hard" | "lenient";
}

/**
 * Fold a per-request `X-OmniRoute-Min-Context` value into a combo's stored
 * context requirements.
 *
 * The per-request value can only TIGHTEN, never loosen: the effective floor is
 * the larger of the two. A combo's stored `minContextWindow` is an operator
 * policy, and a header travelling with client traffic must not be able to
 * weaken it — otherwise any caller could opt out of a routing constraint the
 * operator put there on purpose. Raising it is safe by the same reasoning: the
 * caller is asking for less headroom risk than the operator required, never
 * more.
 *
 * Returns the original object untouched when there is nothing to fold in, so
 * the overwhelming majority of requests (no header) allocate nothing and reach
 * `applyContextRequirements` byte-identically.
 */
export function mergeRequestMinContext(
  requirements: ContextRequirements | undefined,
  requestMinContextWindow: number | null | undefined
): ContextRequirements | undefined {
  if (
    typeof requestMinContextWindow !== "number" ||
    !Number.isFinite(requestMinContextWindow) ||
    requestMinContextWindow <= 0
  ) {
    return requirements;
  }

  const stored = requirements?.minContextWindow;
  const effective =
    typeof stored === "number" && stored > requestMinContextWindow
      ? stored
      : requestMinContextWindow;

  return { ...(requirements ?? {}), minContextWindow: effective };
}

/**
 * Get context window size for a target model.
 * Returns null if unknown.
 */
function getTargetContextWindow(target: ResolvedComboTarget): number | null {
  const limit = getModelContextLimit(target.provider, target.modelStr);
  return typeof limit === "number" && limit > 0 ? limit : null;
}

/**
 * Apply context requirements filtering and sorting to combo targets.
 *
 * Filtering logic:
 * - If minContextWindow is set, filters out models below that threshold
 * - contextFilterMode determines handling of unknown context limits:
 *   - "strict": excludes models with unknown context limits
 *   - "strict-hard": same exclusion, but never fails open (see below)
 *   - "lenient": includes models with unknown context limits
 * - #8786 fail-open: when "strict" would empty the pool and at least one
 *   unknown-context target exists, restore those unknowns instead of returning
 *   [] (which becomes a false 404 "no executable targets"). Known-too-small
 *   targets are never resurrected.
 *
 * Why "strict-hard" exists: the #8786 fail-open makes "strict" a best-effort
 * preference, not a floor — a target whose window the catalog simply does not
 * know is admitted precisely when the pool would otherwise be empty. That is the
 * right default (a missing catalog entry should not manufacture a 404), but it
 * is the wrong contract for a caller that pins a session to a context tier and
 * needs "never below N" to mean it. "strict-hard" keeps the same exclusion rule
 * and drops only the rescue, so an exhausted pool surfaces as the dedicated
 * `context_requirements_exhausted` failure instead of silently routing to a
 * target of unknown capacity.
 *
 * Sorting logic:
 * - If preferLargeContext is true, sorts remaining targets by context size (descending)
 * - Unknown context limits sort to the end
 *
 * @param targets - Array of resolved combo targets
 * @param requirements - Context requirements from combo config
 * @param log - Combo logger for debug output
 * @returns Filtered and sorted targets array
 */
export function applyContextRequirements(
  targets: ResolvedComboTarget[],
  requirements: ContextRequirements | undefined,
  log: ComboLogger
): ResolvedComboTarget[] {
  if (!requirements || targets.length === 0) return targets;

  const {
    minContextWindow,
    maxContextWindow,
    preferLargeContext,
    contextFilterMode = "lenient",
  } = requirements;

  // No requirements specified
  if (!minContextWindow && !maxContextWindow && !preferLargeContext) return targets;

  let filtered = targets;

  // Apply minContextWindow filtering
  if (minContextWindow && minContextWindow > 0) {
    const beforeFilterCount = filtered.length;

    const classified = filtered.map((target) => ({
      target,
      contextWindow: getTargetContextWindow(target),
    }));

    filtered = classified
      .filter(({ contextWindow }) => {
        // Unknown context limit handling
        if (contextWindow === null) {
          return contextFilterMode === "lenient";
        }

        // Known context limit - check threshold
        return contextWindow >= minContextWindow;
      })
      .map(({ target }) => target);

    // #8786: strict must not turn an otherwise-executable combo into an empty
    // pool solely because the capability catalog lacks context metadata. When
    // no known-good target survives, fail open to the unknown-context set
    // (same spirit as the request-compat context fail-open path).
    //
    // Deliberately matches "strict" exactly: "strict-hard" opts out of this
    // rescue, which is the entire difference between the two modes.
    if (filtered.length === 0 && beforeFilterCount > 0 && contextFilterMode === "strict") {
      const unknowns = classified
        .filter(({ contextWindow }) => contextWindow === null)
        .map(({ target }) => target);
      if (unknowns.length > 0) {
        log.warn(
          "COMBO",
          `Context requirements: strict mode would empty the pool (${beforeFilterCount} targets, none known >= ${minContextWindow}); failing open to ${unknowns.length} unknown-context target(s)`
        );
        filtered = unknowns;
      }
    }

    if (filtered.length < beforeFilterCount) {
      log.info(
        "COMBO",
        `Context requirements: filtered ${beforeFilterCount} → ${filtered.length} targets (minContextWindow: ${minContextWindow}, mode: ${contextFilterMode})`
      );
      log.debug?.(
        "COMBO",
        `Context requirements: kept models ${filtered.map((t) => t.modelStr).join(", ")}`
      );
    }
  }

  // Apply maxContextWindow filtering
  if (maxContextWindow && maxContextWindow > 0) {
    const beforeFilterCount = filtered.length;

    filtered = filtered.filter((target) => {
      const contextWindow = getTargetContextWindow(target);

      // Unknown context limit handling
      if (contextWindow === null) {
        return contextFilterMode === "lenient";
      }

      // Known context limit - check threshold
      return contextWindow <= maxContextWindow;
    });

    if (filtered.length < beforeFilterCount) {
      log.info(
        "COMBO",
        `Context requirements: filtered ${beforeFilterCount} → ${filtered.length} targets (maxContextWindow: ${maxContextWindow}, mode: ${contextFilterMode})`
      );
      log.debug?.(
        "COMBO",
        `Context requirements: kept models ${filtered.map((t) => t.modelStr).join(", ")}`
      );
    }
  }

  // Apply preferLargeContext sorting
  if (preferLargeContext && filtered.length > 1) {
    filtered = [...filtered].sort((a, b) => {
      const aContext = getTargetContextWindow(a) ?? 0;
      const bContext = getTargetContextWindow(b) ?? 0;
      return bContext - aContext; // Descending order
    });

    log.debug?.(
      "COMBO",
      `Context requirements: sorted by context size (descending): ${filtered
        .map((t) => {
          const ctx = getTargetContextWindow(t);
          return `${t.modelStr}(${ctx === null ? "unknown" : ctx})`;
        })
        .join(", ")}`
    );
  }

  return filtered;
}
