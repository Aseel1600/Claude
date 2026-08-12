import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { resolveResponsesApiModel } from "../../src/app/api/internal/codex-responses-ws/modelResolution.ts";

const resolver = async (modelStr: string) => {
  if (modelStr.startsWith("codex/")) {
    return { provider: "codex", model: modelStr.slice("codex/".length) };
  }
  return { provider: "openrouter", model: modelStr };
};

test("case-insensitive combo match prevents Codex rewrite on /v1/responses", async () => {
  const storedComboName = "GPT-5.6-SOL";
  const isCombo = async (name: string) => name.toLowerCase() === storedComboName.toLowerCase();

  const result = await resolveResponsesApiModel("gpt-5.6-sol", resolver, isCombo);

  assert.equal(result.changed, false);
  assert.equal(result.model, "gpt-5.6-sol");
});

test("Responses route uses the downstream combo resolver for the Codex rewrite guard", () => {
  const source = readFileSync(
    new URL("../../src/app/api/v1/responses/route.ts", import.meta.url),
    "utf8"
  );

  assert.match(source, /import \{ getModelInfo, getComboForModel \} from "@\/sse\/services\/model"/);
  assert.match(source, /async \(name\) => !!\(await getComboForModel\(name\)\)/);
  assert.doesNotMatch(source, /getComboByName\(name\)/);
});
