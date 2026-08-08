import test from "node:test";
import assert from "node:assert/strict";
import {
  isComboCatalogModel,
  isUsableChatModel,
  isUsableVscodeCatalogModel,
} from "../../src/app/api/v1/vscode/[token]/usableChatModel.ts";

/**
 * Combos are chat targets, and the VS Code catalog now lists them.
 *
 * They were rejected outright, which made every combo the operator had
 * configured invisible to the VS Code extension — the extension syncs
 * `/api/v1/vscode/{token}/models` and nothing else, so a routing strategy that
 * existed in the dashboard could never be selected in the editor.
 *
 * The Ollama-compatible listings keep rejecting them on purpose: `api/show`
 * resolves a model name, and a combo has no single model behind it.
 */

const combo = {
  id: "meu-combo",
  owned_by: "combo",
  parent: null,
};

test("a combo entry is recognised as a combo", () => {
  assert.equal(isComboCatalogModel(combo), true);
  assert.equal(isComboCatalogModel({ owned_by: "COMBO" }), true, "case must not matter");
  assert.equal(isComboCatalogModel({ owned_by: " combo " }), true, "padding must not matter");
});

test("a provider model is not mistaken for a combo", () => {
  assert.equal(isComboCatalogModel({ owned_by: "openai" }), false);
  assert.equal(isComboCatalogModel({}), false);
  assert.equal(isComboCatalogModel({ owned_by: "combo-provider" }), false);
});

test("the VS Code catalog lists a combo", () => {
  assert.equal(isUsableVscodeCatalogModel(combo), true);
});

test("the Ollama-compatible listings keep hiding combos", () => {
  // api/tags and api/show answer model-name lookups; a combo resolves to no
  // single model, so it stays out of that surface on purpose.
  assert.equal(isUsableChatModel(combo), false);
});

test("a combo carrying catalog metadata is still listed", () => {
  // Combos inherit context/modalities from their resolved targets.
  assert.equal(
    isUsableVscodeCatalogModel({
      ...combo,
      api_format: "chat-completions",
      supported_endpoints: ["chat"],
      output_modalities: ["text"],
    }),
    true
  );
});

test("combo listing does not bypass the capability checks", () => {
  // An image-only combo has no business in a chat catalog: being a combo is
  // not a free pass, it just stopped being an automatic rejection.
  assert.equal(
    isUsableVscodeCatalogModel({ ...combo, output_modalities: ["image"] }),
    false,
    "a combo that cannot emit text must stay out"
  );
  assert.equal(
    isUsableVscodeCatalogModel({ ...combo, supported_endpoints: ["embeddings"] }),
    false,
    "a combo that serves neither chat nor responses must stay out"
  );
});

test("the two predicates agree on everything that is not a combo", () => {
  const cases = [
    { owned_by: "openai", api_format: "chat-completions" },
    { owned_by: "openai", api_format: "responses" },
    { owned_by: "openai", api_format: "embeddings" },
    { owned_by: "openai", parent: "gpt-5.6" },
    { owned_by: "openai", type: "image" },
    { owned_by: "anthropic", output_modalities: ["image"] },
  ];
  for (const model of cases) {
    assert.equal(
      isUsableVscodeCatalogModel(model),
      isUsableChatModel(model),
      `divergence on ${JSON.stringify(model)} — combos are the only difference`
    );
  }
});

test("provider models keep their existing behaviour", () => {
  assert.equal(isUsableChatModel({ owned_by: "openai", api_format: "chat-completions" }), true);
  assert.equal(isUsableChatModel({ owned_by: "openai", api_format: "responses" }), true);
  assert.equal(isUsableChatModel({ owned_by: "openai", api_format: "embeddings" }), false);
  assert.equal(isUsableChatModel({ owned_by: "openai", parent: "gpt-5.6" }), false);
  assert.equal(isUsableChatModel({ owned_by: "openai", type: "image" }), false);
});
