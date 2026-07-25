// Pure unit test for batch Select all / Unselect all handlers used by
// ComboFormModal in src/app/(dashboard)/dashboard/combos/page.tsx.
//
// Single-click add MUST accumulate against a growing list in one pass —
// N× handleAddModel would each close over the same stale `models` snapshot.
import { describe, expect, it } from "vitest";

type Step = { model: string; providerId?: string; weight?: number };

function hasExactModelStepDuplicate(models: Step[], nextEntry: Step): boolean {
  return models.some(
    (m) =>
      m.model === nextEntry.model &&
      (m.providerId || null) === (nextEntry.providerId || null) &&
      (m.weight ?? 0) === (nextEntry.weight ?? 0)
  );
}

// Mirror of page.tsx::handleAddModels (provider resolution simplified — tests
// focus on batch accumulation + duplicate skipping).
function addModels(
  models: Step[],
  selected: Array<{ value?: string; providerId?: string }>
): Step[] {
  if (!Array.isArray(selected) || selected.length === 0) return models;
  const next = [...models];
  for (const model of selected) {
    const qualifiedModel = typeof model?.value === "string" ? model.value : "";
    if (!qualifiedModel) continue;
    const nextEntry: Step = {
      model: qualifiedModel,
      ...(typeof model?.providerId === "string" && model.providerId.trim()
        ? { providerId: model.providerId }
        : {}),
      weight: 0,
    };
    if (hasExactModelStepDuplicate(next, nextEntry)) continue;
    next.push(nextEntry);
  }
  return next;
}

function deselectModels(models: Step[], toRemove: Array<{ value?: string } | string>): Step[] {
  if (!Array.isArray(toRemove) || toRemove.length === 0) return models;
  const values = new Set(
    toRemove
      .map((model) =>
        typeof (model as { value?: string })?.value === "string"
          ? (model as { value: string }).value
          : typeof model === "string"
            ? model
            : ""
      )
      .filter(Boolean)
  );
  if (values.size === 0) return models;
  return models.filter((m) => !values.has(m.model));
}

describe("ComboFormModal Select all / Unselect all handlers", () => {
  it("adds every candidate in one pass (no stale single-add overwrite)", () => {
    const next = addModels(
      [],
      [
        { value: "openai/gpt-4o" },
        { value: "openai/gpt-4o-mini" },
        { value: "anthropic/claude-3-5-sonnet" },
      ]
    );
    expect(next.map((m) => m.model)).toEqual([
      "openai/gpt-4o",
      "openai/gpt-4o-mini",
      "anthropic/claude-3-5-sonnet",
    ]);
  });

  it("skips models already present (exact duplicate)", () => {
    const existing: Step[] = [{ model: "openai/gpt-4o", weight: 0 }];
    const next = addModels(existing, [{ value: "openai/gpt-4o" }, { value: "openai/gpt-4o-mini" }]);
    expect(next.map((m) => m.model)).toEqual(["openai/gpt-4o", "openai/gpt-4o-mini"]);
  });

  it("ignores empty / missing values", () => {
    const next = addModels([], [{ value: "" }, {}, { value: "openai/gpt-4o" }]);
    expect(next).toEqual([{ model: "openai/gpt-4o", weight: 0 }]);
  });

  it("removes every matching qualified model in one pass", () => {
    const models: Step[] = [
      { model: "openai/gpt-4o", weight: 0 },
      { model: "openai/gpt-4o-mini", weight: 0 },
      { model: "anthropic/claude-3-5-sonnet", weight: 0 },
    ];
    const next = deselectModels(models, [
      { value: "openai/gpt-4o" },
      { value: "openai/gpt-4o-mini" },
    ]);
    expect(next).toEqual([{ model: "anthropic/claude-3-5-sonnet", weight: 0 }]);
  });

  it("accepts raw string identifiers in the deselect batch", () => {
    const models: Step[] = [
      { model: "openai/gpt-4o", weight: 0 },
      { model: "openai/gpt-4o-mini", weight: 0 },
    ];
    const next = deselectModels(models, ["openai/gpt-4o"]);
    expect(next).toEqual([{ model: "openai/gpt-4o-mini", weight: 0 }]);
  });
});
