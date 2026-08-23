import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-designer-removal-"));
process.env.DATA_DIR = TEST_DATA_DIR;

const { getAllImageModels, getImageProvider, parseImageModel } =
  await import("../../open-sse/config/imageRegistry.ts");
const { hasSpecializedExecutor } = await import("../../open-sse/executors/index.ts");
const { WEB_COOKIE_PROVIDERS } = await import("../../src/shared/constants/providers/web-cookie.ts");
const { getWebSessionCredentialRequirement } =
  await import("../../src/shared/providers/webSessionCredentials.ts");

test.after(() => {
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

test("gpt4free-derived Microsoft Designer Web is absent from every runtime registry", () => {
  assert.equal(getImageProvider("microsoft-designer-web"), null);
  assert.equal(getImageProvider("msdesigner"), null);
  assert.deepEqual(parseImageModel("microsoft-designer-web/dall-e-3"), {
    provider: null,
    model: "microsoft-designer-web/dall-e-3",
  });
  assert.deepEqual(parseImageModel("msdesigner/dall-e-3"), {
    provider: null,
    model: "msdesigner/dall-e-3",
  });
  assert.equal(
    getAllImageModels().some(({ provider }) => provider === "microsoft-designer-web"),
    false
  );
  assert.equal(
    (WEB_COOKIE_PROVIDERS as Record<string, unknown>)["microsoft-designer-web"],
    undefined
  );
  assert.equal(getWebSessionCredentialRequirement("microsoft-designer-web"), null);
  assert.equal(hasSpecializedExecutor("microsoft-designer-web"), false);
  assert.equal(hasSpecializedExecutor("msdesigner"), false);
});

test("removing Designer preserves independent OpenAI and ChatGPT Web image paths", () => {
  assert.ok(getImageProvider("openai"), "the official OpenAI image provider must remain");
  assert.deepEqual(parseImageModel("dall-e-3"), {
    provider: "openai",
    model: "dall-e-3",
  });
  assert.ok(getImageProvider("chatgpt-web"), "the independently verified ChatGPT Web path remains");
  assert.equal(hasSpecializedExecutor("chatgpt-web"), true);
});

test("Designer implementation and gpt4free provenance literals are absent from production", () => {
  const repoRoot = process.cwd();
  const deletedFiles = [
    "open-sse/executors/microsoft-designer-web.ts",
    "open-sse/handlers/imageGeneration/providers/designerWeb.ts",
  ];
  for (const relativePath of deletedFiles) {
    assert.equal(
      fs.existsSync(path.join(repoRoot, relativePath)),
      false,
      `${relativePath} must be deleted`
    );
  }

  const closureFiles = [
    "open-sse/config/imageRegistry.ts",
    "open-sse/executors/index.ts",
    "open-sse/handlers/imageGeneration.ts",
    "open-sse/utils/publicCreds.ts",
    "src/shared/constants/providers/web-cookie.ts",
    "src/shared/providers/webSessionCredentials.ts",
  ];
  const productionClosure = closureFiles
    .map((relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), "utf8"))
    .join("\n");

  assert.doesNotMatch(
    productionClosure,
    /microsoft-designer-web|msdesigner|microsoft_designer_client_id|MicrosoftDesigner\.py/
  );
  assert.doesNotMatch(productionClosure, /providerConfig\.format === ["']designer-web["']/);
});
