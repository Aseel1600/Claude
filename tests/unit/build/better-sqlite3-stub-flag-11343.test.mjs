// Regression test for #11343 — the better-sqlite3 alias in next.config.mjs was
// UNCONDITIONAL: the bundler resolved every `require("better-sqlite3")` to the
// no-op build stub ahead of serverExternalPackages, so the stub was bundled
// into the standalone server and the real native addon never loaded at
// runtime — every DB operation then threw a 500 (`r(...) is not a
// constructor`). The alias must be gated on the same explicit build signals the
// in-process stub gate uses (src/lib/buildPhase.ts); a default production
// build / runtime must bundle the REAL package via serverExternalPackages.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { shouldStubBetterSqlite3, betterSqlite3AliasFor } = await import(
  "../../../scripts/build/better-sqlite3-stub-flag.mjs"
);

const STUB_ALIAS = { "better-sqlite3": "./src/lib/db/better-sqlite3.stub.js" };

describe("better-sqlite3 build-stub alias (#11343)", () => {
  it("default env does NOT stub better-sqlite3 (npm/Electron/VPS runtime gets the real addon)", () => {
    assert.equal(shouldStubBetterSqlite3({}), false);
    assert.deepEqual(betterSqlite3AliasFor({}), {});
  });

  it("OMNIROUTE_BUILDING=1 stubs (isolated build script signal, inherited by build workers)", () => {
    assert.equal(shouldStubBetterSqlite3({ OMNIROUTE_BUILDING: "1" }), true);
    assert.deepEqual(betterSqlite3AliasFor({ OMNIROUTE_BUILDING: "1" }), STUB_ALIAS);
  });

  it("NEXT_PHASE=phase-production-build stubs (direct `next build` signal)", () => {
    assert.equal(shouldStubBetterSqlite3({ NEXT_PHASE: "phase-production-build" }), true);
    assert.deepEqual(
      betterSqlite3AliasFor({ NEXT_PHASE: "phase-production-build" }),
      STUB_ALIAS
    );
  });

  it("npm_lifecycle_event=build backstop stubs (parity with src/lib/buildPhase.ts)", () => {
    assert.equal(shouldStubBetterSqlite3({ npm_lifecycle_event: "build" }), true);
    assert.deepEqual(
      betterSqlite3AliasFor({ npm_lifecycle_event: "build" }),
      STUB_ALIAS
    );
  });

  it("explicit OMNIROUTE_BUILDING=0 does NOT stub (off wins over the backstop)", () => {
    assert.equal(shouldStubBetterSqlite3({ OMNIROUTE_BUILDING: "0" }), false);
    assert.deepEqual(betterSqlite3AliasFor({ OMNIROUTE_BUILDING: "0" }), {});
  });

  it("NEXT_PHASE=phase-production-start does NOT stub (runtime phase)", () => {
    assert.equal(shouldStubBetterSqlite3({ NEXT_PHASE: "phase-production-start" }), false);
    assert.deepEqual(betterSqlite3AliasFor({ NEXT_PHASE: "phase-production-start" }), {});
  });

  it("stub wins when both build and non-build signals are mixed", () => {
    assert.equal(
      shouldStubBetterSqlite3({
        OMNIROUTE_BUILDING: "1",
        NEXT_PHASE: "phase-production-start",
      }),
      true
    );
  });

  it("next.config.mjs derives the turbopack alias from the flag (no unconditional stub)", () => {
    const config = readFileSync(new URL("../../../next.config.mjs", import.meta.url), "utf8");
    assert.match(
      config,
      /betterSqlite3AliasFor/,
      "next.config.mjs must use betterSqlite3AliasFor()"
    );
    assert.doesNotMatch(
      config,
      /^\s*"better-sqlite3":\s*"\.\/src\/lib\/db\/better-sqlite3\.stub\.js",?\s*$/m,
      "next.config.mjs must not hardcode the better-sqlite3 stub alias"
    );
  });

  it("serverExternalPackages keeps better-sqlite3 external for the runtime (real addon)", () => {
    const config = readFileSync(new URL("../../../next.config.mjs", import.meta.url), "utf8");
    assert.match(
      config,
      /serverExternalPackages:\s*\[[\s\S]*"better-sqlite3"/,
      "better-sqlite3 must stay in serverExternalPackages so runtime uses the real addon"
    );
  });
});