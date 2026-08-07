import { test } from "node:test";
import assert from "node:assert";

import {
  resolveVisionBridgeRuntimeSettings,
  MODALITY_BRIDGE_DEFAULTS,
} from "../../src/shared/constants/modalityBridgeDefaults.ts";
import { updateSettingsSchema } from "../../src/shared/validation/settingsSchemas.ts";

test("new keys win over legacy keys", () => {
  const s = resolveVisionBridgeRuntimeSettings({
    modalityBridgeVisionEnabled: false,
    visionBridgeEnabled: true,
    modalityBridgeVisionModel: "gemini/gemini-2.5-flash",
    visionBridgeModel: "openai/gpt-4o-mini",
  });
  assert.equal(s.enabled, false);
  assert.equal(s.model, "gemini/gemini-2.5-flash");
});

test("legacy keys used as fallback when new keys absent (rollback 1 ciclo)", () => {
  const s = resolveVisionBridgeRuntimeSettings({
    visionBridgeEnabled: false,
    visionBridgePrompt: "legacy prompt",
  });
  assert.equal(s.enabled, false);
  assert.equal(s.prompt, "legacy prompt");
});

test("defaults: mode auto, taskAware true, cache on", () => {
  const s = resolveVisionBridgeRuntimeSettings({});
  assert.equal(s.mode, "auto");
  assert.equal(s.taskAware, true);
  assert.equal(s.cacheEnabled, true);
  assert.equal(s.cacheTtlMin, MODALITY_BRIDGE_DEFAULTS.cacheTtlMin);
});

test("Modality Bridge settings are accepted by the settings PATCH schema", () => {
  const validation = updateSettingsSchema.safeParse({
    modalityBridgeVisionEnabled: true,
    modalityBridgeVisionMode: "describe",
    modalityBridgeVisionModel: "gemini/gemini-2.5-flash",
    modalityBridgeVisionTaskAware: false,
    modalityBridgeVisionPrompt: "Describe the image contents briefly.",
    modalityBridgeVisionTimeout: 45000,
    modalityBridgeVisionMaxImages: 6,
    modalityBridgeAudioEnabled: true,
    modalityBridgeAudioModel: "openai/gpt-4o-mini-transcribe",
    modalityBridgeAudioTimeout: 60000,
    modalityBridgeAudioMaxClips: 3,
    modalityBridgeCacheEnabled: true,
    modalityBridgeCacheTtlMin: 60,
    modalityBridgeCacheMaxEntries: 200,
  });

  assert.equal(validation.success, true);
});

test("Modality Bridge settings keep numeric bounds and enum enforced", () => {
  const outOfBounds = updateSettingsSchema.safeParse({
    modalityBridgeVisionTimeout: 999999,
    modalityBridgeVisionMaxImages: 0,
    modalityBridgeAudioMaxClips: 11,
    modalityBridgeCacheTtlMin: 0,
    modalityBridgeCacheMaxEntries: 9,
  });
  assert.equal(outOfBounds.success, false);

  const badMode = updateSettingsSchema.safeParse({
    modalityBridgeVisionMode: "invalid-mode",
  });
  assert.equal(badMode.success, false);
});
