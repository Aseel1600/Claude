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

test("azure-document-intelligence builds the prebuilt-read:analyze request", () => {
  const t = getOcrTransformation("azure-document-intelligence");
  const { url, init } = t.buildRequest({
    baseUrl: "https://myres.cognitiveservices.azure.com",
    token: "azkey",
    body: { document: { type: "document_url", document_url: "https://x/d.pdf" } },
    modelId: "prebuilt-read",
  });
  assert.equal(
    url,
    "https://myres.cognitiveservices.azure.com/documentintelligence/documentModels/prebuilt-read:analyze?api-version=2024-11-30&outputContentFormat=markdown"
  );
  assert.equal((init.headers as Record<string, string>)["Ocp-Apim-Subscription-Key"], "azkey");
  const sent = JSON.parse(String(init.body));
  assert.equal(sent.urlSource, "https://x/d.pdf");
});

test("azure-document-intelligence extracts poll URL and parses analyzeResult into Mistral shape", () => {
  const t = getOcrTransformation("azure-document-intelligence");
  const res = new Response(null, {
    status: 202,
    headers: { "Operation-Location": "https://poll/op/1" },
  });
  assert.equal(t.pollUrl?.(res), "https://poll/op/1");
  const parsed = t.parseResponse({
    status: "succeeded",
    analyzeResult: { content: "# doc text", pages: [{ pageNumber: 1 }] },
  });
  assert.equal(parsed.pages.length, 1);
  assert.equal(parsed.pages[0].index, 0);
  assert.equal(parsed.pages[0].markdown, "# doc text");
  assert.equal(parsed.model, "prebuilt-read");
});

test("azure DI maps base64/image_url documents to base64Source/urlSource", () => {
  const t = getOcrTransformation("azure-document-intelligence");
  const { init } = t.buildRequest({
    baseUrl: "https://r.example.com",
    token: "k",
    body: { document: { type: "image_url", image_url: "data:image/png;base64,AAAA" } },
    modelId: "prebuilt-read",
  });
  const sent = JSON.parse(String(init.body));
  assert.equal(sent.base64Source, "AAAA");
});
