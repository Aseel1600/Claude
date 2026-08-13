import { test } from "node:test";
import assert from "node:assert/strict";
import {
  OCR_PROVIDERS,
  getOcrTransformation,
  MISTRAL_PASSTHROUGH,
} from "../../open-sse/config/ocrRegistry.ts";

test("mistral resolves the passthrough transformation by default", () => {
  const t = getOcrTransformation("mistral");
  assert.equal(t, MISTRAL_PASSTHROUGH);
  const { url, init } = t.buildRequest({
    baseUrl: OCR_PROVIDERS.mistral.baseUrl,
    token: "sk-test",
    body: { document: { type: "image_url", image_url: "https://x/y.png" } },
    modelId: "mistral-ocr-latest",
  });
  assert.equal(url, "https://api.mistral.ai/v1/ocr");
  assert.equal(init.method, "POST");
  assert.equal((init.headers as Record<string, string>).Authorization, "Bearer sk-test");
  const sent = JSON.parse(String(init.body));
  assert.equal(sent.model, "mistral-ocr-latest");
});

test("passthrough parseResponse returns the body unchanged (Mistral is the canonical shape)", () => {
  const raw = { pages: [{ index: 0, markdown: "hello" }], model: "mistral-ocr-latest" };
  assert.deepEqual(MISTRAL_PASSTHROUGH.parseResponse(raw), raw);
});
