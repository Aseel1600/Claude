import assert from "node:assert/strict";
import test from "node:test";

import {
  getAllAudioModels,
  getSpeechProvider,
  parseSpeechModel,
} from "../../open-sse/config/audioRegistry.ts";
import { getImageProvider, parseImageModel } from "../../open-sse/config/imageRegistry.ts";
import { REGISTRY } from "../../open-sse/config/providerRegistry.ts";
import { hasSpecializedExecutor } from "../../open-sse/executors/index.ts";

test("Raycast Relay-derived provider is absent from discovery and executor dispatch", () => {
  assert.equal(REGISTRY.raycast, undefined);
  assert.equal(REGISTRY.rc, undefined);
  assert.equal(hasSpecializedExecutor("raycast"), false);
  assert.equal(hasSpecializedExecutor("rc"), false);
});

test("gpt4free-derived Hailuo Web provider is absent without removing official MiniMax", () => {
  assert.equal(REGISTRY["hailuo-web"], undefined);
  assert.equal(hasSpecializedExecutor("hailuo-web"), false);
  assert.ok(REGISTRY.minimax, "the official MiniMax provider must remain registered");
  assert.ok(REGISTRY["minimax-cn"], "the official MiniMax China provider must remain registered");
});

test("gpt4free-derived Felo Web provider and alias are absent", () => {
  assert.equal(REGISTRY["felo-web"], undefined);
  assert.equal(hasSpecializedExecutor("felo-web"), false);
  assert.equal(hasSpecializedExecutor("felo"), false);
});

test("gpt4free-derived Qwen Web is absent without removing supported Qwen providers", () => {
  assert.equal(REGISTRY["qwen-web"], undefined);
  assert.equal(hasSpecializedExecutor("qwen-web"), false);
  assert.equal(hasSpecializedExecutor("qw"), false);
  assert.equal(
    REGISTRY.qwen,
    undefined,
    "the retired chat.qwen.ai OAuth provider must not be resurrected"
  );
  assert.ok(REGISTRY["qwen-cloud"], "the official Qwen Cloud provider must remain registered");
  assert.ok(
    REGISTRY["qwen-cloud-token-plan"],
    "the Qwen token-plan provider must remain registered"
  );
});

test("Gemini Web chat remains available after the derived image parser is removed", () => {
  assert.ok(REGISTRY["gemini-web"], "the independently implemented chat provider must remain");
  assert.equal(hasSpecializedExecutor("gemini-web"), true);
  assert.equal(getImageProvider("gemini-web"), null);
  assert.deepEqual(parseImageModel("gemini-web/nano-banana-web"), {
    provider: null,
    model: "gemini-web/nano-banana-web",
  });
});

test("gpt4free-derived Microsoft Designer Web is absent without removing M365 Copilot", () => {
  assert.equal(REGISTRY["microsoft-designer-web"], undefined);
  assert.equal(hasSpecializedExecutor("microsoft-designer-web"), false);
  assert.equal(hasSpecializedExecutor("msdesigner"), false);
  assert.equal(getImageProvider("microsoft-designer-web"), null);
  assert.deepEqual(parseImageModel("microsoft-designer-web/dall-e-3"), {
    provider: null,
    model: "microsoft-designer-web/dall-e-3",
  });
  assert.ok(REGISTRY["copilot-m365-web"], "the independent M365 Copilot provider must remain");
});

test("EdgeTTS is absent from speech discovery while unknown models remain unresolved", () => {
  assert.equal(getSpeechProvider("edgetts"), null);
  assert.deepEqual(parseSpeechModel("edgetts/en-US-AriaNeural"), {
    provider: null,
    model: "edgetts/en-US-AriaNeural",
  });
  assert.equal(
    getAllAudioModels().some(({ provider }) => provider === "edgetts"),
    false
  );
});
