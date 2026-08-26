import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("package.json prepare script (#11571)", () => {
  const pkg = JSON.parse(
    readFileSync(join(import.meta.dirname, "../../package.json"), "utf8")
  );

  it("has a prepare script that guards against missing husky", () => {
    const prepare = pkg.scripts?.prepare;
    assert.ok(prepare, "prepare script must exist");
    assert.ok(
      prepare.includes("require.resolve") || prepare.includes("existsSync"),
      "prepare must check if husky is available before running it"
    );
  });

  it("does not hard-fail when husky is absent", () => {
    const prepare = pkg.scripts?.prepare;
    assert.ok(
      !prepare.match(/^\s*husky\s*$/),
      "prepare must not be a bare 'husky' call without a guard"
    );
  });

  it("still calls husky when available", () => {
    const prepare = pkg.scripts?.prepare;
    assert.ok(
      prepare.includes("husky"),
      "prepare must still invoke husky when it is installed"
    );
  });
});
