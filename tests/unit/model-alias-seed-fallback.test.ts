import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveModelAlias } from "../../src/lib/modelAliasResolver";

test("resolveModelAlias: falls back to DEFAULT_MODEL_ALIAS_SEED for unmapped models", async () => {
  const opus = await resolveModelAlias("claude-opus-4-6-thinking");
  assert.equal(opus, "agy/claude-opus-4-6-thinking");

  const flash = await resolveModelAlias("gemini-3.6-flash-low");
  assert.equal(flash, "agy/gemini-3.6-flash-low");

  const unknown = await resolveModelAlias("unknown-custom-model-999");
  assert.equal(unknown, "unknown-custom-model-999");
});
