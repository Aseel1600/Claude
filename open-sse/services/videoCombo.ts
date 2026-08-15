/**
 * Video Combo Strategy Execution
 *
 * Mirrors imageCombo for /v1/videos/generations: expands combo targets via
 * resolveComboTargets(), filters to video-capable targets, runs each through
 * handleVideoGeneration() in priority order, and returns the first success or
 * the last failure.
 *
 * Terminal-vs-retryable classification matches the image strategy: 400/401/403
 * stop the walk (a bad model or a banned key will not get better on the next
 * target), everything else advances.
 */
import { getComboByName, getCombos } from "@/lib/db/combos";
import { resolveComboTargets } from "@omniroute/open-sse/services/combo.ts";
import { parseVideoModel, getVideoProvider } from "@omniroute/open-sse/config/videoRegistry.ts";
import { resolveVideoCredentialProvider } from "@omniroute/open-sse/handlers/videoGeneration/googleFlow.ts";
import {
  getProviderCredentialsWithQuotaPreflight,
  clearRecoveredProviderState,
} from "@/sse/services/auth";
import { isAllRateLimitedCredentials } from "@/app/api/v1/_shared/rateLimit";
import { handleVideoGeneration } from "@omniroute/open-sse/handlers/videoGeneration.ts";
import {
  isMediaGenerationFailure,
  successfulMediaGenerationResponse,
} from "@/app/api/v1/_shared/mediaGenerationRoute";
import type { MediaGenerationResultLike } from "@/app/api/v1/_shared/mediaGenerationRoute";
import { toJsonErrorPayload } from "@/shared/utils/upstreamError";
import { HTTP_STATUS } from "@omniroute/open-sse/config/constants.ts";
import { errorResponse } from "@omniroute/open-sse/utils/error.ts";
import * as logger from "@/sse/utils/logger";

/**
 * Execute a full combo strategy for a video generation request.
 */
export async function executeVideoCombo(
  comboName: string,
  body: Record<string, unknown>,
  auth: {
    request: Request;
    policy: { apiKeyInfo?: { id?: string; name?: string } | null };
  },
  startTime: number,
  log: typeof logger
): Promise<Response> {
  const combo = await getComboByName(comboName);
  if (!combo) {
    return errorResponse(HTTP_STATUS.BAD_REQUEST, `Combo not found: ${comboName}`);
  }

  const allCombos = await getCombos();
  const targets = resolveComboTargets(combo as never, allCombos as never);
  if (!targets || targets.length === 0) {
    return errorResponse(HTTP_STATUS.BAD_REQUEST, `Combo "${comboName}" has no usable targets`);
  }

  const videoTargets = targets.filter((t) => {
    if (!t.modelStr) return false;
    return Boolean(parseVideoModel(t.modelStr).provider);
  });

  if (videoTargets.length === 0) {
    return errorResponse(
      HTTP_STATUS.BAD_REQUEST,
      `No video-capable targets in combo "${comboName}"`
    );
  }

  let lastError: { status: number; error: string } | null = null;
  let fallbackCount = 0;

  for (const target of videoTargets) {
    const { provider: targetProvider } = parseVideoModel(target.modelStr);
    if (!targetProvider) {
      lastError = { status: 400, error: `Invalid video model: ${target.modelStr}` };
      fallbackCount += 1;
      continue;
    }

    // Local providers (authType "none") carry no credential, exactly as the
    // direct route treats them.
    const providerConfig = getVideoProvider(targetProvider);
    let credentials = null;
    if (providerConfig && providerConfig.authType !== "none") {
      try {
        credentials = await getProviderCredentialsWithQuotaPreflight(
          resolveVideoCredentialProvider(targetProvider)
        );
      } catch {
        lastError = { status: 502, error: `Failed to resolve credentials for ${targetProvider}` };
        fallbackCount += 1;
        continue;
      }

      if (!credentials) {
        lastError = { status: 400, error: `No credentials for video provider: ${targetProvider}` };
        fallbackCount += 1;
        continue;
      }

      if (isAllRateLimitedCredentials(credentials)) {
        lastError = { status: 429, error: `[${targetProvider}] All accounts rate limited` };
        fallbackCount += 1;
        continue;
      }
    }

    const result: MediaGenerationResultLike = await handleVideoGeneration({
      body: { ...body, model: target.modelStr },
      credentials,
      log,
    });

    if (!isMediaGenerationFailure(result)) {
      await clearRecoveredProviderState(credentials);
      return successfulMediaGenerationResponse({
        result: { data: result.data },
        billingMode: "video",
        provider: targetProvider,
        model: target.modelStr,
        startTime,
        duration: body.duration,
        strategy: "priority",
        fallbackAttempts: fallbackCount,
      });
    }

    const status = (result as { status?: number }).status || 500;
    const error =
      typeof (result as { error?: unknown }).error === "string"
        ? (result as { error: string }).error
        : "Video generation failed";

    if (status === 400 || status === 401 || status === 403) {
      return errorResponse(status, `[${targetProvider}] ${error}`);
    }

    lastError = { status, error: `[${targetProvider}] ${error}` };
    fallbackCount += 1;
  }

  const errorPayload = toJsonErrorPayload(
    lastError?.error || "All combo targets failed",
    "Video combo targets all failed"
  );
  return new Response(JSON.stringify(errorPayload), {
    status: lastError?.status || 502,
    headers: { "Content-Type": "application/json" },
  });
}
