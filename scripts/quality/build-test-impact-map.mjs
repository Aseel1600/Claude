import fs from "node:fs";
import path from "node:path";
import { globSync } from "tinyglobby";
import {
  ROOT,
  IMPORT_RE,
  EXTS,
  SRC_ROOTS,
  resolveImport,
  sourceDepsOf,
} from "../check/lib/importResolution.mjs";

// Mirror EXACTLY the `npm run test:unit` glob — the curated set of node:test files.
// The TIA step runs the selected subset via `node --test`, so it must NOT include
// vitest files (`.test.tsx`, `open-sse/**/__tests__`, `tests/unit/autoCombo`), nor
// e2e/integration tests, which can't run under node:test (they 99-false-failed before).
// Mirror EXACTLY the package.json `test:unit` / `test:unit:ci` globs (incl. memory,
// usage, combo, dashboard, serial, and *.test.mjs). Drift here → false __RUN_ALL__.
const testFiles = globSync(
  [
    "tests/unit/*.test.ts",
    "tests/unit/{api,auth,authz,build,cli,cli-helper,combo,compression,correctness,cors,db,db-adapters,docs,gamification,guardrails,lib,mcp,memory,runtime,security,services,settings,shared,ui,usage}/**/*.test.ts",
    "tests/unit/**/*.test.mjs",
    "tests/unit/dashboard/**/*.test.ts",
    // Quarentena serial (P0.3): também são node:test — a TIA precisa mapeá-los.
    "tests/unit/serial/**/*.test.ts",
  ],
  { cwd: ROOT, absolute: true }
);
const map = {};
for (const tf of testFiles) {
  const relTest = path.relative(ROOT, tf);
  for (const src of sourceDepsOf(tf)) {
    (map[src] ||= []).push(relTest);
  }
}
for (const k of Object.keys(map)) map[k].sort();
const out = path.join(ROOT, "config/quality/test-impact-map.json");
fs.writeFileSync(
  out,
  JSON.stringify({ generatedFrom: "import-graph", sources: map }, null, 2) + "\n"
);
console.log(
  `test-impact-map: ${Object.keys(map).length} source files mapped from ${testFiles.length} test files`
);
