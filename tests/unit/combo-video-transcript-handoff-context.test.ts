import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("trusted video description fingerprints reach handoffs through direct and nested combos", () => {
  const typesSource = fs.readFileSync("open-sse/services/combo/types.ts", "utf8");
  assert.match(
    typesSource,
    /videoTranscriptDescriptionFingerprints\?: readonly string\[\]/,
    "the combo request contract must carry bounded identities"
  );

  const comboSource = fs.readFileSync("open-sse/services/combo.ts", "utf8");
  for (const callName of ["maybeGenerateHandoff({", "maybeGenerateUniversalHandoff({"]) {
    const callStart = comboSource.indexOf(callName);
    assert.notEqual(callStart, -1, `${callName} must exist`);
    const callSource = comboSource.slice(callStart, callStart + 1_500);
    assert.match(
      callSource,
      /trustedDescriptionFingerprints:\s*videoTranscriptDescriptionFingerprints/,
      `${callName} must receive the trusted identities`
    );
  }

  const preludeSource = fs.readFileSync("open-sse/services/combo/dispatchPrelude.ts", "utf8");
  const baseOptionsStart = preludeSource.indexOf("function buildBaseOptions(");
  assert.notEqual(baseOptionsStart, -1);
  const baseOptionsSource = preludeSource.slice(baseOptionsStart, baseOptionsStart + 2_000);
  assert.match(
    baseOptionsSource,
    /videoTranscriptDescriptionFingerprints:\s*a\.videoTranscriptDescriptionFingerprints/,
    "nested combos must preserve the identities"
  );

  const chatSource = fs.readFileSync("src/sse/handlers/chat.ts", "utf8");
  const comboCallStarts = [
    chatSource.indexOf("const response = await (handleComboChat as any)({"),
    chatSource.indexOf("return handleComboChat({"),
  ];
  for (const callStart of comboCallStarts) {
    assert.notEqual(callStart, -1, "both primary and safety-net combo calls must exist");
    const optionPrefix = chatSource.slice(callStart, callStart + 1_400);
    assert.match(optionPrefix, /\n\s+videoTranscriptDescriptionFingerprints,\s*$/m);
  }
});
