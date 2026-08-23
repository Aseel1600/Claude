import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import ts from "typescript";

const filePath = new URL(
  "../../../src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.tsx",
  import.meta.url
);
const source = readFileSync(filePath, "utf8");

test("#11228 endpoint dashboard parses and renders the guided header in the page shell", () => {
  const { diagnostics } = ts.transpileModule(source, {
    fileName: filePath.pathname,
    reportDiagnostics: true,
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  });
  const syntaxErrors = (diagnostics ?? []).map((diagnostic) =>
    ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")
  );
  assert.deepEqual(
    syntaxErrors,
    [],
    `EndpointPageClient syntax errors:\n${syntaxErrors.join("\n")}`
  );

  const modalStart = source.indexOf("function ProviderModelsModal(");
  assert.notEqual(modalStart, -1, "ProviderModelsModal boundary not found");

  const pageShell = source.slice(0, modalStart);
  const guidedHeader = pageShell.indexOf('{t("subtitle")}');
  const tabs = pageShell.indexOf("<SegmentedControl", guidedHeader);
  assert.ok(guidedHeader > 0, "guided endpoint subtitle must be rendered by APIPageClient");
  assert.ok(tabs > guidedHeader, "guided header must lead the advanced-protocol tabs");
  assert.match(pageShell, /\{displayApiUrl\}/);
  assert.match(pageShell, /<Link\s+href="\/dashboard\/playground"/);
  assert.match(pageShell, /\{t\("testEndpoint"\)\}/);
  assert.match(pageShell, /\{t\("advancedProtocols"\)\}/);

  const modalSource = source.slice(modalStart);
  assert.doesNotMatch(
    modalSource,
    /t\("endpoint\.(title|subtitle|testEndpoint|advancedProtocols)"\)/
  );
  assert.doesNotMatch(modalSource, /useDisplayBaseUrl\(\)/);
});
