import test from "node:test";
import assert from "node:assert/strict";
import {
  ANALYSIS_MAX_EDGE,
  EmptyUpstreamResponseError,
  IMAGE_MODEL,
  IMAGE_ORIENTATIONS,
  NO_BASE,
  VERIFIED_VISION_ROUTES,
  buildMultimodalMessages,
  computeTargetDimensions,
  describeSize,
  estimateBase64Bytes,
  estimateVisionTokens,
  extractGeneratedImage,
  formatBytes,
  formatElapsed,
  isSendKey,
  orientationForSize,
  resolveEditBase,
  resolveImageEndpoint,
  routeLabel,
  seedPromptFromAnswer,
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

test("resolveImageEndpoint routes on the presence of a base image", () => {
  assert.equal(resolveImageEndpoint(false), "/api/v1/images/generations");
  assert.equal(resolveImageEndpoint(true), "/api/v1/images/edits");
});

test("isSendKey accepts a bare Enter", () => {
  assert.equal(isSendKey({ key: "Enter" }), true);
});

test("isSendKey rejects Enter with a modifier so newlines still work", () => {
  assert.equal(isSendKey({ key: "Enter", shiftKey: true }), false);
  assert.equal(isSendKey({ key: "Enter", ctrlKey: true }), false);
  assert.equal(isSendKey({ key: "Enter", metaKey: true }), false);
  assert.equal(isSendKey({ key: "Enter", altKey: true }), false);
});

test("isSendKey never fires mid-IME-composition", () => {
  // Accented and CJK input commit with Enter; sending there would truncate.
  assert.equal(isSendKey({ key: "Enter", isComposing: true }), false);
});

test("isSendKey ignores other keys", () => {
  assert.equal(isSendKey({ key: "a" }), false);
  assert.equal(isSendKey({ key: "Escape" }), false);
});

test("seedPromptFromAnswer drops a leading acknowledgement", () => {
  const out = seedPromptFromAnswer("Claro! Aqui vai: uma estampa geometrica azul.");
  assert.ok(!/claro/i.test(out), `acknowledgement survived: ${out}`);
  assert.ok(out.includes("estampa geometrica azul"));
});

test("seedPromptFromAnswer strips markdown emphasis and bullets", () => {
  const out = seedPromptFromAnswer("- **Estilo**: _minimalista_\n- Cor: azul");
  assert.ok(!out.includes("**"));
  assert.ok(!out.includes("_"));
  assert.ok(!out.trimStart().startsWith("-"));
  assert.ok(out.includes("minimalista"));
});

test("seedPromptFromAnswer removes fenced code blocks", () => {
  const out = seedPromptFromAnswer("Use isto:\n```json\n{\"a\":1}\n```\nestampa azul");
  assert.ok(!out.includes("{"), `code block survived: ${out}`);
  assert.ok(out.includes("estampa azul"));
});

test("seedPromptFromAnswer preserves content it does not recognize", () => {
  const text = "Uma camiseta preta com um leao dourado ao centro.";
  assert.equal(seedPromptFromAnswer(text), text);
});

test("seedPromptFromAnswer is safe on empty input", () => {
  assert.equal(seedPromptFromAnswer(""), "");
});

// --- Regressão: a referência anexada precisa chegar ao gpt-image-2 -----------

test("an untouched selection still sends the attached reference", () => {
  // Reported bug: the tray showed the image, the operator never clicked it, and
  // the request went to /generations carrying no image at all — a 2xx with a
  // hallucinated result and nothing to signal the reference had been dropped.
  const idx = resolveEditBase(1, null);
  assert.equal(idx, 0, "an attachment in the tray must be the default reference");
  assert.equal(resolveImageEndpoint(idx !== null), "/api/v1/images/edits");
});

test("resolveEditBase defaults to the most recent attachment", () => {
  assert.equal(resolveEditBase(3, null), 2);
});

test("resolveEditBase honours an explicit pick", () => {
  assert.equal(resolveEditBase(3, 0), 0);
  assert.equal(resolveEditBase(3, 1), 1);
});

test("resolveEditBase generates from scratch only when asked", () => {
  assert.equal(resolveEditBase(3, NO_BASE), null);
  assert.equal(resolveImageEndpoint(false), "/api/v1/images/generations");
});

test("resolveEditBase returns null with an empty tray", () => {
  assert.equal(resolveEditBase(0, null), null);
  assert.equal(resolveEditBase(0, 2), null);
  assert.equal(resolveEditBase(0, NO_BASE), null);
});

test("resolveEditBase falls back when the pick is out of range", () => {
  // An index left over from a removed attachment must not select nothing.
  assert.equal(resolveEditBase(2, 5), 1);
  assert.equal(resolveEditBase(2, -7), 1);
});

// --- Orientação ---------------------------------------------------------------

test("every orientation carries a size the endpoints accept", () => {
  assert.equal(IMAGE_ORIENTATIONS.length, 3);
  for (const o of IMAGE_ORIENTATIONS) {
    assert.match(o.size, /^\d+x\d+$/, `${o.id} must transport a WxH size`);
    assert.ok(o.label.length > 0);
    assert.match(o.ratio, /^\d+:\d+$/);
  }
});

test("the three orientations are actually square, landscape and portrait", () => {
  const shape = (size: string) => {
    const [w, h] = size.split("x").map(Number);
    return w === h ? "square" : w > h ? "landscape" : "portrait";
  };
  for (const o of IMAGE_ORIENTATIONS) {
    assert.equal(shape(o.size), o.id, `${o.label} does not match its dimensions`);
  }
});

test("orientationForSize maps a raw size back to its shape", () => {
  assert.equal(orientationForSize("1024x1536")?.id, "portrait");
  assert.equal(orientationForSize("1536x1024")?.id, "landscape");
  assert.equal(orientationForSize("1024x1024")?.id, "square");
  assert.equal(orientationForSize("999x1"), undefined);
});

test("describeSize names the shape instead of only the pixels", () => {
  assert.equal(describeSize("1024x1536"), "Retrato 1024×1536");
  assert.equal(describeSize("1024x1024"), "Quadrado 1024×1024");
});

test("describeSize degrades gracefully for an unknown size", () => {
  assert.equal(describeSize("640x480"), "640×480");
});

// --- Legenda do preview -------------------------------------------------------

test("estimateBase64Bytes decodes the payload length without allocating it", () => {
  // "AAAA" -> 3 bytes; padding shrinks the result.
  assert.equal(estimateBase64Bytes("AAAA"), 3);
  assert.equal(estimateBase64Bytes("AAA="), 2);
  assert.equal(estimateBase64Bytes("AA=="), 1);
});

test("estimateBase64Bytes ignores a data: URL prefix and whitespace", () => {
  assert.equal(estimateBase64Bytes("data:image/png;base64,AAAA"), 3);
  assert.equal(estimateBase64Bytes("AA\nAA"), 3);
});

test("estimateBase64Bytes is safe on empty input", () => {
  assert.equal(estimateBase64Bytes(""), 0);
  assert.equal(estimateBase64Bytes("data:image/png;base64,"), 0);
});

test("formatBytes scales to the unit a human reads", () => {
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(2048), "2 KB");
  assert.equal(formatBytes(3 * 1024 * 1024), "3.0 MB");
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(-1), "0 B");
});

test("formatElapsed always reads as seconds with one decimal", () => {
  assert.equal(formatElapsed(0), "0.0s");
  assert.equal(formatElapsed(8300), "8.3s");
  assert.equal(formatElapsed(20000), "20.0s");
  assert.equal(formatElapsed(-5), "0.0s");
  assert.equal(formatElapsed(Number.NaN), "0.0s");
});

test("seedPromptFromAnswer does not swallow a long first sentence", () => {
  // The acknowledgement stripper is bounded so it cannot eat real content.
  const long =
    "Certo, considerando todo o historico da conversa e as referencias enviadas " +
    "pelo operador ao longo das ultimas mensagens, proponho o seguinte. Estampa azul.";
  const out = seedPromptFromAnswer(long);
  assert.ok(out.includes("Estampa azul"));
  assert.ok(out.includes("historico"), "content beyond the 80-char bound must survive");
});
