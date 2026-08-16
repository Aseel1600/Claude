import test from "node:test";
import assert from "node:assert/strict";
import { v1EmbeddingsSchema } from "../../src/shared/validation/schemas/apiV1.ts";
import {
  isJinaNativeEmbeddingItem,
  jinaNativeItemToCanonical,
  normalizeJinaNativeEmbeddingInput,
} from "../../src/shared/validation/jinaNativeEmbeddingInput.ts";

const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const DATA_URL = `data:image/png;base64,${PNG_B64}`;

test("detects Jina/Memorix native items and ignores OmniRoute canonical items", () => {
  assert.equal(isJinaNativeEmbeddingItem({ image: DATA_URL }), true);
  assert.equal(isJinaNativeEmbeddingItem({ text: "caption" }), true);
  assert.equal(isJinaNativeEmbeddingItem({ pdf: "data:application/pdf;base64,cA==" }), true);
  assert.equal(
    isJinaNativeEmbeddingItem({
      type: "image",
      source: { type: "base64", data: PNG_B64, media_type: "image/png" },
    }),
    false
  );
  assert.equal(isJinaNativeEmbeddingItem({ image: DATA_URL, text: "nope" }), false);
});

test("translates Jina native image/text/pdf items to canonical source objects", () => {
  assert.deepEqual(jinaNativeItemToCanonical({ text: "caption" }), {
    type: "text",
    text: "caption",
  });
  assert.deepEqual(jinaNativeItemToCanonical({ image: DATA_URL }), {
    type: "image",
    source: { type: "base64", data: PNG_B64, media_type: "image/png" },
  });
  assert.deepEqual(jinaNativeItemToCanonical({ image: "https://example.com/bike.png" }), {
    type: "image",
    source: { type: "url", url: "https://example.com/bike.png" },
  });
  assert.deepEqual(jinaNativeItemToCanonical({ pdf: "data:application/pdf;base64,cA==" }), {
    type: "document",
    source: { type: "base64", data: "cA==", media_type: "application/pdf" },
  });
});

test("v1 embeddings schema accepts Memorix {image: data:url} and mixed text+image", () => {
  const imageOnly = v1EmbeddingsSchema.safeParse({
    model: "jina-ai/jina-embeddings-v5-omni-small",
    input: [{ image: DATA_URL }],
  });
  assert.equal(imageOnly.success, true);
  if (imageOnly.success) {
    assert.deepEqual(imageOnly.data.input, [
      {
        type: "image",
        source: { type: "base64", data: PNG_B64, media_type: "image/png" },
      },
    ]);
  }

  const mixed = v1EmbeddingsSchema.safeParse({
    model: "jina-ai/jina-embeddings-v5-omni-small",
    input: ["a red bicycle", { image: DATA_URL }],
  });
  assert.equal(mixed.success, true);
  if (mixed.success) {
    assert.deepEqual(mixed.data.input, [
      { type: "text", text: "a red bicycle" },
      {
        type: "image",
        source: { type: "base64", data: PNG_B64, media_type: "image/png" },
      },
    ]);
  }
});

test("legacy string/token and OmniRoute {type,source} inputs are unchanged", () => {
  assert.equal(
    v1EmbeddingsSchema.safeParse({
      model: "jina-ai/jina-embeddings-v5-omni-small",
      input: ["alpha", "beta"],
    }).success,
    true
  );
  const canonical = {
    type: "image" as const,
    source: { type: "base64" as const, data: PNG_B64, media_type: "image/png" },
  };
  const parsed = v1EmbeddingsSchema.safeParse({
    model: "jina-ai/jina-embeddings-v5-omni-small",
    input: [canonical],
  });
  assert.equal(parsed.success, true);
  if (parsed.success) assert.deepEqual(parsed.data.input, [canonical]);
  assert.deepEqual(normalizeJinaNativeEmbeddingInput(["alpha", "beta"]), ["alpha", "beta"]);
});

test("still rejects unsafe remote image URLs after Jina-native normalize", () => {
  const parsed = v1EmbeddingsSchema.safeParse({
    model: "jina-ai/jina-embeddings-v5-omni-small",
    input: [{ image: "http://127.0.0.1/image.png" }],
  });
  assert.equal(parsed.success, false);
});
