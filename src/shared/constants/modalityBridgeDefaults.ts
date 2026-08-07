/**
 * Modality Bridge default configuration values (PR-1).
 *
 * New `modalityBridge*` settings keys supersede the legacy `visionBridge*`
 * keys; the legacy keys stay accepted as a fallback for one release cycle
 * (rollback window) and are resolved here in a single place.
 */
import { VISION_BRIDGE_DEFAULTS } from "./visionBridgeDefaults";

export type VisionBridgeMode = "auto" | "describe" | "reroute";

export const MODALITY_BRIDGE_DEFAULTS = {
  visionMode: "auto" as VisionBridgeMode,
  visionTaskAware: true,
  cacheEnabled: true,
  cacheTtlMin: 60,
  cacheMaxEntries: 200,
  audioEnabled: true,
  audioModel: "",
  audioTimeoutMs: 60000,
  audioMaxClips: 3,
} as const;

export interface VisionBridgeRuntimeSettings {
  enabled: boolean;
  mode: VisionBridgeMode;
  model: string;
  taskAware: boolean;
  prompt: string;
  timeoutMs: number;
  maxImages: number;
  cacheEnabled: boolean;
  cacheTtlMin: number;
  cacheMaxEntries: number;
}

function pick<T>(...values: unknown[]): T | undefined {
  for (const v of values) if (v !== undefined && v !== null) return v as T;
  return undefined;
}

/** New modalityBridge* keys win; legacy visionBridge* keys are a one-cycle fallback. */
export function resolveVisionBridgeRuntimeSettings(
  settings: Record<string, unknown> | null | undefined
): VisionBridgeRuntimeSettings {
  const s = settings ?? {};
  const mode = pick<string>(s.modalityBridgeVisionMode);
  return {
    enabled:
      pick<boolean>(s.modalityBridgeVisionEnabled, s.visionBridgeEnabled) ??
      VISION_BRIDGE_DEFAULTS.enabled,
    mode: mode === "describe" || mode === "reroute" ? mode : MODALITY_BRIDGE_DEFAULTS.visionMode,
    model:
      pick<string>(s.modalityBridgeVisionModel, s.visionBridgeModel) ??
      VISION_BRIDGE_DEFAULTS.model,
    taskAware:
      pick<boolean>(s.modalityBridgeVisionTaskAware) ?? MODALITY_BRIDGE_DEFAULTS.visionTaskAware,
    prompt:
      pick<string>(s.modalityBridgeVisionPrompt, s.visionBridgePrompt) ??
      VISION_BRIDGE_DEFAULTS.prompt,
    timeoutMs:
      pick<number>(s.modalityBridgeVisionTimeout, s.visionBridgeTimeout) ??
      VISION_BRIDGE_DEFAULTS.timeoutMs,
    maxImages:
      pick<number>(s.modalityBridgeVisionMaxImages, s.visionBridgeMaxImages) ??
      VISION_BRIDGE_DEFAULTS.maxImagesPerRequest,
    cacheEnabled:
      pick<boolean>(s.modalityBridgeCacheEnabled) ?? MODALITY_BRIDGE_DEFAULTS.cacheEnabled,
    cacheTtlMin: pick<number>(s.modalityBridgeCacheTtlMin) ?? MODALITY_BRIDGE_DEFAULTS.cacheTtlMin,
    cacheMaxEntries:
      pick<number>(s.modalityBridgeCacheMaxEntries) ?? MODALITY_BRIDGE_DEFAULTS.cacheMaxEntries,
  };
}
