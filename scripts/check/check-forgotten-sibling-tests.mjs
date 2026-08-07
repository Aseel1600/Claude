#!/usr/bin/env node
// scripts/check/check-forgotten-sibling-tests.mjs
// Gate: when a PR changes source file Y, detects if any production consumer Z of Y
// has a test sibling (Z.test.ts or Z/index.ts → Z/test.ts) that is NOT included in
// the same PR diff. Prevents the "forgotten sibling test" pattern (7 occurrences
// fixed in PR #9529).
//
// Usage:
//   node scripts/check/check-forgotten-sibling-tests.mjs
//
// Environment (PR context):
//   GITHUB_BASE_SHA or GITHUB_BASE_REF  — base of the PR diff
//   FORGOTTEN_SIBLING_MAX_CHANGED        — threshold for release-PR skip (default 300)
//
// No PR context → no-ops (exit 0, no output).

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { globSync } from "tinyglobby";
import { ROOT, IMPORT_RE, EXTS, SRC_ROOTS, resolveImport } from "./lib/importResolution.mjs";

// ─── Constants ────────────────────────────────────────────────────────────────

const SOURCE_ROOTS = ["src/", "open-sse/", "bin/"];
const EXCLUDED_PATTERNS = [
  /\/tests\//,
  /\/migrations\//,
  /\/__tests__\//,
  /\.test\./,
  /\.spec\./,
  /\/node_modules\//,
  /\/config\/(?:quality|eslint|tsconfig)/,
];
const DEFAULT_MAX_CHANGED = 300;

// ─── Helpers (exported for testing) ───────────────────────────────────────────

export function runGit(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

export function isSourceFile(filePath) {
  if (EXCLUDED_PATTERNS.some((p) => p.test(filePath))) return false;
  return (
    SOURCE_ROOTS.some((root) => filePath.startsWith(root)) && EXTS.some((e) => filePath.endsWith(e))
  );
}

export function resolveBase() {
  if (process.env.GITHUB_BASE_SHA) return process.env.GITHUB_BASE_SHA;
  if (process.env.GITHUB_BASE_REF) return `origin/${process.env.GITHUB_BASE_REF}`;
  return null;
}

/**
 * Test sibling of a production file Z.
 * Convention: Z.ts → Z.test.ts, or Z/index.ts → Z/test.ts.
 * Returns the repo-relative path of the test sibling, or null if none.
 */
export function testSiblingOf(relPath) {
  const abs = path.join(ROOT, relPath);
  const dir = path.dirname(abs);
  const base = path.basename(abs).replace(/\.(ts|tsx|mts|js|mjs)$/, "");
  const candidates = [
    path.join(dir, `${base}.test.ts`),
    path.join(dir, `${base}.test.tsx`),
    path.join(dir, `${base}.test.mjs`),
  ];
  // Also try Z/test/ subdirectory
  const testDir = path.join(dir.replace(/\/?$/, ""), "test");
  candidates.push(
    path.join(testDir, `${base}.test.ts`),
    path.join(testDir, `${base}.test.tsx`),
    path.join(testDir, `${base}.test.mjs`)
  );
  // For Z/index.ts or Z/route.ts, also try Z/test.ts
  if (base === "index" || base === "route") {
    candidates.push(
      path.join(dir, `${base}.test.ts`),
      path.join(dir, `${base}.test.tsx`),
      path.join(dir, `${base}.test.mjs`),
      path.join(dir, "test.ts"),
      path.join(dir, "test.tsx"),
      path.join(dir, "test.mjs")
    );
  }
  for (const c of candidates) {
    if (fs.existsSync(c)) return path.relative(ROOT, c);
  }
  return null;
}

/**
 * For a given changed source file (repo-relative path), find all production
 * files under SOURCE_ROOTS that directly import from it. Uses the pre-built
 * reverse dependency map.
 */
export function findConsumers(changedRelPath, prodFileMap) {
  const abs = path.join(ROOT, changedRelPath);
  const consumers = [];
  for (const [consumerRel, deps] of Object.entries(prodFileMap)) {
    if (deps.has(abs)) consumers.push(consumerRel);
  }
  return consumers.sort();
}

/**
 * Build a map of all production files → their resolved direct import deps (Set of absolute paths).
 */
export function buildProdFileMap() {
  const map = {};
  const prodFiles = globSync(
    SRC_ROOTS.map((r) => `${r}/**/*.{ts,tsx,mts,js,mjs}`),
    { cwd: ROOT, ignore: ["**/node_modules/**", "**/tests/**", "**/__tests__/**"] }
  );
  for (const f of prodFiles) {
    if (!isSourceFile(f)) continue;
    const fullPath = path.join(ROOT, f);
    let code;
    try {
      code = fs.readFileSync(fullPath, "utf8");
    } catch {
      continue;
    }
    const deps = new Set();
    for (const m of code.matchAll(IMPORT_RE)) {
      const spec = m[1] || m[2] || m[3];
      if (!spec) continue;
      const r = resolveImport(spec, fullPath);
      if (!r) continue;
      deps.add(r);
    }
    map[f] = deps;
  }
  return map;
}

/**
 * Check if an allowlist entry exempts a (changedFile, consumerWithMissingTest) pair.
 */
export function isAllowlisted(changedFile, missingTest, allowlist) {
  for (const entry of allowlist) {
    if (entry.sourcePath === changedFile && entry.forgottenSibling === missingTest) return true;
    if (entry.sourcePath === "*" && entry.forgottenSibling === missingTest) return true;
  }
  return false;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main() {
  const base = resolveBase();
  if (!base) {
    console.log("[forgotten-sibling] no base ref (not a PR context) — skipping check.");
    return;
  }

  // Read allowlist
  let allowlist = [];
  try {
    const raw = JSON.parse(
      fs.readFileSync(path.join(ROOT, "config/quality/forgotten-sibling-allowlist.json"), "utf8")
    );
    allowlist = Array.isArray(raw) ? raw : [];
  } catch {
    // No allowlist file or parse error — treat as empty
  }

  // Get changed files
  const changedFiles = runGit(["diff", "--name-only", "--diff-filter=ACM", `${base}...HEAD`])
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);

  const changedSources = changedFiles.filter(isSourceFile);
  const changedTestFiles = new Set(
    changedFiles.filter((f) => /\.(?:test|spec)\.(?:ts|tsx|mjs)$/.test(f))
  );

  // Release PR skip: if too many changed files, skip the detailed consumer walk.
  const maxChanged = Number(process.env.FORGOTTEN_SIBLING_MAX_CHANGED) || DEFAULT_MAX_CHANGED;
  if (maxChanged > 0 && changedSources.length > maxChanged) {
    console.log(
      `[forgotten-sibling] ${changedSources.length} source file(s) changed exceeds ` +
        `threshold (${maxChanged}) — skipping consumer scan (release PR).\n` +
        `  A diff this large is a release PR or mass refactor; each file already ` +
        `passed this gate on its own PR during the cycle.`
    );
    return;
  }

  if (changedSources.length === 0) {
    console.log("[forgotten-sibling] no changed source files — OK.");
    return;
  }

  // Build the production dependency map (source → consumers)
  const prodFileMap = buildProdFileMap();

  const flags = [];

  for (const changedSource of changedSources) {
    const consumers = findConsumers(changedSource, prodFileMap);
    if (consumers.length === 0) continue;

    for (const consumer of consumers) {
      const testSibling = testSiblingOf(consumer);
      if (!testSibling) continue;

      if (changedTestFiles.has(testSibling)) continue;

      if (isAllowlisted(changedSource, testSibling, allowlist)) continue;

      flags.push(
        `${changedSource}: \`${consumer}\` imports this file and has a test sibling ` +
          `(\`${testSibling}\`) that is NOT in the current diff. ` +
          "When the public API of the changed source changes, consumer tests " +
          "may need updating too."
      );
    }
  }

  if (flags.length) {
    console.error(
      `[forgotten-sibling] ${flags.length} forgotten sibling test(s) detected:\n` +
        flags.map((f) => `  ✗ ${f}`).join("\n") +
        `\n  → Add the missing test files to this PR or add an allowlist entry ` +
        `(config/quality/forgotten-sibling-allowlist.json) with a justification.`
    );
    process.exit(1);
  }

  console.log(
    `[forgotten-sibling] OK — ${changedSources.length} source file(s) changed, ` +
      `no forgotten sibling tests.`
  );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
