import test from "node:test";
import assert from "node:assert/strict";
import {
  ANALYSIS_MAX_EDGE,
  EmptyUpstreamResponseError,
  IMAGE_MODEL,
  VERIFIED_VISION_ROUTES,
  buildMultimodalMessages,
  computeTargetDimensions,
  estimateVisionTokens,
  extractGeneratedImage,
  routeLabel,
  type ChatMessage,
} from "@/app/(dashboard)/dashboard/image-chat/imageChatHelpers";

test("buildMultimodalMessages keeps text-only turns as a plain string", () => {
  const msgs: ChatMessage[] = [{ role: "user", content: "oi" }];
  const out = buildMultimodalMessages(msgs);
  assert.equal(out.length, 1);
  assert.equal(out[0].content, "oi");
});

test("buildMultimodalMessages emits typed parts when a turn has attachments", () => {
  const msgs: ChatMessage[] = [
    { role: "user", content: "o que e isso?", attachments: ["data:image/png;base64,AAA"] },
  ];
  const out = buildMultimodalMessages(msgs);
  const parts = out[0].content;
  assert.ok(Array.isArray(parts), "content must be an array of parts");
  assert.deepEqual(parts[0], { type: "text", text: "o que e isso?" });
  assert.deepEqual(parts[1], {
    type: "image_url",
    image_url: { url: "data:image/png;base64,AAA" },
  });
});

test("buildMultimodalMessages never concatenates base64 into a text string", () => {
  const msgs: ChatMessage[] = [
    { role: "user", content: "veja", attachments: ["data:image/png;base64,SECRETBLOB"] },
  ];
  const out = buildMultimodalMessages(msgs);
  const textParts = (out[0].content as Array<{ type: string; text?: string }>).filter(
    (p) => p.type === "text"
  );
  for (const p of textParts) {
    assert.ok(!p.text?.includes("SECRETBLOB"), "base64 must not leak into a text part");
  }
});

test("buildMultimodalMessages omits an attachment-only turn's empty text part", () => {
  const msgs: ChatMessage[] = [
    { role: "user", content: "   ", attachments: ["data:image/png;base64,AAA"] },
  ];
  const parts = buildMultimodalMessages(msgs)[0].content as Array<{ type: string }>;
  assert.equal(parts.length, 1);
  assert.equal(parts[0].type, "image_url");
});

test("buildMultimodalMessages does not replay generated images upstream", () => {
  const msgs: ChatMessage[] = [
    { role: "user", content: "gere" },
    { role: "assistant", content: "", image: "iVBORw0KGgo=" },
    { role: "user", content: "de novo" },
  ];
  const out = buildMultimodalMessages(msgs);
  assert.equal(out.length, 2);
  assert.deepEqual(
    out.map((m) => m.role),
    ["user", "user"]
  );
});

test("buildMultimodalMessages prepends the system prompt when present", () => {
  const out = buildMultimodalMessages([{ role: "user", content: "oi" }], "seja breve");
  assert.equal(out[0].role, "system");
  assert.equal(out[0].content, "seja breve");
});

test("computeTargetDimensions leaves images within budget untouched", () => {
  const r = computeTargetDimensions(800, 600);
  assert.deepEqual(r, { width: 800, height: 600, resized: false });
});

test("computeTargetDimensions scales the longest edge and keeps the aspect ratio", () => {
  const r = computeTargetDimensions(4000, 2000);
  assert.equal(r.resized, true);
  assert.equal(r.width, ANALYSIS_MAX_EDGE);
  assert.equal(r.height, ANALYSIS_MAX_EDGE / 2);
});

test("computeTargetDimensions handles portrait orientation", () => {
  const r = computeTargetDimensions(1000, 3000);
  assert.equal(r.height, ANALYSIS_MAX_EDGE);
  assert.ok(r.width < r.height);
});

test("estimateVisionTokens reproduces the measured TCB baseline", () => {
  // Measured 2026-08-06 on the TCB adapter: 128->27, 256->84, 512->315, 1024->1236.
  const cases: Array<[number, number]> = [
    [128, 27],
    [256, 84],
    [512, 315],
    [1024, 1236],
  ];
  for (const [edge, expected] of cases) {
    const got = estimateVisionTokens(edge, edge);
    assert.ok(
      Math.abs(got - expected) <= Math.max(2, expected * 0.05),
      `${edge}x${edge}: expected ~${expected}, got ${got}`
    );
  }
});

test("estimateVisionTokens is defensive about invalid dimensions", () => {
  assert.equal(estimateVisionTokens(0, 100), 0);
  assert.equal(estimateVisionTokens(-1, 10), 0);
  assert.equal(estimateVisionTokens(Number.NaN, 10), 0);
});

test("extractGeneratedImage returns the b64 payload", () => {
  const b64 = extractGeneratedImage({ data: [{ b64_json: "iVBORw0KGgo=" }] });
  assert.equal(b64, "iVBORw0KGgo=");
});

test("extractGeneratedImage falls back to a url payload", () => {
  const url = extractGeneratedImage({ data: [{ url: "https://example.test/a.png" }] });
  assert.equal(url, "https://example.test/a.png");
});

test("extractGeneratedImage treats a 2xx without usable content as an error", () => {
  // The chat endpoint answers exactly this shape for image models: 200, no image.
  assert.throws(() => extractGeneratedImage({ data: [] }), EmptyUpstreamResponseError);
  assert.throws(() => extractGeneratedImage({}), EmptyUpstreamResponseError);
  assert.throws(() => extractGeneratedImage({ data: [{ b64_json: "  " }] }), EmptyUpstreamResponseError);
});

test("only vision-verified routes are offered for attachments", () => {
  assert.ok(VERIFIED_VISION_ROUTES.length > 0);
  for (const route of VERIFIED_VISION_ROUTES) {
    assert.ok(
      route.includes("f71d6553"),
      "VOID routes tokenize base64 as text or ignore the image — they must not be listed"
    );
  }
});

test("the image model is a dedicated image route, not a chat model", () => {
  assert.ok(IMAGE_MODEL.endsWith("/gpt-image-2"));
  assert.ok(!VERIFIED_VISION_ROUTES.includes(IMAGE_MODEL as never));
});

test("routeLabel strips the provider prefix", () => {
  assert.equal(routeLabel("openai-compatible-chat-abc/gpt-5.6"), "gpt-5.6");
  assert.equal(routeLabel("semprefixo"), "semprefixo");
});
