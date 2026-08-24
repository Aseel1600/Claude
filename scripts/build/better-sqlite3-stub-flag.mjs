/**
 * Decide whether the Turbopack/Next.js bundler should alias better-sqlite3 to
 * the no-op build stub (src/lib/db/better-sqlite3.stub.js).
 *
 * History (#11343): the alias used to be UNCONDITIONAL in next.config.mjs,
 * which made the bundler resolve every `require("better-sqlite3")` to the
 * stub AHEAD of serverExternalPackages — the stub was then bundled into the
 * standalone server and the real native addon never loaded at runtime, so
 * every DB operation threw a 500 (`r(...) is not a constructor`) in the
 * v3.8.50 release artifact.
 *
 * The stub exists ONLY to keep the native addon out of build workers during
 * the production build (its Statement destructor SIGABRTs at worker teardown —
 * #10060). At runtime the real package must win via serverExternalPackages,
 * so the alias is gated on the same explicit build signals the in-process
 * stub gate uses (src/lib/buildPhase.ts::isNextBuildPhase):
 *   - OMNIROUTE_BUILDING === "1": set by scripts/build/build-next-isolated.mjs
 *     and inherited by every spawned build worker; the reliable signal
 *     because Next.js workers sometimes drop NEXT_PHASE (#10060).
 *   - NEXT_PHASE === "phase-production-build": set by Next.js on the main
 *     build process when `next build` runs directly.
 *   - npm_lifecycle_event === "build": backstop for invocations launched via
 *     `npm run build`.
 */
export function shouldStubBetterSqlite3(env = process.env) {
  return (
    env.OMNIROUTE_BUILDING === "1" ||
    env.NEXT_PHASE === "phase-production-build" ||
    env.npm_lifecycle_event === "build"
  );
}

/** Turbopack resolveAlias fragment for better-sqlite3, derived from the env. */
export function betterSqlite3AliasFor(env = process.env) {
  return shouldStubBetterSqlite3(env)
    ? { "better-sqlite3": "./src/lib/db/better-sqlite3.stub.js" }
    : {};
}