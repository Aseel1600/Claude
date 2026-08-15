import assert from "node:assert/strict";
import test from "node:test";

import {
  buildModalityBridgeHeader,
  getBridgeStats,
  recordBridgeUse,
} from "../../src/lib/guardrails/modalityBridge/bridgeStats.ts";

test("composes vision, audio, and video bridge header segments in deterministic order", () => {
  assert.equal(
    buildModalityBridgeHeader([
      {
        guardrail: "vision-bridge",
        meta: { imagesProcessed: 2, visionModel: "openai/gpt-4o-mini" },
      },
      {
        guardrail: "audio-bridge",
        meta: { clipsProcessed: 1, sttModel: "deepgram/nova-3" },
      },
      {
        guardrail: "video-bridge",
        meta: { videoModel: "openai/gpt-4o-mini", videosProcessed: 3 },
      },
    ]),
    "image->text;model=openai/gpt-4o-mini;parts=2, " +
      "audio->text;model=deepgram/nova-3;parts=1, " +
      "video->text;model=openai/gpt-4o-mini;parts=3"
  );
});

test("tracks video bridge totals, failures, and cache hits independently", () => {
  const before = getBridgeStats().video;
  recordBridgeUse("video", { cacheHit: true });
  recordBridgeUse("video", { failure: true });
  const after = getBridgeStats().video;

  assert.equal(after.bridged - before.bridged, 2);
  assert.equal(after.cacheHits - before.cacheHits, 1);
  assert.equal(after.failures - before.failures, 1);
  assert.match(after.lastUsedAt ?? "", /^\d{4}-\d{2}-\d{2}T/);
});
