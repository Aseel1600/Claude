/**
 * @file simulatorTargets.ts
 * @description Map persisted combo steps (schema v2) onto the flat target shape
 * used by the Combo Playground simulator.
 */

export interface SimulatorTarget {
  provider: string;
  model: string;
  weight?: number;
}

/**
 * Persisted combos are stored in schema v2 (`normalizeComboRecord`), whose steps
 * live under `models: ComboStep[]` — there is no top-level `targets` array. The
 * simulator used to read `combo.targets`, which is always `undefined` for a
 * persisted combo, so the target loop threw
 * "Cannot read properties of undefined (reading 'length')" and every request
 * returned HTTP 500 (#11822).
 *
 * Map the three step kinds onto the simulator's flat target shape. The provider
 * comes from `step.providerId` or the `provider/model` prefix of `step.model` —
 * never a top-level `step.provider`, which does not exist.
 */
export function comboStepsToTargets(
  combo: Record<string, unknown>,
  warnings: string[]
): SimulatorTarget[] {
  const raw = (combo as { models?: unknown }).models;
  const steps: unknown[] = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
      ? (() => {
          try {
            const parsed: unknown = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
          } catch {
            return [];
          }
        })()
      : [];

  const targets: SimulatorTarget[] = [];

  for (const step of steps) {
    if (!step || typeof step !== "object") continue;
    const s = step as Record<string, unknown>;
    const weight = typeof s.weight === "number" ? s.weight : undefined;

    if (s.kind === "combo-ref") {
      warnings.push(
        `Step references combo "${String(s.comboName)}" — nested combos are not expanded by the simulator.`
      );
      continue;
    }

    if (s.kind === "provider-wildcard") {
      warnings.push(
        `Step "${String(s.providerId)}/${String(s.modelPattern)}" is a provider wildcard — expanded at runtime, shown here unresolved.`
      );
      targets.push({
        provider: String(s.providerId ?? "unknown"),
        model: String(s.modelPattern ?? "*"),
        weight,
      });
      continue;
    }

    const modelRef = typeof s.model === "string" ? s.model : "";
    if (!modelRef) continue;
    const slash = modelRef.indexOf("/");
    const prefixProvider = slash > 0 ? modelRef.slice(0, slash) : null;
    const bareModel = slash > 0 ? modelRef.slice(slash + 1) : modelRef;
    const providerId = typeof s.providerId === "string" && s.providerId ? s.providerId : null;

    targets.push({
      provider: providerId ?? prefixProvider ?? "unknown",
      model: bareModel,
      weight,
    });
  }

  return targets;
}
