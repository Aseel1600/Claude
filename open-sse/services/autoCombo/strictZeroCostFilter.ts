/**
 * STRICT_ZERO_COST — an opt-in, stricter sibling of `hidePaidModels`
 * (`paidModelFilter.ts`) for operators who need a hard guarantee against ANY
 * incremental monetary spend, not just "documented as free".
 *
 * `hidePaidModels` answers "is this model classified free in FREE_MODEL_BUDGETS
 * right now?" — a point-in-time catalog fact. It says nothing about whether a
 * `recurring-*`/`one-time-initial` candidate's allowance has since been
 * consumed, and nothing about whether exceeding it is a hard stop or silent
 * pay-as-you-go billing. STRICT_ZERO_COST adds exactly those two checks,
 * before ranking, before dispatch — never after.
 *
 * Design, kept deliberately close to `filterPaidOnlyCandidates`'s own stated
 * goal: "a pure, dependency-light function so the filter is unit-testable in
 * isolation". The live quota lookup (`getUsageForProvider`, cached with a TTL)
 * lives in `freeAccessQuota.ts` and is injected here as a plain function —
 * this file never imports the DB or makes a network call itself.
 *
 * No provider or model name appears anywhere in this file. A candidate passes
 * or fails purely on the metadata it carries (`freeType`, `tos`,
 * `hardStopGuaranteed`) plus, for quota-based types, a `FreeAccessState`
 * resolved elsewhere. A future provider that ships correct metadata is
 * handled automatically; one that doesn't is excluded automatically — see
 * `docs/routing/STRICT_ZERO_COST.md`.
 */
import {
  FREE_MODEL_BUDGETS,
  type FreeModelBudget,
} from "@omniroute/open-sse/config/freeModelCatalog.ts";

/** Types whose allowance needs no runtime verification: no credential exists
 * for the candidate at all, so no request against it can ever be billed. */
const KEYLESS_FREE_TYPES = new Set<FreeModelBudget["freeType"]>(["keyless"]);

/** Every other documented free type requires a live, fresh, guaranteed-hard-stop
 * quota check before it can pass. `discontinued` never passes either branch. */

export type FreeAccessStatus = "SAFE" | "EXHAUSTED" | "UNKNOWN";

/** Live-checked allowance state for one (provider, connection) pair. Resolved
 * and cached by `freeAccessQuota.ts`; passed in here as plain data so this
 * module stays free of DB/network dependencies. */
export interface FreeAccessState {
  status: FreeAccessStatus;
  /** Remaining free allowance in the provider's own unit (tokens, requests, or
   * USD-equivalent) — whatever `getUsageForProvider()` reports. `null` when
   * the provider's usage payload doesn't expose a numeric remaining figure. */
  remainingFreeAllowance: number | null;
  /** When the allowance next resets, if the provider reports it. */
  resetAt: string | null;
  /** When this state was fetched (ISO 8601) — used to detect staleness. */
  checkedAt: string;
}

interface StrictZeroCostCandidate {
  provider: string;
  model: string;
}

export interface StrictZeroCostOptions {
  /** Master switch — mirrors `hidePaidModels`'s own off-by-default shape. */
  enabled: boolean;
  /**
   * Resolves the live allowance state for a quota-based candidate. Returns
   * `undefined` when no usage capability exists for the provider at all (no
   * adapter registered in `USAGE_FETCHER_PROVIDERS`) — that is itself a
   * meaningful, terminal signal (UNKNOWN), not an error to retry.
   *
   * Synchronous by design: the caller (`virtualFactory.ts`) resolves and
   * caches every candidate's state up front, once per pool build, so this
   * filter itself never awaits a network call and stays trivially testable.
   */
  resolveFreeAccessState: (candidate: StrictZeroCostCandidate) => FreeAccessState | undefined;
  /** Minimum remaining allowance (in the unit `resolveFreeAccessState` reports
   * — percentage points for the built-in `freeAccessQuota.ts` resolver) a
   * quota-based candidate must exceed to pass. Must be >= 0; a fully-exhausted
   * account (`remainingFreeAllowance === 0`) fails at any non-negative
   * threshold via the strict `>` comparison below. */
  minRemainingAllowance: number;
  /** Maximum age, in ms, a `FreeAccessState.checkedAt` may have before it's
   * treated as stale (→ UNKNOWN, excluded). */
  maxStateAgeMs: number;
  /** `now` injection for deterministic tests; defaults to `Date.now`. */
  now?: () => number;
  /**
   * The free-model catalog to look candidates up against. Defaults to the
   * real, live `FREE_MODEL_BUDGETS` — overridable only so tests can prove the
   * autodiscovery contract (a provider/model that appears in the catalog is
   * automatically considered; one that's removed automatically disappears)
   * with synthetic fixtures instead of mutating global state. Production
   * callers should never pass this.
   */
  catalog?: readonly FreeModelBudget[];
}

export function findBudgetEntry(
  candidate: StrictZeroCostCandidate,
  catalog: readonly FreeModelBudget[] = FREE_MODEL_BUDGETS
): FreeModelBudget | undefined {
  return catalog.find((m) => m.provider === candidate.provider && m.modelId === candidate.model);
}

/**
 * Decide whether a single candidate satisfies STRICT_ZERO_COST. Pure —
 * takes the resolved `FreeAccessState` (if any) rather than fetching it.
 */
export function evaluateStrictZeroCost(
  candidate: StrictZeroCostCandidate,
  budgetEntry: FreeModelBudget | undefined,
  state: FreeAccessState | undefined,
  options: Pick<StrictZeroCostOptions, "minRemainingAllowance" | "maxStateAgeMs" | "now">
): boolean {
  // No matching entry in the catalog at all → paid, or genuinely unknown (a
  // new provider/model OmniRoute hasn't classified yet). Either way: exclude.
  // `budgetEntry` is the single source of truth here (matched by the caller
  // via `findBudgetEntry`, against the real `FREE_MODEL_BUDGETS` in
  // production) — this function never reaches past it into a second,
  // non-injectable classifier, so a future/synthetic catalog is trusted
  // exactly as much as the real one and nothing more.
  if (!budgetEntry) return false; // metadata incomplete for this exact model → UNKNOWN

  if (KEYLESS_FREE_TYPES.has(budgetEntry.freeType)) {
    return true; // no credential exists for this candidate — nothing to bill, ever
  }
  if (budgetEntry.freeType === "discontinued") return false;

  // Every remaining freeType (recurring-*, one-time-initial, and any future
  // type this module doesn't special-case) requires ALL of: a documented hard
  // stop, a live state, that state being SAFE, fresh, and above threshold.
  if (budgetEntry.hardStopGuaranteed !== true) return false;
  if (!state) return false; // no usage adapter for this provider, or lookup never ran
  if (state.status !== "SAFE") return false;

  const now = (options.now ?? Date.now)();
  const checkedAtMs = Date.parse(state.checkedAt);
  if (!Number.isFinite(checkedAtMs) || now - checkedAtMs > options.maxStateAgeMs) return false;

  if (state.remainingFreeAllowance === null) return false;
  // A negative threshold would let a negative/garbage reading pass; a caller
  // that genuinely wants "any allowance greater than zero" should pass 0.
  if (options.minRemainingAllowance < 0) return false;
  return state.remainingFreeAllowance > options.minRemainingAllowance;
}

/**
 * Pool-level filter, same shape/identity-preserving contract as
 * `filterPaidOnlyCandidates`: returns the input array unchanged when
 * `enabled` is false (the default), so wiring this in changes nothing until
 * an operator opts in.
 */
export function filterStrictZeroCostCandidates<T extends StrictZeroCostCandidate>(
  pool: T[],
  options: StrictZeroCostOptions
): T[] {
  if (!options.enabled) return pool;
  return pool.filter((candidate) => {
    const budgetEntry = findBudgetEntry(candidate);
    const needsState = budgetEntry && !KEYLESS_FREE_TYPES.has(budgetEntry.freeType);
    const state = needsState ? options.resolveFreeAccessState(candidate) : undefined;
    return evaluateStrictZeroCost(candidate, budgetEntry, state, options);
  });
}

/**
 * Separate, optional ToS guard — kept independent from economic safety on
 * purpose (Marco's requirement): a model can be economically SAFE and still
 * excluded here for ToS reasons, or left in when this guard is off even if
 * STRICT_ZERO_COST is on. Reuses the same curated `tos` field, no new data.
 */
export function filterTosAvoidCandidates<T extends StrictZeroCostCandidate>(
  pool: T[],
  excludeTosAvoid: boolean
): T[] {
  if (!excludeTosAvoid) return pool;
  return pool.filter((candidate) => {
    const budgetEntry = findBudgetEntry(candidate);
    return budgetEntry?.tos !== "avoid";
  });
}
