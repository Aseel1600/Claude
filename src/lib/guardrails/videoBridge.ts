import { getSettings as defaultGetSettings } from "@/lib/db/settings";
import { getResolvedModelCapabilities } from "@/lib/modelCapabilities";
import {
  resolveVideoBridgeRuntimeSettings,
  resolveVisionBridgeRuntimeSettings,
} from "@/shared/constants/modalityBridgeDefaults";

import { BaseGuardrail, type GuardrailContext, type GuardrailResult } from "./base";
import { bridgeCacheKey, getSharedBridgeCacheFor } from "./modalityBridge/bridgeCache";
import { recordBridgeUse } from "./modalityBridge/bridgeStats";
import {
  describeVideoPart as defaultDescribeVideoPart,
  extractVideoParts,
  formatVideoTimestamp,
  replaceVideoParts,
  type DescribedVideo,
  type VideoPart,
} from "./videoBridgeHelpers";
import {
  callVisionModel as defaultCallVisionModel,
  type VisionModelConfig,
} from "./visionBridgeHelpers";

type VideoBridgeBody = {
  model?: string;
  messages?: Array<{ role?: string; content?: unknown }>;
  input?: Array<{ role?: string; content?: unknown }>;
  [key: string]: unknown;
};

export interface VideoBridgeDependencies {
  getSettings?: () => Promise<Record<string, unknown>>;
  getCapabilities?: (model: string) => { supportsVideo: boolean | null };
  describePart?: (part: VideoPart) => Promise<DescribedVideo>;
  callVisionModel?: (
    imageDataUri: string,
    config: VisionModelConfig,
    apiKey?: string
  ) => Promise<string>;
}

export class VideoBridgeGuardrail extends BaseGuardrail {
  name = "video-bridge";
  priority = 7;

  private readonly deps: VideoBridgeDependencies;

  constructor(options?: { enabled?: boolean; deps?: VideoBridgeDependencies }) {
    super("video-bridge", { priority: 7, enabled: options?.enabled });
    this.deps = options?.deps ?? {};
  }

  async preCall(payload: unknown, context: GuardrailContext): Promise<GuardrailResult<unknown>> {
    if (!this.enabled || context.disabledGuardrails?.includes("video-bridge")) {
      return { block: false };
    }

    const body = payload as VideoBridgeBody;
    const model = context.model || body.model;
    if (!model) return { block: false };

    const getSettings = this.deps.getSettings ?? defaultGetSettings;
    let persisted: Record<string, unknown> = {};
    try {
      persisted = await getSettings();
    } catch {
      // Early boot can run before the settings database is ready; defaults are safe.
    }
    const runtime = resolveVideoBridgeRuntimeSettings(persisted);
    if (!runtime.enabled) return { block: false };

    const parts = extractVideoParts(body).slice(0, runtime.maxVideos);
    if (parts.length === 0) return { block: false };

    const capabilities = (this.deps.getCapabilities ?? getResolvedModelCapabilities)(model);
    if (capabilities.supportsVideo === true) return { block: false };

    const visionRuntime = resolveVisionBridgeRuntimeSettings(persisted);
    const videoModel = runtime.model.trim() || visionRuntime.model.trim();
    const startedAt = Date.now();
    const descriptions: Array<string | null> = [];
    let totalFramesRequested = 0;
    let totalFramesUsed = 0;
    let totalDurationSeconds = 0;
    let totalCacheHits = 0;
    let failures = 0;

    for (let index = 0; index < parts.length; index++) {
      const part = parts[index];
      try {
        if (!videoModel) throw new Error("Video Bridge vision model is not configured");
        const described = this.deps.describePart
          ? await this.deps.describePart(part)
          : await this.describeWithVisionModel(part, runtime, visionRuntime, videoModel);
        const videoCacheHits = described.cacheHits ?? 0;
        descriptions.push(described.description);
        totalFramesRequested += described.framesRequested;
        totalFramesUsed += described.framesUsed;
        totalDurationSeconds += described.durationSeconds;
        totalCacheHits += videoCacheHits;
        recordBridgeUse("video", { cacheHit: videoCacheHits > 0 });
      } catch {
        failures += 1;
        recordBridgeUse("video", { failure: true });
        context.log?.warn?.(
          "VIDEO_BRIDGE",
          `Failed to describe video ${index + 1}; preserving or stubbing it according to capability policy`
        );
        descriptions.push(
          capabilities.supportsVideo === false
            ? `[Video ${index + 1}]: (unavailable — video could not be described)`
            : null
        );
      }
    }

    const videosProcessed = descriptions.filter((description) => description !== null).length;
    if (videosProcessed === 0) return { block: false };

    return {
      block: false,
      modifiedPayload: replaceVideoParts(body, parts, descriptions),
      meta: {
        cacheHits: totalCacheHits,
        durationSeconds: totalDurationSeconds,
        failures,
        framesRequested: totalFramesRequested,
        framesUsed: totalFramesUsed,
        processingTimeMs: Date.now() - startedAt,
        videoModel: videoModel || "unavailable",
        videosProcessed,
      },
    };
  }

  private async describeWithVisionModel(
    part: VideoPart,
    runtime: ReturnType<typeof resolveVideoBridgeRuntimeSettings>,
    visionRuntime: ReturnType<typeof resolveVisionBridgeRuntimeSettings>,
    videoModel: string
  ): Promise<DescribedVideo> {
    const cache = runtime.cacheEnabled ? getSharedBridgeCacheFor(runtime) : null;
    const callVisionModel = this.deps.callVisionModel ?? defaultCallVisionModel;
    let cacheHits = 0;
    const described = await defaultDescribeVideoPart(
      part,
      {
        frameCount: runtime.frameCount,
        timeoutMs: runtime.timeoutMs,
      },
      async (frameDataUri, timestampSeconds, signal) => {
        const prompt = `${visionRuntime.prompt}\n\nThis frame is from a video at ${formatVideoTimestamp(timestampSeconds)}. Describe only observable details relevant to the video.`;
        const key = cache
          ? bridgeCacheKey(frameDataUri, `${prompt}@${timestampSeconds.toFixed(3)}`, videoModel)
          : null;
        const cached = key && cache ? cache.get(key) : undefined;
        if (cached !== undefined) {
          cacheHits += 1;
          return cached;
        }
        const caption = await callVisionModel(frameDataUri, {
          maxImages: 1,
          model: videoModel,
          prompt,
          signal,
          timeoutMs: runtime.timeoutMs,
        });
        if (key && cache) cache.set(key, caption);
        return caption;
      }
    );
    return { ...described, cacheHits };
  }
}
