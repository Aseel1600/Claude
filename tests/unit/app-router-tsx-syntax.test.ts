import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// A botched merge resolution can splice a stray fragment into the middle of a
// component and leave the file syntactically invalid. Until now the only gate
// catching that was `npm run build` inside the Docker publish job — so a broken
// merge landed on main (#11088) and silently blocked every image push for two
// days while the parse error sat in a single .tsx file.
//
// Parsing (no type-checking) the App Router tree costs well under a second and
// moves that feedback into the unit suite, where it lands on the PR instead of
// on the release pipeline.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const APP_DIR = path.join(REPO_ROOT, "src/app");

function collectTsxFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectTsxFiles(full, found);
    } else if (entry.name.endsWith(".tsx")) {
      found.push(full);
    }
  }
  return found;
}

test("every App Router .tsx file parses without syntax errors", () => {
  const files = collectTsxFiles(APP_DIR);
  assert.ok(files.length > 0, "expected to find .tsx files under src/app");

  const broken: string[] = [];
  for (const file of files) {
    const source = ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.ES2022,
      /* setParentNodes */ false,
      ts.ScriptKind.TSX
    );

    // parseDiagnostics is internal but stable, and it is the only way to read
    // syntax errors without standing up a full Program (which would pull in
    // type-checking and turn a sub-second parse into a multi-minute run).
    const diagnostics = (source as unknown as { parseDiagnostics?: ts.Diagnostic[] })
      .parseDiagnostics;

    for (const diagnostic of diagnostics ?? []) {
      const { line } = source.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
      const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, " ");
      broken.push(`${path.relative(REPO_ROOT, file)}:${line + 1} — ${message}`);
    }
  }

  assert.deepEqual(broken, [], `Syntax errors in App Router files:\n${broken.join("\n")}`);
});
