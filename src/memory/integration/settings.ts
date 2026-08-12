/**
 * Pipeline memory settings — the new per-API-key settings shape used by the
 * L0 capture + 4-layer recall/injection pipeline.
 *
 * Hard cutover from the legacy `memoryEnabled` field. Capture and injection are
 * controlled independently (`captureEnabled`, `injectionEnabled`) and both default
 * to FALSE — there is no silent opt-in. The legacy `memoryEnabled` is preserved
 * ONLY as an explicit migration path: if it is true, it is honored as a true
 * value for both capture and injection (i.e. existing operators that turned it
 * on in the old UI keep their behavior). It is NEVER promoted to `true` from
 * a missing/false state.
 *
 * Future storage layer (src/lib/memory/db) will expose a per-API-key
 * `getMemoryPipelineSettings(apiKeyId)`; until then, an injectable resolver is
 * exposed via `setMemoryPipelineSettingsResolver` and the default adapter reads
 * operator env vars + falls back to the legacy `memoryEnabled` only if it is
 * explicitly `true`.
 */

export interface MemoryPipelineSettings {
  /** L0 capture: persist last user + assistant visible text into the raw message store. */
  captureEnabled: boolean;
  /** 4-layer recall: inject L3 (cacheable system suffix) + L2 (nav) + L1 (dynamic top-5) into the context. */
  injectionEnabled: boolean;
  /** Hard cap on injected L3 (system suffix) character budget. */
  l3CharBudget: number;
  /** Hard cap on injected L2 (navigation index) character budget. */
  l2CharBudget: number;
  /** Hard cap on injected L1 (dynamic recall) character budget. */
  l1CharBudget: number;
  /** Total cap on injected characters across all layers; defaults to max(requestTokens||2000) * 4. */
  totalCharBudget: number;
  /** Recall timeout for the dynamic L1 retrieval — failures must NOT block the pipeline. */
  recallTimeoutMs: number;
  /** Was the legacy `memoryEnabled` true? If yes, this resolver returned captureEnabled+injectionEnabled=true. */
  migratedFromLegacy: boolean;
}

export const DEFAULT_MEMORY_PIPELINE_SETTINGS: MemoryPipelineSettings = {
  captureEnabled: false,
  injectionEnabled: false,
  l3CharBudget: 600,
  l2CharBudget: 600,
  l1CharBudget: 600,
  totalCharBudget: 8000,
  recallTimeoutMs: 5000,
  migratedFromLegacy: false,
};

export type MemoryPipelineSettingsResolver = (
  apiKeyId: string | null
) => MemoryPipelineSettings | Promise<MemoryPipelineSettings>;

let resolver: MemoryPipelineSettingsResolver = defaultMemoryPipelineSettingsResolver;

/**
 * Override the resolver (used by future storage layer wiring). The pipeline
 * imports this module so the default adapter is in place; tests and integration
 * code can swap in a mocked or DB-backed resolver.
 */
export function setMemoryPipelineSettingsResolver(next: MemoryPipelineSettingsResolver): void {
  resolver = next;
}

export function getMemoryPipelineSettingsResolver(): MemoryPipelineSettingsResolver {
  return resolver;
}

export async function resolveMemoryPipelineSettings(
  apiKeyId: string | null
): Promise<MemoryPipelineSettings> {
  try {
    const result = await resolver(apiKeyId);
    return normalizePipelineSettings(result);
  } catch {
    return DEFAULT_MEMORY_PIPELINE_SETTINGS;
  }
}

/**
 * Pure normalizer: clamps budgets, forces booleans, fills missing fields with defaults.
 * Exported so tests can verify the safe-defaults behavior without touching the resolver.
 */
export function normalizePipelineSettings(
  raw: Partial<MemoryPipelineSettings> | null | undefined
): MemoryPipelineSettings {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_MEMORY_PIPELINE_SETTINGS };
  return {
    captureEnabled: raw.captureEnabled === true,
    injectionEnabled: raw.injectionEnabled === true,
    l3CharBudget: clampInt(raw.l3CharBudget, DEFAULT_MEMORY_PIPELINE_SETTINGS.l3CharBudget, 0, 64_000),
    l2CharBudget: clampInt(raw.l2CharBudget, DEFAULT_MEMORY_PIPELINE_SETTINGS.l2CharBudget, 0, 64_000),
    l1CharBudget: clampInt(raw.l1CharBudget, DEFAULT_MEMORY_PIPELINE_SETTINGS.l1CharBudget, 0, 64_000),
    totalCharBudget: clampInt(raw.totalCharBudget, DEFAULT_MEMORY_PIPELINE_SETTINGS.totalCharBudget, 0, 64_000),
    recallTimeoutMs: clampInt(raw.recallTimeoutMs, DEFAULT_MEMORY_PIPELINE_SETTINGS.recallTimeoutMs, 1, 60_000),
    migratedFromLegacy: raw.migratedFromLegacy === true,
  };
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const n = Math.floor(value);
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

/**
 * Default env/DB adapter. Reads:
 *   - OMNIROUTE_MEMORY_CAPTURE_ENABLED / OMNIROUTE_MEMORY_INJECTION_ENABLED
 *   - OMNIROUTE_MEMORY_L0_CAPTURE / OMNIROUTE_MEMORY_INJECTION (legacy aliases)
 *   - memoryEnabled (legacy global) — ONLY honored if explicitly true.
 *     A missing/false value does NOT enable capture or injection.
 *
 * Each env var is parsed strictly: "true"/"1"/"yes" -> true (case-insensitive).
 * Any other value or missing -> false.
 */
export function defaultMemoryPipelineSettingsResolver(
  apiKeyId: string | null
): MemoryPipelineSettings {
  const captureEnv =
    readBoolEnv("OMNIROUTE_MEMORY_CAPTURE_ENABLED") ??
    readBoolEnv("OMNIROUTE_MEMORY_L0_CAPTURE");
  const injectionEnv =
    readBoolEnv("OMNIROUTE_MEMORY_INJECTION_ENABLED") ??
    readBoolEnv("OMNIROUTE_MEMORY_INJECTION");

  // Legacy memoryEnabled is honored ONLY if explicitly true.
  // apiKeyId is accepted (and ignored) so the per-key DB layer can wire it later.
  void apiKeyId;
  const legacyEnabled = readBoolEnv("MEMORY_ENABLED") ?? false;

  // Migration: legacy memoryEnabled=true historically meant "on" — preserve that
  // exact behavior for existing operators. NEVER default to true.
  const captureEnabled = captureEnv === true;
  const injectionEnabled = injectionEnv === true;
  const migratedFromLegacy = legacyEnabled === true;

  return {
    ...DEFAULT_MEMORY_PIPELINE_SETTINGS,
    captureEnabled: captureEnabled || (migratedFromLegacy && captureEnv === null),
    injectionEnabled: injectionEnabled || (migratedFromLegacy && injectionEnv === null),
    migratedFromLegacy,
  };
}

function readBoolEnv(name: string): boolean | null {
  const raw = process.env[name];
  if (raw === undefined || raw === null) return null;
  const v = String(raw).trim().toLowerCase();
  if (v === "true" || v === "1" || v === "yes") return true;
  if (v === "false" || v === "0" || v === "no" || v === "") return false;
  return null;
}

/**
 * Reset the resolver back to the default env/DB adapter. Tests only.
 */
export function resetMemoryPipelineSettingsResolverForTests(): void {
  resolver = defaultMemoryPipelineSettingsResolver;
}
