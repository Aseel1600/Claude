import assert from "node:assert/strict";
import test from "node:test";

import { VideoBridgeGuardrail } from "../../../src/lib/guardrails/videoBridge.ts";
import {
  buildModalityBridgeHeader,
  getBridgeStats,
} from "../../../src/lib/guardrails/modalityBridge/bridgeStats.ts";
import {
  registerDefaultGuardrails,
  resetGuardrailsForTests,
} from "../../../src/lib/guardrails/registry.ts";

const payload = () => ({
  model: "example/text-only",
  messages: [
    {
      role: "user",
      content: [
        { type: "input_video", video_url: "data:video/mp4;base64,QUJD" },
        { type: "text", text: "What happens?" },
      ],
    },
  ],
});

function guardrail(options: { capability?: boolean | null; fail?: boolean } = {}) {
  return new VideoBridgeGuardrail({
    deps: {
      getSettings: async () => ({
        modalityBridgeVideoEnabled: true,
        modalityBridgeVideoModel: "openai/gpt-4o-mini",
        modalityBridgeCacheEnabled: false,
      }),
      getCapabilities: () => ({
        supportsVideo: options.capability === undefined ? false : options.capability,
      }),
      describePart: async () => {
        if (options.fail) throw new Error("private ffmpeg failure");
        return {
          description: "[Video description: frame@t=00:01.000 a person waves]",
          durationSeconds: 2,
          framesRequested: 1,
          framesUsed: 1,
        };
      },
    },
  });
}

test("VideoBridgeGuardrail has priority 7 and native video targets bypass conversion", async () => {
  let calls = 0;
  const native = new VideoBridgeGuardrail({
    deps: {
      getSettings: async () => ({ modalityBridgeVideoEnabled: true }),
      getCapabilities: () => ({ supportsVideo: true }),
      describePart: async () => {
        calls += 1;
        throw new Error("should not run");
      },
    },
  });
  assert.equal(native.name, "video-bridge");
  assert.equal(native.priority, 7);
  assert.equal((await native.preCall(payload(), {})).modifiedPayload, undefined);
  assert.equal(calls, 0);
});

test("converts Chat video to timestamped text and emits telemetry/header metadata", async () => {
  const before = getBridgeStats().video;
  const result = await guardrail().preCall(payload(), {});
  const modified = result.modifiedPayload as ReturnType<typeof payload>;
  assert.deepEqual(modified.messages[0].content[0], {
    type: "text",
    text: "[Video description: frame@t=00:01.000 a person waves]",
  });
  assert.equal(result.meta?.videosProcessed, 1);
  assert.equal(result.meta?.framesUsed, 1);
  assert.equal(result.meta?.videoModel, "openai/gpt-4o-mini");
  assert.equal(
    buildModalityBridgeHeader([{ guardrail: "video-bridge", meta: result.meta }]),
    "video->text;model=openai/gpt-4o-mini;parts=1"
  );
  assert.ok(getBridgeStats().video.bridged >= before.bridged + 1);
});

test("converts Responses input using input_text while preserving sibling order", async () => {
  const body = {
    model: "example/text-only",
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: "before" },
          { type: "video_url", video_url: { url: "https://example.test/video.mp4" } },
          { type: "input_text", text: "after" },
        ],
      },
    ],
  };
  const result = await guardrail().preCall(body, {});
  assert.deepEqual((result.modifiedPayload as typeof body).input[0].content, [
    { type: "input_text", text: "before" },
    { type: "input_text", text: "[Video description: frame@t=00:01.000 a person waves]" },
    { type: "input_text", text: "after" },
  ]);
});

test("preserves unknown-capability video on total failure but stubs proven text-only input", async () => {
  const original = payload();
  const snapshot = structuredClone(original);
  const unknown = await guardrail({ capability: null, fail: true }).preCall(original, {});
  assert.equal(unknown.modifiedPayload, undefined);
  assert.deepEqual(original, snapshot);

  const knownFalse = await guardrail({ capability: false, fail: true }).preCall(payload(), {});
  const modified = knownFalse.modifiedPayload as ReturnType<typeof payload>;
  assert.deepEqual(modified.messages[0].content[0], {
    type: "text",
    text: "[Video 1]: (unavailable — video could not be described)",
  });
  assert.equal(String(knownFalse.meta?.failures).includes("private"), false);
});

test("reports cache hits per converted video without carrying a previous hit forward", async () => {
  const body = payload();
  body.messages[0].content.splice(1, 0, {
    type: "video_url",
    video_url: "data:video/mp4;base64,REVG",
  });
  const before = getBridgeStats().video;
  let described = 0;
  const bridge = new VideoBridgeGuardrail({
    deps: {
      getSettings: async () => ({
        modalityBridgeVideoEnabled: true,
        modalityBridgeVideoMaxVideos: 2,
        modalityBridgeVideoModel: "openai/gpt-4o-mini",
      }),
      getCapabilities: () => ({ supportsVideo: false }),
      describePart: async () => {
        described += 1;
        return {
          cacheHits: described === 1 ? 1 : 0,
          description: `[Video description: frame@t=00:0${described}.000 frame ${described}]`,
          durationSeconds: 2,
          framesRequested: 1,
          framesUsed: 1,
        };
      },
    },
  });

  const result = await bridge.preCall(body, {});
  const after = getBridgeStats().video;
  assert.equal(result.meta?.cacheHits, 1);
  assert.equal(after.bridged - before.bridged, 2);
  assert.equal(after.cacheHits - before.cacheHits, 1);
});

test("default registry includes Video Bridge after Vision and Audio", () => {
  resetGuardrailsForTests({ registerDefaults: false });
  const names = registerDefaultGuardrails()
    .list()
    .filter((entry) => entry.name.endsWith("-bridge"))
    .map((entry) => `${entry.priority}:${entry.name}`);
  assert.deepEqual(names, ["5:vision-bridge", "6:audio-bridge", "7:video-bridge"]);
  resetGuardrailsForTests();
});
