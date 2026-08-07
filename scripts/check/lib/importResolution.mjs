#!/usr/bin/env node
// scripts/check/lib/importResolution.mjs
// Shared import resolution logic extracted from build-test-impact-map.mjs.
// Provides resolveImport(), sourceDepsOf(), IMPORT_RE, EXTS, SRC_ROOTS, ROOT.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const SRC_ROOTS = ["src", "open-sse"];
export const IMPORT_RE =
  /(?:import|export)[^'"]*from\s*['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)|import\(\s*['"]([^'"]+)['"]\s*\)/g;
export const EXTS = [".ts", ".tsx", ".mts", ".js", ".mjs"];

/**
 * Resolve an import specifier to an absolute file path.
 * Handles `@/` aliases, `@omniroute/open-sse` aliases, and relative paths.
 * Returns null for external/npm imports or unresolvable specs.
 */
export function resolveImport(spec, fromFile) {
  let base;
  if (spec.startsWith("@/")) base = path.join(ROOT, "src", spec.slice(2));
  else if (spec.startsWith("@omniroute/open-sse"))
    base = path.join(ROOT, "open-sse", spec.replace(/^@omniroute\/open-sse\/?/, ""));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(fromFile), spec);
  else return null;
  for (const e of EXTS) {
    if (fs.existsSync(base + e)) return base + e;
  }
  for (const e of EXTS) {
    const idx = path.join(base, "index" + e);
    if (fs.existsSync(idx)) return idx;
  }
  return fs.existsSync(base) && fs.statSync(base).isFile() ? base : null;
}

/**
 * Walk the transitive import graph of a file and return all source-relative
 * paths it depends on (files under src/ or open-sse/).
 */
export function sourceDepsOf(entry) {
  const seen = new Set();
  const stack = [entry];
  const sources = new Set();
  while (stack.length) {
    const f = stack.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    let code;
    try {
      code = fs.readFileSync(f, "utf8");
    } catch {
      continue;
    }
    for (const m of code.matchAll(IMPORT_RE)) {
      const spec = m[1] || m[2] || m[3];
      if (!spec) continue;
      const r = resolveImport(spec, f);
      if (!r) continue;
      const rel = path.relative(ROOT, r);
      if (SRC_ROOTS.some((s) => rel.startsWith(s + path.sep))) sources.add(rel);
      stack.push(r);
    }
  }
  return sources;
}
