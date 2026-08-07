import { test } from "node:test";
import assert from "node:assert";
import { detectMediaParts } from "../../open-sse/utils/mediaParts";

const msg = (content: unknown) => [{ role: "user", content }];

test("detects OpenAI image_url part", () => {
  const parts = detectMediaParts(
    msg([{ type: "image_url", image_url: { url: "https://x/i.png" } }])
  );
  assert.equal(parts.length, 1);
  assert.equal(parts[0].kind, "image");
  assert.equal(parts[0].ref, "https://x/i.png");
});

test("detects Anthropic base64 image source", () => {
  const parts = detectMediaParts(
    msg([{ type: "image", source: { type: "base64", media_type: "image/png", data: "AAA" } }])
  );
  assert.equal(parts[0].ref, "data:image/png;base64,AAA");
});

test("detects Responses-API input_image (gap atual)", () => {
  const parts = detectMediaParts(msg([{ type: "input_image", image_url: "https://x/i.png" }]));
  assert.equal(parts.length, 1);
  assert.equal(parts[0].kind, "image");
});

test("detects bare data:image string in content array", () => {
  const parts = detectMediaParts(msg([{ type: "text", text: "data:image/jpeg;base64,QUJD" }]));
  assert.equal(parts.length, 1);
});

test("detects input_audio and audio_url as audio kind", () => {
  const parts = detectMediaParts(
    msg([
      { type: "input_audio", input_audio: { data: "QUJD", format: "wav" } },
      { type: "audio_url", audio_url: { url: "https://x/a.mp3" } },
    ])
  );
  assert.deepEqual(
    parts.map((p) => p.kind),
    ["audio", "audio"]
  );
});

test("recursion depth capped at 8", () => {
  let nested: Record<string, unknown> = { type: "image_url", image_url: { url: "https://x" } };
  for (let i = 0; i < 10; i++) nested = { wrap: nested };
  assert.equal(detectMediaParts(msg([nested])).length, 0);
});

test("string content and empty messages yield []", () => {
  assert.deepEqual(detectMediaParts([{ role: "user", content: "oi" }]), []);
  assert.deepEqual(detectMediaParts([]), []);
});
