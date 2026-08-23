import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

type SuppressionBaseline = Record<string, Record<string, { count: number }>>;

const REACT_COMPILER_BASELINE = {
  "react-hooks/immutability": 36,
  "react-hooks/preserve-manual-memoization": 4,
  "react-hooks/purity": 5,
  "react-hooks/refs": 7,
  "react-hooks/set-state-in-effect": 162,
  "react-hooks/static-components": 7,
} as const;

test("ESLint baseline preserves the adopted React Compiler debt", () => {
  const baselineUrl = new URL("../../config/quality/eslint-suppressions.json", import.meta.url);
  const baseline = JSON.parse(readFileSync(baselineUrl, "utf8")) as SuppressionBaseline;
  const actual = Object.fromEntries(
    Object.keys(REACT_COMPILER_BASELINE).map((rule) => [
      rule,
      Object.values(baseline).reduce(
        (total, fileSuppressions) => total + (fileSuppressions[rule]?.count ?? 0),
        0
      ),
    ])
  );

  assert.deepEqual(actual, REACT_COMPILER_BASELINE);
});
