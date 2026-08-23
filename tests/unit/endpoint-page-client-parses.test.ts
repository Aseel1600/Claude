/**
 * endpoint-page-client-parses.test.ts — regression guard: EndpointPageClient.tsx
 * must at least PARSE as TSX.
 *
 * #11228 landed a merge that overwrote the inner `.map()` callback's `return (`
 * (inside `ProviderModelsModal`) with an unrelated block of page-header JSX
 * instead of placing that header on the outer `APIPageClient` component's own
 * return. The two `return (...)` blocks interleaved, breaking JSX parsing for
 * the rest of the file (#11253). check:dashboard-typecheck already catches this,
 * but its baseline only flags *new/regressed* error counts per file — it does
 * not run in the unit suite. This guard makes that class of damage fail in
 * `test:unit` too, close to the source.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const FILE = fileURLToPath(
  new URL("../../src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.tsx", import.meta.url)
);

test("EndpointPageClient.tsx parses without JSX syntax errors", async () => {
  const source = await readFile(FILE, "utf8");
  const { diagnostics } = ts.transpileModule(source, {
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.Preserve,
    },
    fileName: FILE,
  });

  const problems = (diagnostics ?? []).map((diag) => {
    const where =
      diag.file && diag.start !== undefined
        ? diag.file.getLineAndCharacterOfPosition(diag.start)
        : null;
    return `${FILE}${where ? `:${where.line + 1}:${where.character + 1}` : ""} — ${ts.flattenDiagnosticMessageText(diag.messageText, " ")}`;
  });

  assert.deepEqual(
    problems,
    [],
    `syntax errors in EndpointPageClient.tsx:\n${problems.join("\n")}`
  );
});
