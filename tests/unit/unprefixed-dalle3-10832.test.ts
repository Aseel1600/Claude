import test from "node:test";
import assert from "node:assert/strict";
import {
  IMAGE_PROVIDERS,
  parseImageModel,
  getAllImageModels,
  isRegisteredImageModel,
} from "../../open-sse/config/imageRegistry.ts";

test("#10832 unprefixed dall-e-3 remains routed to OpenAI after Designer removal", () => {
  assert.deepEqual(parseImageModel("dall-e-3"), {
    provider: "openai",
    model: "dall-e-3",
  });
  assert.deepEqual(parseImageModel("openai/dall-e-3"), {
    provider: "openai",
    model: "dall-e-3",
  });
  assert.deepEqual(parseImageModel("microsoft-designer-web/dall-e-3"), {
    provider: null,
    model: "microsoft-designer-web/dall-e-3",
  });
  assert.deepEqual(parseImageModel("msdesigner/dall-e-3"), {
    provider: null,
    model: "msdesigner/dall-e-3",
  });

  assert.equal(isRegisteredImageModel("openai", "dall-e-3"), true);
  assert.equal(isRegisteredImageModel("microsoft-designer-web", "dall-e-3"), false);

  const openai = IMAGE_PROVIDERS.openai;
  assert.ok(openai.models.some((model) => model.id === "dall-e-3"));

  const catalog = getAllImageModels();
  assert.ok(catalog.some((model) => model.id === "openai/dall-e-3" && model.provider === "openai"));
  assert.equal(
    catalog.some((model) => model.provider === "microsoft-designer-web"),
    false
  );
});
