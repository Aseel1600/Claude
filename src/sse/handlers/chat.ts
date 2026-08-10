import { randomUUID } from "crypto";
import { resolveChatRequestBody } from "./requestBody";
import * as chatAdmission from "./chatAdmission.ts";
import { buildClientRawRequest, resolveDispatchClientRawRequest } from "./chat/clientRawRequest.ts";
export { buildClientRawRequest, resolveDispatchClientRawRequest };
import { normalizeReasoningRequest } from "@/shared/reasoning/effortStandardization";
import { resolveRoutingModel, RoutingModelOps } from "./resolveRoutingModel";
import {
  getProviderCredentialsWithQuotaPreflight,
  markAccountUnavailable,
  extractApiKey,
  isValidApiKey,
  extractSessionAffinityKey,
} from "../services/auth";
import {
  getRuntimeProviderProfile,
  shouldMarkAccountExhaustedFrom429,
  clearModelLock,
  lockModel,
  recordModelLockoutFailure,
  isDailyQuotaExhausted,
} from "@omniroute/open-sse/services/accountFallback.ts";
import { getCombo, getComboForModel, getModelInfo } from "../services/model";
import { stripContextWindowSuffix } from "@omniroute/open-sse/services/model.ts";
import { resolveBareModelToConnectionDefault } from "@omniroute/open-sse/services/model.ts";
import { errorResponse } from "@omniroute/open-sse/utils/error.ts";
import { getImageModelEntry } from "@omniroute/open-sse/config/imageRegistry.ts";
import { acceptHeaderForcesStream } from "@omniroute/open-sse/utils/aiSdkCompat.ts";
import { applyNoThinkingAlias } from "@omniroute/open-sse/utils/noThinkingAlias.ts";
import { resolveCcDiscoveryAliasStrip } from "@/lib/ccDiscoveryAliasResolve";
import { handleComboChat, shouldSkipConnDisable } from "@omniroute/open-sse/services/combo.ts";
import { mergeAbortSignals } from "@omniroute/open-sse/executors/base.ts";
import { resolveRequestAutoControls } from "@omniroute/open-sse/services/autoCombo/requestControls.ts";
import { resolveComboConfig } from "@omniroute/open-sse/services/comboConfig.ts";
import { injectHandoffIntoBody } from "@omniroute/open-sse/services/contextHandoff.ts";
import {
  HTTP_STATUS,
  ANTIGRAVITY_PRE_RESPONSE_TIMEOUT_CODE,
} from "@omniroute/open-sse/config/constants.ts";
import { getTargetFormat, detectFormatFromUrl } from "@omniroute/open-sse/services/provider.ts";
import {
  getModelsByProviderId,
  getModelTargetFormat,
  PROVIDER_ID_TO_ALIAS,
} from "@omniroute/open-sse/config/providerModels.ts";
import * as log from "../utils/logger";
import { checkAndRefreshToken } from "../services/tokenRefresh";
import { createHookContext, runHooks, initPreRequestRegistry } from "@/lib/middleware/registry";
import { rejectPeerRequest } from "@/shared/resilience/peerRouting";
import { deleteHandoff, getHandoff } from "@/lib/db/contextHandoffs";
import { getComboByName, updateCombo } from "@/lib/db/combos";
import { isModelAllowedForKey } from "@/lib/db/apiKeys";
import { promoteSuccessfulComboModel } from "@/lib/combos/autoPromote";
import {
  deleteSessionAccountAffinity,
  evictSessionAccountAffinityForConnection,
  getSessionAccountAffinity,
} from "@/lib/db/sessionAccountAffinity";
import { getCachedSettings, getCombosCacheVersion } from "@/lib/db/readCache";
import { getCombos } from "@/lib/db/combos";
import { resolveModelLockoutSettings } from "@/lib/resilience/modelLockoutSettings";
import {
  ensureOpenAIStoreSessionFallback,
  isOpenAIResponsesStoreEnabled,
} from "@/lib/providers/requestDefaults";
import { guardrailRegistry, resolveDisabledGuardrails } from "@/lib/guardrails";
import {
  resolveModelOrError,
  checkPipelineGates,
  checkResourcePressureBeforeProviderWork,
  executeChatWithBreaker,
  handleNoCredentials,
  safeResolveProxy,
  safeLogEvents,
  applyExecutorProxyToInfo,
  shouldRetryStreamEarlyEof,
  withSessionHeader,
  withSelectedConnectionHeader,
  withCorrelationId,
  withModalityBridgeHeader,
} from "./chatHelpers";
import { buildModalityBridgeHeader } from "@/lib/guardrails/modalityBridge/bridgeStats";
import {
  isAntigravityMissingProjectError,
  PROVIDER_BREAKER_FAILURE_STATUSES,
  resolveStreamReadinessClassificationError,
  shouldTripProviderBreakerForResult,
} from "./chatPredicates";
import { connectionHasExtraKeys } from "@omniroute/open-sse/services/apiKeyRotator.ts";
import {
  extractReasoningIntent,
  type ExtractedReasoningIntent,
  type ReasoningRuleDecision,
} from "@/lib/reasoningRouting/policy";
import {
  applyConnectionReasoningRule,
  applyReasoningRouting,
  filterReasoningCombo,
} from "./reasoningRouting";
import { createVirtualAutoCombo, resolveAutoRoutingState } from "./autoRouting";
import { getComboFailureLogError } from "./comboFailureLogging";
import { GovernorManager } from "@omniroute/open-sse/governor/governorManager.ts";
import { getGovernorMode } from "@/shared/utils/featureFlags.ts";
import { getGovernorRuntimeConfig } from "@omniroute/open-sse/governor/runtimeConfig.ts";
import type { GovernorInput } from "@omniroute/open-sse/governor/types.ts";
import type { CounterfactualCandidate } from "@omniroute/open-sse/governor/counterfactual.ts";
import { getProviderModels, PROVIDER_ID_TO_ALIAS, PROVIDER_MODELS } from "@omniroute/open-sse/config/providerModels.ts";
import { getGovernorActiveBreaker } from "@omniroute/open-sse/governor/activeCanary.ts";

// Pipeline integration — wired modules
import { classify429FromError, type FailureKind } from "@/shared/utils/classify429";
import { isSubscriptionQuotaText } from "@omniroute/open-sse/services/quotaTextCooldowns.ts";
import { resolveUseUpstream429BreakerHints } from "@/shared/utils/providerHints";
import { getCircuitBreaker, isLocalStreamLifecycleError } from "../../shared/utils/circuitBreaker";
import { markAccountExhaustedFrom429 } from "../../domain/quotaCache";
import { RequestTelemetry, recordTelemetry } from "../../shared/utils/requestTelemetry";
import { generateRequestId } from "../../shared/utils/requestId";
import { logAuditEvent } from "../../lib/compliance/index";
import { enforceApiKeyPolicy } from "../../shared/utils/apiKeyPolicy";
import { hasProviderQuotaBypassScope } from "../../shared/constants/apiKeyPolicyScopes";
import { cloneBoundedForLog } from "@omniroute/open-sse/utils/requestLogger.ts";
import { handleInternalUsageCommand } from "@/lib/usage/internalUsageCommand";
import { updateGovernorTelemetryOutcome } from "@/lib/db/governorTelemetry";
import {
  applyTaskAwareRouting,
  getTaskRoutingConfig,
} from "@omniroute/open-sse/services/taskAwareRouter.ts";
import {
  hasNativeWebSearchTool,
  resolveWebSearchRouteOverride,
} from "@omniroute/open-sse/services/webSearchRouting.ts";
import {
  generateSessionId as generateStableSessionId,
  touchSession,
  extractExternalSessionId,
  checkSessionLimit,
  registerKeySession,
  isSessionRegisteredForKey,
} from "@omniroute/open-sse/services/sessionManager.ts";
import { startQuotaMonitor } from "@omniroute/open-sse/services/quotaMonitor.ts";
import {
  isFallbackDecision,
  shouldUseFallback,
} from "@omniroute/open-sse/services/emergencyFallback.ts";
import {
  registerCodexConnection,
  registerCodexQuotaFetcher,
} from "@omniroute/open-sse/services/codexQuotaFetcher.ts";
import { registerBailianCodingPlanQuotaFetcher } from "@omniroute/open-sse/services/bailianQuotaFetcher.ts";
import { registerCrofUsageFetcher } from "@omniroute/open-sse/services/crofUsageFetcher.ts";
import { registerDeepseekQuotaFetcher } from "@omniroute/open-sse/services/deepseekQuotaFetcher.ts";
import { registerOpenrouterQuotaFetcher } from "@omniroute/open-sse/services/openrouterQuotaFetcher.ts";
import { registerOpencodeQuotaFetcher } from "@omniroute/open-sse/services/opencodeQuotaFetcher.ts";
import { registerGrokWebQuotaFetcher } from "@omniroute/open-sse/services/grokQuotaFetcher.ts";
import { registerGenericQuotaFetchers } from "@omniroute/open-sse/services/genericQuotaFetcher.ts";
import "@omniroute/open-sse/services/quotaTrackersBatch.ts";
import {
  disableCooldownAwareRetry,
  getCooldownAwareRetryDecision,
  resolveCooldownAwareRetrySettings,
  waitForCooldownAwareRetry,
} from "../services/cooldownAwareRetry";
import { constrainConnectionsToQuota, resolveQuotaKeyScope } from "../../lib/quota/quotaKey";
import { checkConnectionCapacity } from "../utils/backpressure";

registerCodexQuotaFetcher();
registerBailianCodingPlanQuotaFetcher();
registerCrofUsageFetcher();
registerDeepseekQuotaFetcher();
registerOpenrouterQuotaFetcher();
registerOpencodeQuotaFetcher();
registerGrokWebQuotaFetcher();
registerGenericQuotaFetchers();
let combosCachePromise: Promise<unknown[]> | null = null;
let combosCacheTs = 0;
let combosCacheVersionSnapshot = -1;
const COMBOS_CACHE_TTL_MS = 10_000;

async function getCombosCachedForChat(): Promise<unknown[]> {
  const now = Date.now();
  if (
    combosCachePromise !== null &&
    now - combosCacheTs < COMBOS_CACHE_TTL_MS &&
    combosCacheVersionSnapshot === getCombosCacheVersion()
  ) {
    return combosCachePromise;
  }
  combosCacheTs = now;
  combosCacheVersionSnapshot = getCombosCacheVersion();
  combosCachePromise = getCombos().catch(() => []);
  return combosCachePromise;
}

function normalizeAllowedConnectionIds(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const ids = value.filter(
    (entry): entry is string => typeof entry === "string" && entry.trim().length > 0
  );
  return ids.length > 0 ? ids : null;
}

function intersectAllowedConnectionIds(primary: unknown, secondary: unknown): string[] | null {
  const first = normalizeAllowedConnectionIds(primary);
  const second = normalizeAllowedConnectionIds(secondary);
  if (first && second) return first.filter((id) => second.includes(id));
  return first || second || null;
}

const comboPromoteDeps = { updateCombo, info: log.info, warn: log.warn };

async function dispatchGovernedSingleModel(
  body: any,
  originalModel: string,
  clientRawRequest: any,
  request: any,
  comboName: string | null,
  apiKeyInfo: any,
  telemetry: any,
  runtimeOptions: any,
  comboStrategy: string | null,
  isCombo: boolean
) {
  const mode = getGovernorMode();
  const governed = !isCombo && (String(originalModel).startsWith("auto/") || originalModel === "auto");
  const hasExplicitConnection =
    typeof runtimeOptions.forcedConnectionId === "string" &&
    runtimeOptions.forcedConnectionId.trim().length > 0;
  if (!governed || runtimeOptions.governorBypass || mode === "off" || hasExplicitConnection) {
    return handleSingleModelChat(body, originalModel, clientRawRequest, request, comboName, apiKeyInfo, telemetry, { ...runtimeOptions, governorBypass: true }, comboStrategy, isCombo);
  }

  try {
    const original = await resolveModelOrError(originalModel, body, clientRawRequest?.endpoint, clientRawRequest?.headers);
    if (original.error) return handleSingleModelChat(body, originalModel, clientRawRequest, request, comboName, apiKeyInfo, telemetry, { ...runtimeOptions, governorBypass: true }, comboStrategy, isCombo);
    const provider = original.provider;
    const model = original.model;
    const registryCandidates: CounterfactualCandidate[] = [];
    for (const alias of Object.keys(PROVIDER_MODELS)) {
      for (const entry of getProviderModels(alias)) {
        registryCandidates.push({
          provider: PROVIDER_ID_TO_ALIAS[alias] || alias,
          model: entry.id,
          routingModelId: `${alias}/${entry.id}`,
          tier: entry.supportsXHighEffort ? "highest" : entry.supportsReasoning ? "high" : "medium",
          available: true,
          capabilities: [
            ...(entry.toolCalling ? ["tools"] : []),
            ...(entry.supportsVision ? ["vision"] : []),
          ],
          contextWindow: entry.contextLength,
          supportsReasoning: entry.supportsReasoning,
          quotaState: "unknown",
        });
      }
    }
    const input: GovernorInput = {
      correlationId: runtimeOptions.correlationId ?? undefined,
      requestedMaxOutput: body?.max_tokens,
      messageCount: Array.isArray(body?.messages) ? body.messages.length : undefined,
      toolCount: Array.isArray(body?.tools) ? body.tools.length : 0,
      availableCandidates: registryCandidates.map((candidate) => candidate.routingModelId || `${candidate.provider}/${candidate.model}`),
    };
    const { result } = GovernorManager.evaluateRequest(input, {
      provider,
      model,
      routingStrategy: "auto",
      success: null,
    }, {
      ...input,
      currentProvider: provider,
      currentModel: model,
      candidates: registryCandidates,
    } as any);
    const config = getGovernorRuntimeConfig();
    const breaker = getGovernorActiveBreaker();
    const canApply = config.activeEnabled && !breaker.isTripped() && (mode === "active" || mode === "active-canary") && result.plan?.executable === true;
    const selected = canApply ? registryCandidates.find((candidate) => candidate.provider === result.plan?.selectedProvider && candidate.model === result.plan?.selectedModel) : null;
    if (selected?.routingModelId && selected.routingModelId !== originalModel) {
      const resolved = await resolveModelOrError(selected.routingModelId, body, clientRawRequest?.endpoint, clientRawRequest?.headers);
      if (!resolved.error) {
        let allowed = intersectAllowedConnectionIds(
          apiKeyInfo?.allowedConnections ?? null,
          runtimeOptions.allowedConnectionIds ?? null
        );
        if (apiKeyInfo?.allowedQuotas && apiKeyInfo.allowedQuotas.length > 0) {
          const quotaScope = await resolveQuotaKeyScope(apiKeyInfo.allowedQuotas);
          allowed = constrainConnectionsToQuota(allowed ?? [], quotaScope.connectionIds);
        }
        if (Array.isArray(allowed) && allowed.length === 0) {
          return handleSingleModelChat(body, originalModel, clientRawRequest, request, comboName, apiKeyInfo, telemetry, { ...runtimeOptions, governorBypass: true }, comboStrategy, isCombo);
        }
        const bypassProviderQuotaPolicy = hasProviderQuotaBypassScope(apiKeyInfo?.scopes);
        const credentials = await getProviderCredentialsWithQuotaPreflight(resolved.provider, null, allowed, resolved.model, {
          sessionKey: runtimeOptions.sessionAffinityKey ?? runtimeOptions.sessionId ?? null,
          ...(bypassProviderQuotaPolicy ? { bypassQuotaPolicy: true } : {}),
        });
        if (
          credentials &&
          !credentials.allRateLimited &&
          !credentials.allExpired &&
          credentials.connectionId &&
          (!Array.isArray(allowed) || allowed.includes(credentials.connectionId))
        ) {
          const selectedResponse = await handleSingleModelChat(body, selected.routingModelId, clientRawRequest, request, comboName, apiKeyInfo, telemetry, {
            ...runtimeOptions,
            governorBypass: true,
            allowedConnectionIds: allowed,
            preselectedCredentials: credentials,
          }, comboStrategy, isCombo);
          if (selectedResponse.ok) {
            breaker.recordSuccess();
            return selectedResponse;
          }
          breaker.recordFailure();
          if (selectedResponse.status < 500 || selectedResponse.status >= 600) return selectedResponse;
          return handleSingleModelChat(body, originalModel, clientRawRequest, request, comboName, apiKeyInfo, telemetry, { ...runtimeOptions, governorBypass: true }, comboStrategy, isCombo);
        }
      }
    }
  } catch (error) {
    log.warn("GOVERNOR", `Active route degraded to original: ${error instanceof Error ? error.message : "unknown"}`);
  }
  return handleSingleModelChat(body, originalModel, clientRawRequest, request, comboName, apiKeyInfo, telemetry, { ...runtimeOptions, governorBypass: true }, comboStrategy, isCombo);
}

export { shouldTripProviderBreakerForResult } from "./chatPredicates";

async function handleChatImplementation(
  request: any,
  clientRawRequest: any = null,
  preParsedBody: any = null,
  correlationId: string | undefined,
  admissionContext: chatAdmission.ChatAdmissionContext
) {
  const peerRejection = rejectPeerRequest(request?.headers, log.warn, errorResponse);
  if (peerRejection) return peerRejection;
  const reqId = correlationId || generateRequestId();
  const telemetry = new RequestTelemetry(reqId);
  const backpressure = checkConnectionCapacity();
  if (backpressure.shouldReject) return backpressure.response;
  let body;
  try {
    telemetry.startPhase("parse");
    body = await resolveChatRequestBody(request, preParsedBody);
    telemetry.endPhase();
  } catch {
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid JSON body");
  }
  body = normalizeReasoningRequest(body);
  const sourceFormat = detectFormatFromUrl(body, request.url);
  const msgBody = body as { messages?: unknown; input?: unknown };
  if ("messages" in msgBody && !Array.isArray(msgBody.messages)) return errorResponse(HTTP_STATUS.BAD_REQUEST, "messages: Expected array");
  if (Array.isArray(msgBody.messages) && msgBody.messages.length === 0) return errorResponse(HTTP_STATUS.BAD_REQUEST, "messages: at least one message is required");
  if (!("messages" in msgBody) && !("input" in msgBody) && sourceFormat !== "antigravity") return errorResponse(HTTP_STATUS.BAD_REQUEST, "messages: Expected array, received undefined");
  const rawModel = (body as { model?: unknown }).model;
  if (rawModel !== undefined && rawModel !== null && typeof rawModel !== "string") return errorResponse(HTTP_STATUS.BAD_REQUEST, `model: Expected string, received ${Array.isArray(rawModel) ? "array" : typeof rawModel}`);
  {
    const b = body as { temperature?: unknown; top_p?: unknown; max_tokens?: unknown; n?: unknown };
    const badParam = (name: string, msg: string) => errorResponse(HTTP_STATUS.BAD_REQUEST, `${name}: ${msg}`);
    if (b.temperature !== undefined) {
      if (typeof b.temperature !== "number" || Number.isNaN(b.temperature)) return badParam("temperature", "must be a number");
      if (b.temperature < 0 || b.temperature > 2) return badParam("temperature", "must be between 0 and 2");
    }
    if (b.top_p !== undefined) {
      if (typeof b.top_p !== "number" || Number.isNaN(b.top_p)) return badParam("top_p", "must be a number");
      if (b.top_p < 0 || b.top_p > 1) return badParam("top_p", "must be between 0 and 1");
    }
    if (b.max_tokens !== undefined && (typeof b.max_tokens !== "number" || !Number.isInteger(b.max_tokens) || b.max_tokens < 1)) return badParam("max_tokens", "must be a positive integer");
    if (b.n !== undefined && (typeof b.n !== "number" || !Number.isInteger(b.n) || b.n < 1)) return badParam("n", "must be a positive integer");
  }
  const deferredClientRawBody = chatAdmission.captureDeferredClientRawBody(body);
  const acceptHeader = request.headers.get("accept") || "";
  if (acceptHeaderForcesStream(acceptHeader, body.stream)) body = { ...body, stream: true };
  const url = new URL(request.url);
  const noThinking = applyNoThinkingAlias(body, { claudeFormat: url.pathname.includes("/messages") });
  if (noThinking.applied) log.debug("NO_THINKING", `Resolved no-thinking alias → ${noThinking.realModel}`);
  let modelStr = resolveRoutingModel(request, body);
  if (typeof modelStr === "string") {
    const exactCombo = await getCombo(modelStr);
    if (!exactCombo) {
      modelStr = stripContextWindowSuffix(modelStr) || modelStr;
      if (body?.model !== modelStr) body = { ...body, model: modelStr };
    }
  }
  const ccAliasStrip = await resolveCcDiscoveryAliasStrip(modelStr);
  if (ccAliasStrip.stripped) modelStr = ccAliasStrip.model;
  const reasoningIntent = extractReasoningIntent(modelStr, body);
  body = RoutingModelOps.align(body, modelStr, log);
  const msgCount = body.messages?.length || body.input?.length || 0;
  const toolCount = body.tools?.length || 0;
  const effort = body.reasoning_effort || body.reasoning?.effort || null;
  log.request("POST", `${url.pathname} | ${modelStr} | ${msgCount} msgs${toolCount ? ` | ${toolCount} tools` : ""}${effort ? ` | effort=${effort}` : ""}`);
  const authHeader = request.headers.get("Authorization");
  const apiKey = extractApiKey(request);
  if (authHeader && apiKey) log.debug("AUTH", "API key provided");
  else log.debug("AUTH", "No API key provided (local mode)");
  const internalUsageCommandResponse = await handleInternalUsageCommand(request, body);
  if (internalUsageCommandResponse) {
    recordTelemetry(telemetry);
    return internalUsageCommandResponse;
  }
  const isComboLiveTest = request.headers?.get?.("x-internal-test") === "combo-health-check";
  if (!modelStr) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing model");
  const imageModel = getImageModelEntry(modelStr);
  const isExactStoredCombo = imageModel ? Boolean(await getComboByName(modelStr)) : false;
  const isChatCatalogModel = imageModel ? getModelsByProviderId(imageModel.provider).some((model) => model.id === imageModel.model) : false;
  if (imageModel && !isExactStoredCombo && !isChatCatalogModel) return errorResponse(HTTP_STATUS.BAD_REQUEST, `Model '${modelStr}' is an image-generation model and cannot be used on /v1/chat/completions. Use POST /v1/images/generations instead.`);
  const externalSessionId = extractExternalSessionId(request.headers);
  const sessionId = externalSessionId || generateStableSessionId(body);
  const sessionAffinityKey = extractSessionAffinityKey(body, request.headers) || sessionId;
  const requestedConnectionId = request.headers.get("x-omniroute-connection")?.trim() || null;
  if (sessionId) touchSession(sessionId);
  telemetry.startPhase("policy");
  const policy = await enforceApiKeyPolicy(request, modelStr);
  if (policy.rejection) return policy.rejection;
  const apiKeyInfo = policy.apiKeyInfo;
  const bypassProviderQuotaPolicy = hasProviderQuotaBypassScope(apiKeyInfo?.scopes);
  telemetry.endPhase();
  const admissionRejection = await admissionContext.acquire(apiKeyInfo?.id, request, body);
  if (admissionRejection) return admissionRejection;
  clientRawRequest = chatAdmission.resolveClientRawAfterAdmission(clientRawRequest, () => deferredClientRawBody.withClientBody((clientBody) => buildClientRawRequest(request, clientBody)));
  telemetry.startPhase("validate");
  const preCallGuardrails = await guardrailRegistry.runPreCallHooks(body, {
    apiKeyInfo: apiKeyInfo as any,
    disabledGuardrails: resolveDisabledGuardrails({ apiKeyInfo: (apiKeyInfo ?? null) as any, body, headers: request.headers }),
    endpoint: new URL(request.url).pathname,
    headers: request.headers,
    log,
    method: request.method,
    model: modelStr,
    stream: body?.stream === true,
  });
  if (preCallGuardrails.blocked) return errorResponse(HTTP_STATUS.BAD_REQUEST, preCallGuardrails.message || "Request rejected: suspicious content detected");
  const modelBeforeGuardrails = typeof body?.model === "string" && body.model.length > 0 ? body.model : modelStr;
  body = preCallGuardrails.payload;
  ({ body, modelStr } = await RoutingModelOps.reconcileGuardrailReroute({ body, modelBeforeGuardrails, modelStr, apiKey, apiKeyId: apiKeyInfo?.id, isModelAllowedForKey, log }));
  const modalityBridgeHeader = buildModalityBridgeHeader(preCallGuardrails.results);
  telemetry.endPhase();
  if (apiKeyInfo?.id && sessionId) {
    const maxSessions = typeof apiKeyInfo.maxSessions === "number" && apiKeyInfo.maxSessions > 0 ? apiKeyInfo.maxSessions : 0;
    if (maxSessions > 0 && !isSessionRegisteredForKey(apiKeyInfo.id, sessionId)) {
      const sessionViolation = checkSessionLimit(apiKeyInfo.id, maxSessions);
      if (sessionViolation) return withSessionHeader(errorResponse(HTTP_STATUS.RATE_LIMITED, sessionViolation.message), sessionId);
      registerKeySession(apiKeyInfo.id, sessionId);
    }
  }
  initPreRequestRegistry();
  const hookContext = createHookContext({ body: body as Record<string, unknown>, headers: Object.fromEntries(request?.headers?.entries() || []) as Record<string, string | string[] | undefined>, model: modelStr, combo: undefined, apiKeyInfo: apiKeyInfo as Record<string, unknown> | undefined, log });
  const { context: hookCtx, response: hookResponse } = await runHooks(hookContext);
  body = hookCtx.body as any;
  ({ body, modelStr } = RoutingModelOps.reconcileModelOverride({ body, modelStr, overrideModel: hookCtx.model, logTag: "Hook model override", log }));
  if (hookResponse) return errorResponse(hookResponse.status, hookResponse.body as any);
  let resolvedModelStr = modelStr;
  let taskRouteInfo: { taskType: string; wasRouted: boolean } | null = null;
  if (getTaskRoutingConfig().enabled) {
    telemetry.startPhase("task-route");
    const tr = applyTaskAwareRouting(modelStr, body);
    if (tr.wasRouted) {
      resolvedModelStr = tr.model;
      body = { ...body, model: tr.model };
    }
    taskRouteInfo = { taskType: tr.taskType, wasRouted: tr.wasRouted };
    telemetry.endPhase();
  }
  if (hasNativeWebSearchTool(body)) {
    const wsSettings = await getCachedSettings().catch(() => ({}) as Record<string, unknown>);
    const wsRoute = resolveWebSearchRouteOverride(resolvedModelStr, body, wsSettings);
    if (wsRoute.wasRouted) {
      resolvedModelStr = wsRoute.model;
      body = { ...body, model: wsRoute.model };
    }
  }
  let reasoningDecision: ReasoningRuleDecision | null = null;
  let requestRoutingTags: { tags: string[] } = { tags: [] };
  const reasoningRouting = await applyReasoningRouting({ request, body, modelStr: resolvedModelStr, policy, apiKeyInfo, reasoningIntent });
  if (reasoningRouting.response) return reasoningRouting.response;
  body = reasoningRouting.body;
  resolvedModelStr = reasoningRouting.modelStr;
  reasoningDecision = reasoningRouting.reasoningDecision;
  requestRoutingTags = reasoningRouting.requestRoutingTags;
  const autoRouting = await resolveAutoRoutingState(resolvedModelStr);
  if (autoRouting.response) return autoRouting.response;
  telemetry.startPhase("resolve");
  let combo: any = await getComboForModel(resolvedModelStr);
  if (reasoningDecision?.targetCombo) combo = reasoningDecision.targetCombo;
  if (!combo && resolvedModelStr.startsWith("auto/")) {
    const suffix = resolvedModelStr.slice(5);
    for (const candidate of [`auto/best-${suffix}`, `auto/${suffix}`]) {
      combo = await getComboForModel(candidate);
      if (combo) break;
    }
  }
  const virtualCombo = await createVirtualAutoCombo(autoRouting, combo, apiKeyInfo?.id);
  if (virtualCombo instanceof Response) return virtualCombo;
  combo = virtualCombo;
  if (combo) {
    if (reasoningDecision) {
      const filtered = filterReasoningCombo(combo, reasoningDecision);
      if (filtered instanceof Response) return filtered;
      combo = filtered;
    }
    const comboPreselectedCredentials = new Map<string, any>();
    const getComboCredentialCacheKey = (modelString: string, target?: { connectionId?: string | null; executionKey?: string | null }) => `${target?.executionKey || target?.connectionId || ""}:${modelString}`;
    const checkModelAvailable = async (modelString: string, target?: { allowRateLimitedConnection?: boolean; connectionId?: string | null; allowedConnectionIds?: string[] | null; executionKey?: string | null; providerId?: string | null }) => {
      if (isComboLiveTest) return true;
      const hasModelRestrictions = apiKeyInfo && (Boolean(apiKeyInfo.allowedModels?.length) || apiKeyInfo.disableNonPublicModels === true);
      if (hasModelRestrictions && apiKey && !(await isModelAllowedForKey(apiKey, modelString))) return false;
      const modelInfo = await getModelInfo(modelString);
      const provider = (() => {
        if (!target?.providerId) return modelInfo.provider;
        if (target.providerId === modelInfo.provider) return modelInfo.provider;
        if (modelString.startsWith(target.providerId + "/")) return modelInfo.provider;
        return target.providerId;
      })();
      if (!provider) return true;
      const resolvedModel = modelInfo.model || modelString;
      let allowedConnections = intersectAllowedConnectionIds(apiKeyInfo?.allowedConnections ?? null, target?.allowedConnectionIds ?? null);
      if (apiKeyInfo?.allowedQuotas && apiKeyInfo.allowedQuotas.length > 0) {
        const quotaScope = await resolveQuotaKeyScope(apiKeyInfo.allowedQuotas);
        allowedConnections = constrainConnectionsToQuota(allowedConnections ?? [], quotaScope.connectionIds);
      }
      if (Array.isArray(allowedConnections) && allowedConnections.length === 0) return false;
      const creds = await getProviderCredentialsWithQuotaPreflight(provider, null, allowedConnections, resolvedModel, {
        sessionKey: sessionAffinityKey,
        ...(target?.allowRateLimitedConnection ? { allowRateLimitedConnections: true } : {}),
        ...(target?.connectionId ? { forcedConnectionId: target.connectionId } : {}),
        ...(bypassProviderQuotaPolicy ? { bypassQuotaPolicy: true } : {}),
      });
      if (!creds || creds.allRateLimited) return false;
      comboPreselectedCredentials.set(getComboCredentialCacheKey(modelString, target), creds);
      return true;
    };
    const [settings, allCombos] = await Promise.all([getCachedSettings().catch(() => ({})), getCombosCachedForChat()]);
    const relayConfig = combo.strategy === "context-relay" ? resolveComboConfig(combo, settings) : null;
    const perRequestAutoControls = resolveRequestAutoControls(request.headers);
    const relayOptions = combo.strategy === "context-relay" || bypassProviderQuotaPolicy || Object.keys(perRequestAutoControls).length > 0 ? {
      ...(combo.strategy === "context-relay" ? { sessionId, config: relayConfig } : {}),
      ...(bypassProviderQuotaPolicy ? { bypassProviderQuotaPolicy: true } : {}),
      ...perRequestAutoControls,
    } : undefined;
    telemetry.endPhase();
    const response = await (handleComboChat as any)({
      body,
      combo,
      handleSingleModel: (b: any, m: string, target?: any) => handleSingleModelChat(b, m, clientRawRequest, request, combo.name, apiKeyInfo, telemetry, {
        sessionId,
        sessionAffinityKey,
        forceLiveComboTest: isComboLiveTest,
        forcedConnectionId: target?.connectionId ?? null,
        allowedConnectionIds: target?.allowedConnectionIds ?? null,
        comboStepId: target?.stepId || null,
        comboExecutionKey: target?.executionKey || target?.stepId || null,
        skipUpstreamRetry: target?.failoverBeforeRetry ?? false,
        allowRateLimitedConnection: target?.allowRateLimitedConnection === true,
        preselectedCredentials: comboPreselectedCredentials.get(getComboCredentialCacheKey(m, target)),
        cachedSettings: settings,
        providerId: target?.providerId ?? null,
        correlationId: reqId,
        modelPinned: target?.modelPinned ?? false,
        reasoningDecision,
        reasoningIntent,
        reasoningRequestTags: requestRoutingTags.tags,
        modelAbortSignal: target?.modelAbortSignal ?? null,
      }, target?.effectiveComboStrategy ?? combo.strategy, true).then(async (res: Response) => {
        if (res?.ok) await promoteSuccessfulComboModel(combo, m, settings as Record<string, unknown>, comboPromoteDeps);
        return res;
      }),
      isModelAvailable: checkModelAvailable,
      log,
      settings,
      allCombos,
      apiKeyAllowedConnections: apiKeyInfo?.allowedConnections ?? null,
      relayOptions,
      signal: request?.signal ?? null,
      correlationId: reqId,
    });
    recordTelemetry(telemetry);
    return withModalityBridgeHeader(withCorrelationId(withSessionHeader(response, sessionId), reqId), modalityBridgeHeader);
  }
  telemetry.endPhase();
  let routingComboId: string | null = null;
  if (!combo) {
    const providerPrefix = resolvedModelStr.split("/")[0];
    if (providerPrefix) {
      try {
        const routingCombo = await getComboByName(providerPrefix);
        if (routingCombo?.id) routingComboId = routingCombo.id;
      } catch {}
    }
  }
  const response = await dispatchGovernedSingleModel(body, resolvedModelStr, clientRawRequest, request, null, apiKeyInfo, telemetry, {
    sessionId,
    sessionAffinityKey,
    forceLiveComboTest: isComboLiveTest,
    forcedConnectionId: requestedConnectionId,
    allowedConnectionIds: apiKeyInfo?.allowedConnections ?? null,
    correlationId: reqId,
    routingComboId,
    reasoningDecision,
    reasoningIntent,
    reasoningRequestTags: requestRoutingTags.tags,
  }, null, false);
  if (!response.headers.get("content-type")?.includes("text/event-stream")) {
    updateGovernorTelemetryOutcome(reqId, {
      actualProvider: resolvedModelStr.split("/")[0] || null,
      actualModel: resolvedModelStr,
      success: response.ok,
      errorCategory: response.ok ? undefined : `http_${response.status}`,
    });
  }
  recordTelemetry(telemetry);
  return withModalityBridgeHeader(withCorrelationId(withSessionHeader(response, sessionId), reqId), modalityBridgeHeader);
}

export const handleChat = chatAdmission.withChatAdmission(handleChatImplementation);

async function handleSingleModelChat(
  body: any,
  modelStr: string,
  clientRawRequest: any = null,
  request: any = null,
  comboName: string | null = null,
  apiKeyInfo: any = null,
  telemetry: any = null,
  runtimeOptions: {
    governorBypass?: boolean;
    emergencyFallbackTried?: boolean;
    forceLiveComboTest?: boolean;
    sessionId?: string | null;
    sessionAffinityKey?: string | null;
    forcedConnectionId?: string | null;
    allowedConnectionIds?: string[] | null;
    comboStepId?: string | null;
    comboExecutionKey?: string | null;
    skipUpstreamRetry?: boolean;
    allowRateLimitedConnection?: boolean;
    preselectedCredentials?: any;
    cachedSettings?: any;
    providerId?: string | null;
    correlationId?: string | null;
    routingComboId?: string | null;
    modelPinned?: boolean;
    reasoningDecision?: ReasoningRuleDecision | null;
    reasoningIntent?: ExtractedReasoningIntent | null;
    reasoningRequestTags?: string[];
    modelAbortSignal?: AbortSignal | null;
  } = {},
  comboStrategy: string | null = null,
  isCombo: boolean = false
) {
  const resolved = await resolveModelOrError(modelStr, body, clientRawRequest?.endpoint, clientRawRequest?.headers);
  if (resolved.error) return resolved.error;
  if ((resolved as any).combo) {
    const redirectCombo = (resolved as any).combo;
    return handleComboChat({
      body,
      combo: redirectCombo,
      handleSingleModel: (b: any, m: string, target?: any) => handleSingleModelChat(b, m, clientRawRequest, request, redirectCombo.name ?? modelStr, apiKeyInfo, telemetry, {
        sessionId: "",
        forceLiveComboTest: false,
        forcedConnectionId: null,
        allowedConnectionIds: null,
        comboStepId: null,
        comboExecutionKey: null,
        skipUpstreamRetry: target?.failoverBeforeRetry ?? false,
        allowRateLimitedConnection: target?.allowRateLimitedConnection === true,
        providerId: target?.providerId ?? null,
        correlationId: runtimeOptions?.correlationId ?? null,
        modelAbortSignal: target?.modelAbortSignal ?? null,
      }, target?.effectiveComboStrategy ?? redirectCombo.strategy ?? "priority", false),
      isModelAvailable: async () => true,
      log,
      settings: {},
      allCombos: [],
      relayOptions: undefined,
      signal: request?.signal ?? null,
      correlationId: runtimeOptions?.correlationId ?? null,
    });
  }
  const { provider: resolvedProvider, model, sourceFormat, targetFormat, extendedContext, apiFormat } = resolved;
  const provider = (() => {
    if (!runtimeOptions.providerId) return resolvedProvider;
    if (runtimeOptions.providerId === resolvedProvider) return resolvedProvider;
    if (modelStr.startsWith(runtimeOptions.providerId + "/")) return resolvedProvider;
    return runtimeOptions.providerId;
  })();
  const forceLiveComboTest = runtimeOptions.forceLiveComboTest === true;
  const bypassProviderQuotaPolicy = hasProviderQuotaBypassScope(apiKeyInfo?.scopes);
  const hasForcedConnection = typeof runtimeOptions.forcedConnectionId === "string" && runtimeOptions.forcedConnectionId.trim().length > 0;
  let effectiveAllowedConnections = intersectAllowedConnectionIds(apiKeyInfo?.allowedConnections ?? null, runtimeOptions.allowedConnectionIds ?? null);
  if (apiKeyInfo?.allowedQuotas && apiKeyInfo.allowedQuotas.length > 0) {
    const quotaScope = await resolveQuotaKeyScope(apiKeyInfo.allowedQuotas);
    effectiveAllowedConnections = constrainConnectionsToQuota(effectiveAllowedConnections ?? [], quotaScope.connectionIds);
  }
  if (
    runtimeOptions.preselectedCredentials?.connectionId &&
    ((Array.isArray(effectiveAllowedConnections) && !effectiveAllowedConnections.includes(runtimeOptions.preselectedCredentials.connectionId)) ||
      (hasForcedConnection && runtimeOptions.preselectedCredentials.connectionId !== runtimeOptions.forcedConnectionId))
  ) {
    log.warn("GOVERNOR", "Ignoring preselected credentials that violate connection routing constraints");
    runtimeOptions = { ...runtimeOptions, preselectedCredentials: null };
  }
  const bypassReason = forceLiveComboTest ? "combo live test" : hasForcedConnection ? "fixed combo step connection" : undefined;
  const pressureGuard = checkResourcePressureBeforeProviderWork();
  if (pressureGuard) return pressureGuard.response;
  const providerProfile = await getRuntimeProviderProfile(provider);
  const gate = await checkPipelineGates(provider, model, {
    ignoreCircuitBreaker: forceLiveComboTest || hasForcedConnection,
    ignoreModelCooldown: forceLiveComboTest || hasForcedConnection,
    providerProfile,
    ...(bypassReason ? { bypassReason } : {}),
  });
  if (gate) return gate;
  const useHints429 = resolveUseUpstream429BreakerHints(provider, (providerProfile as { useUpstream429BreakerHints?: boolean }).useUpstream429BreakerHints);
  const breaker = getCircuitBreaker(provider, {
    failureThreshold: providerProfile.failureThreshold,
    resetTimeout: providerProfile.resetTimeoutMs,
    isFailure: (e) => !isLocalStreamLifecycleError(e),
    onStateChange: (name: string, from: string, to: string) => log.info("CIRCUIT", `${name}: ${from} → ${to}`),
    ...(useHints429 ? { cooldownByKind: { rate_limit: 60_000, quota_exhausted: 3_600_000 } satisfies Partial<Record<FailureKind, number>>, classifyError: classify429FromError } : {}),
  });
  const userAgent = request?.headers?.get("user-agent") || "";
  const baseRetrySettings = resolveCooldownAwareRetrySettings(runtimeOptions.cachedSettings ?? (await getCachedSettings().catch(() => ({}))));
  const retrySettings = disableCooldownAwareRetry(baseRetrySettings, provider === "claude-web" || isCombo || forceLiveComboTest || runtimeOptions.emergencyFallbackTried === true);
  const requestSignal = request?.signal ?? null;
  let requestRetryBudgetLeftMs = retrySettings.budgetMs;
  if (Array.isArray(effectiveAllowedConnections) && effectiveAllowedConnections.length === 0) return errorResponse(HTTP_STATUS.SERVICE_UNAVAILABLE, "No eligible connections matched the requested routing constraints");
  let requestRetryAttempt = 0;
  let requestRetryLastError = null;
  let requestRetryLastStatus = null;
  let requestRetryLastCooldownMs = 0;
  let streamEarlyEofRetries = 0;
  requestAttemptLoop: while (true) {
    const excludedConnectionIds = new Set<string>();
    let lastError = requestRetryLastError;
    let lastStatus = requestRetryLastStatus;
    let lastCooldownMs = requestRetryLastCooldownMs;
    let preselectedCredentials = runtimeOptions.preselectedCredentials;
    while (true) {
      const credentials = preselectedCredentials && excludedConnectionIds.size === 0 ? preselectedCredentials : await getProviderCredentialsWithQuotaPreflight(provider, null, effectiveAllowedConnections, model, {
        sessionKey: runtimeOptions.sessionAffinityKey ?? runtimeOptions.sessionId ?? null,
        excludeConnectionIds: Array.from(excludedConnectionIds),
        ...(runtimeOptions.allowRateLimitedConnection ? { allowRateLimitedConnections: true } : {}),
        ...(forceLiveComboTest ? { allowSuppressedConnections: true, bypassQuotaPolicy: true } : {}),
        ...(!forceLiveComboTest && bypassProviderQuotaPolicy ? { bypassQuotaPolicy: true } : {}),
        ...(runtimeOptions.forcedConnectionId ? { forcedConnectionId: runtimeOptions.forcedConnectionId } : {}),
      });
      preselectedCredentials = null;
      if (!credentials || "allRateLimited" in credentials || "allExpired" in credentials || !credentials.connectionId) {
        if (credentials?.allRateLimited) {
          const retryDecision = getCooldownAwareRetryDecision({ retryAfter: credentials.retryAfter, settings: retrySettings, attempt: requestRetryAttempt, budgetLeftMs: requestRetryBudgetLeftMs });
          if (retryDecision.shouldRetry) {
            const completed = await waitForCooldownAwareRetry(retryDecision.waitMs, requestSignal);
            if (!completed) return errorResponse(499, "Request aborted");
            requestRetryAttempt += 1;
            requestRetryBudgetLeftMs = Math.max(0, requestRetryBudgetLeftMs - retryDecision.waitMs);
            continue requestAttemptLoop;
          }
        }
        return handleNoCredentials(credentials, excludedConnectionIds.size > 0 ? Array.from(excludedConnectionIds)[0] : null, provider, model, lastError, lastStatus, resolved.candidateAliases);
      }
      const accountId = credentials.connectionId.slice(0, 8);
      const effectiveModel = resolveBareModelToConnectionDefault(modelStr, model, credentials.defaultModel) ?? model;
      let requestBody = effectiveModel !== model ? { ...body, model: `${provider}/${effectiveModel}` } : body;
      if (!runtimeOptions.reasoningDecision && runtimeOptions.reasoningIntent) {
        const connectionRouting = await applyConnectionReasoningRule({ requestBody, provider, effectiveModel, credentials, apiKeyInfo, reasoningIntent: runtimeOptions.reasoningIntent, reasoningDecision: runtimeOptions.reasoningDecision, requestRoutingTags: runtimeOptions.reasoningRequestTags });
        if (connectionRouting.response) return connectionRouting.response;
        requestBody = connectionRouting.body;
      }
      let injectedHandoff = null;
      if (comboStrategy === "context-relay" && comboName && runtimeOptions.sessionId && body?._omnirouteSkipContextRelay !== true) {
        const handoff = getHandoff(runtimeOptions.sessionId, comboName);
        if (handoff && handoff.fromAccount !== credentials.connectionId) {
          requestBody = injectHandoffIntoBody(requestBody, handoff);
          injectedHandoff = handoff;
        }
      }
      const refreshedCredentials = await checkAndRefreshToken(provider, credentials);
      const storeEnabled = isOpenAIResponsesStoreEnabled(refreshedCredentials?.providerSpecificData ?? credentials?.providerSpecificData);
      if (provider === "codex" && storeEnabled && runtimeOptions.sessionId) requestBody = ensureOpenAIStoreSessionFallback(requestBody, runtimeOptions.sessionId);
      if (provider === "codex" && refreshedCredentials?.accessToken && credentials.connectionId) {
        const workspaceId = typeof refreshedCredentials?.providerSpecificData?.workspaceId === "string" && refreshedCredentials.providerSpecificData.workspaceId.trim().length > 0 ? refreshedCredentials.providerSpecificData.workspaceId : typeof credentials?.providerSpecificData?.workspaceId === "string" && credentials.providerSpecificData.workspaceId.trim().length > 0 ? credentials.providerSpecificData.workspaceId : undefined;
        registerCodexConnection(credentials.connectionId, { accessToken: refreshedCredentials.accessToken, ...(workspaceId ? { workspaceId } : {}) });
      }
      if (runtimeOptions.sessionId && body?._omnirouteInternalRequest !== "context-handoff") {
        touchSession(runtimeOptions.sessionId, credentials.connectionId);
        startQuotaMonitor(runtimeOptions.sessionId, provider, credentials.connectionId, refreshedCredentials);
      }
      const proxyInfo = await safeResolveProxy(credentials.connectionId, apiKeyInfo?.id, provider);
      const appliedProxySink: { proxy: unknown } = { proxy: null };
      const proxyStartTime = Date.now();
      if (telemetry) telemetry.startPhase("connect");
      const dispatchClientRawRequest = resolveDispatchClientRawRequest(clientRawRequest, runtimeOptions.modelAbortSignal);
      const execution = await executeChatWithBreaker({
        bypassCircuitBreaker: forceLiveComboTest || hasForcedConnection,
        breaker,
        body: requestBody,
        provider,
        model: effectiveModel,
        refreshedCredentials,
        proxyInfo,
        appliedProxySink,
        log,
        clientRawRequest: dispatchClientRawRequest,
        credentials,
        apiKeyInfo,
        userAgent,
        comboName,
        comboStrategy,
        isCombo,
        comboStepId: runtimeOptions.comboStepId ?? null,
        comboExecutionKey: runtimeOptions.comboExecutionKey ?? runtimeOptions.comboStepId ?? null,
        extendedContext,
        modelApiFormat: apiFormat,
        modelTargetFormat: targetFormat,
        providerProfile,
        cachedSettings: runtimeOptions.cachedSettings,
        skipUpstreamRetry: runtimeOptions.skipUpstreamRetry ?? false,
        correlationId: runtimeOptions?.correlationId ?? null,
        modelPinned: runtimeOptions?.modelPinned ?? false,
        routingComboId: runtimeOptions?.routingComboId ?? null,
      });
      if (telemetry) telemetry.endPhase();
      if ("localResourcePressureResult" in execution) return execution.localResourcePressureResult.response;
      const { result, tlsFingerprintUsed } = execution;
      const proxyLatency = Date.now() - proxyStartTime;
      const providerAlias = PROVIDER_ID_TO_ALIAS[provider] || provider;
      const effectiveTargetFormat = getModelTargetFormat(providerAlias, model) || getTargetFormat(provider, credentials.providerSpecificData) || targetFormat;
      void safeLogEvents({ result, proxyInfo: applyExecutorProxyToInfo(proxyInfo, appliedProxySink.proxy), proxyLatency, provider, model, sourceFormat, targetFormat: effectiveTargetFormat, credentials, comboName, clientRawRequest, tlsFingerprintUsed });
      if (result.success) {
        clearModelLock(provider, credentials.connectionId, model);
        if (!forceLiveComboTest) breaker._onSuccess();
        if (injectedHandoff && runtimeOptions.sessionId && comboName) deleteHandoff(runtimeOptions.sessionId, comboName);
        return result.response;
      }
      if (isAntigravityMissingProjectError(provider, result)) return withSelectedConnectionHeader(result.response, credentials.connectionId);
      const isAntigravityStreamReadinessFailure = provider === "antigravity" && (result.errorCode === "STREAM_READINESS_TIMEOUT" || result.errorCode === "STREAM_EARLY_EOF" || result.errorType === "stream_timeout" || result.errorType === "stream_early_eof");
      if ((result.errorType === "stream_timeout" || result.errorType === "stream_early_eof") && !isAntigravityStreamReadinessFailure) {
        if (shouldRetryStreamEarlyEof(result.errorCode, streamEarlyEofRetries) && !hasForcedConnection) {
          streamEarlyEofRetries += 1;
          continue;
        }
        return withSelectedConnectionHeader(result.response, credentials?.connectionId);
      }
      if (isAntigravityStreamReadinessFailure) {
        const classificationError = resolveStreamReadinessClassificationError(result);
        const { shouldFallback, cooldownMs } = await markAccountUnavailable(credentials.connectionId, result.status || HTTP_STATUS.BAD_GATEWAY, classificationError, provider, model, providerProfile, { isCombo });
        if (shouldFallback && !hasForcedConnection) {
          if (Number.isFinite(cooldownMs) && cooldownMs > 0) {
            lastCooldownMs = cooldownMs;
            requestRetryLastCooldownMs = cooldownMs;
          }
          excludedConnectionIds.add(credentials.connectionId);
          lastError = classificationError;
          lastStatus = result.status;
          requestRetryLastError = classificationError;
          requestRetryLastStatus = result.status;
          continue;
        }
        return withSelectedConnectionHeader(result.response, credentials?.connectionId);
      }
      const isAntigravityPreResponseTimeout = provider === "antigravity" && result.status === HTTP_STATUS.GATEWAY_TIMEOUT && (result.errorType === "upstream_timeout" || result.errorCode === ANTIGRAVITY_PRE_RESPONSE_TIMEOUT_CODE);
      if (isAntigravityPreResponseTimeout) return withSelectedConnectionHeader(result.response, credentials?.connectionId);
      if (result.errorType === "account_semaphore_capacity") {
        if (hasForcedConnection) return withSelectedConnectionHeader(result.response, credentials?.connectionId);
        excludedConnectionIds.add(credentials.connectionId);
        lastError = result.error;
        lastStatus = result.status;
        requestRetryLastError = result.error;
        requestRetryLastStatus = result.status;
        continue;
      }
      if (!runtimeOptions.emergencyFallbackTried && !comboName) {
        const fallbackDecision = shouldUseFallback(Number(result.status || 0), String(result.error || ""), Array.isArray(body?.tools) && body.tools.length > 0);
        if (isFallbackDecision(fallbackDecision)) {
          const fallbackModelStr = `${fallbackDecision.provider}/${fallbackDecision.model}`;
          const currentModelStr = `${provider}/${model}`;
          if (fallbackModelStr !== currentModelStr) {
            const fallbackBody = { ...body, model: fallbackModelStr };
            const maxTokens = Math.min(Number(fallbackBody.max_tokens ?? fallbackBody.max_completion_tokens ?? fallbackDecision.maxOutputTokens) || fallbackDecision.maxOutputTokens, fallbackDecision.maxOutputTokens);
            fallbackBody.max_tokens = maxTokens;
            fallbackBody.max_completion_tokens = maxTokens;
            const fallbackResponse = await handleSingleModelChat(fallbackBody, fallbackModelStr, clientRawRequest, request, comboName, apiKeyInfo, telemetry, { ...runtimeOptions, emergencyFallbackTried: true, forcedConnectionId: null, comboStepId: null, comboExecutionKey: null }, null, Boolean(comboName));
            if (fallbackResponse.ok) return fallbackResponse;
          }
        }
      }
      let dailyQuotaExhausted = false;
      const errorStr = String(result.rawMessage ?? result.error ?? "");
      const failureKind = result.status === 429 ? isSubscriptionQuotaText(errorStr.toLowerCase(), provider) ? "quota_exhausted" : classify429FromError({ status: result.status, message: errorStr }) : undefined;
      if (result.status === 429 && isDailyQuotaExhausted(errorStr)) {
        const match = errorStr.match(/today's quota for model ([^,]+)/);
        const limitedModel = match ? match[1].trim() : model;
        const mlSettings = resolveModelLockoutSettings(runtimeOptions.cachedSettings);
        if (mlSettings.enabled && mlSettings.errorCodes.includes(result.status)) recordModelLockoutFailure(provider, credentials.connectionId, limitedModel, "quota_exhausted", result.status, 0, providerProfile, { maxCooldownMs: mlSettings.maxCooldownMs, scope: provider === "antigravity" ? "exact" : undefined });
        dailyQuotaExhausted = true;
      }
      if (!dailyQuotaExhausted) {
        const passthroughModels = credentials.providerSpecificData?.passthroughModels;
        if (result.status === 429 && shouldMarkAccountExhaustedFrom429(provider, model, passthroughModels, failureKind)) markAccountExhaustedFrom429(credentials.connectionId, provider);
      }
      const hasExtraKeys = ((credentials.providerSpecificData?.extraApiKeys as string[] | undefined) ?? []).length > 0 || connectionHasExtraKeys(credentials.connectionId);
      const skipConnectionDisable = shouldSkipConnDisable(result, result.status === 401, hasExtraKeys, provider);
      const { shouldFallback, cooldownMs } = skipConnectionDisable ? { shouldFallback: false, cooldownMs: 0 } : await markAccountUnavailable(credentials.connectionId, result.status, errorStr, provider, model, providerProfile, { persistUnavailableState: !(isCombo && result.status === 429 && (failureKind === "rate_limit" || failureKind === "transient")), isCombo });
      if (shouldFallback) {
        if (Number.isFinite(cooldownMs) && cooldownMs > 0) {
          lastCooldownMs = cooldownMs;
          requestRetryLastCooldownMs = cooldownMs;
        }
        if (runtimeOptions.sessionAffinityKey) {
          try { evictSessionAccountAffinityForConnection(runtimeOptions.sessionAffinityKey, provider, credentials.connectionId); } catch {}
        }
        excludedConnectionIds.add(credentials.connectionId);
        lastError = result.error;
        lastStatus = result.status;
        requestRetryLastError = result.error;
        requestRetryLastStatus = result.status;
        continue;
      }
      if (shouldTripProviderBreakerForResult(result, isCombo, forceLiveComboTest)) breaker._onFailure();
      return withSelectedConnectionHeader(result.response, credentials?.connectionId);
    }
  }
}
