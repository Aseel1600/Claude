/**
 * Regression for #11822 — POST /api/playground/simulate-route returned HTTP 500
 * ("Simulation error: Cannot read properties of undefined (reading 'length')")
 * for every persisted combo, making the Combo Playground page unusable.
 *
 * The route read `combo.targets`, but `getCombos()` returns records normalized
 * by `normalizeComboRecord()` — schema version 2, whose steps live under
 * `models: ComboStep[]`. There is no `targets` property, so the target loop
 * dereferenced `undefined.length`. The inline `body.combo` branch worked only
 * because the caller supplies `targets` explicitly.
 *
 * A second, quieter mismatch: a step's provider comes from `step.providerId` or
 * the `provider/model` prefix of `step.model`, never a top-level `step.provider`
 * — so the connection lookup would have produced spurious
 * "Provider undefined not configured" warnings even once targets were populated.
 *
 * Runner: node --import tsx/esm --test tests/unit/playground-simulate-route-combo-steps-11822.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";

const { comboStepsToTargets } = await import("../../src/lib/combos/simulatorTargets.ts");

test("#11822 — model steps map to targets, provider from prefix or providerId", () => {
  const warnings: string[] = [];
  const targets = comboStepsToTargets(
    {
      id: "abc",
      name: "h-route-claude-opus-5",
      strategy: "priority",
      version: 2,
      models: [
        { id: "s1", kind: "model", model: "cc/claude-opus-5", weight: 1 },
        { id: "s2", kind: "model", model: "anthropic/claude-opus-5", weight: 2 },
        { id: "s3", kind: "model", model: "gpt-5", providerId: "openai", weight: 1 },
      ],
    },
    warnings
  );

  assert.deepEqual(targets, [
    { provider: "cc", model: "claude-opus-5", weight: 1 },
    { provider: "anthropic", model: "claude-opus-5", weight: 2 },
    { provider: "openai", model: "gpt-5", weight: 1 },
  ]);
  assert.deepEqual(warnings, []);
});

test("#11822 — providerId wins over the model prefix when both are present", () => {
  const targets = comboStepsToTargets(
    { models: [{ kind: "model", model: "anthropic/claude-opus-5", providerId: "cc", weight: 1 }] },
    []
  );
  assert.equal(targets[0].provider, "cc");
  assert.equal(targets[0].model, "claude-opus-5");
});

test("#11822 — combo-ref steps are surfaced as a warning, not silently dropped", () => {
  const warnings: string[] = [];
  const targets = comboStepsToTargets(
    { models: [{ kind: "combo-ref", comboName: "backup-route", weight: 1 }] },
    warnings
  );
  assert.deepEqual(targets, []);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /backup-route/);
});

test("#11822 — provider-wildcard steps are shown unresolved, with a warning", () => {
  const warnings: string[] = [];
  const targets = comboStepsToTargets(
    {
      models: [
        { kind: "provider-wildcard", providerId: "groq", modelPattern: "llama-*", weight: 1 },
      ],
    },
    warnings
  );
  assert.deepEqual(targets, [{ provider: "groq", model: "llama-*", weight: 1 }]);
  assert.equal(warnings.length, 1);
});

test("#11822 — malformed or absent step lists degrade to an empty target list", () => {
  assert.deepEqual(comboStepsToTargets({ name: "no-models" }, []), []);
  assert.deepEqual(comboStepsToTargets({ models: null }, []), []);
  assert.deepEqual(comboStepsToTargets({ models: "{{{ not json" }, []), []);
  assert.deepEqual(comboStepsToTargets({ models: [null, 42, {}] }, []), []);
});

test("#11822 — a serialized models column is parsed", () => {
  const targets = comboStepsToTargets(
    { models: JSON.stringify([{ kind: "model", model: "openai/gpt-5", weight: 3 }]) },
    []
  );
  assert.deepEqual(targets, [{ provider: "openai", model: "gpt-5", weight: 3 }]);
});
