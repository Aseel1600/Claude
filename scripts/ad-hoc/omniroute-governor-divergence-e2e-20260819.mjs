import { randomUUID } from "node:crypto";

import { queryGovernorTelemetryRows } from "../../src/lib/db/governorTelemetry.ts";
import { getCachedProviderConnections } from "../../src/lib/db/readCache.ts";
import { getResolvedModelCapabilities } from "../../src/lib/modelCapabilities.ts";
import { getCircuitBreaker } from "../../src/shared/utils/circuitBreaker.ts";
import { applyGovernorToAutoComboOrder } from "../../open-sse/governor/autoComboRuntime.ts";
import { resolveGovernorPricingEvidence } from "../../open-sse/governor/autoComboRuntime.ts";
import { estimateFinalInputTokens } from "../../open-sse/handlers/chatCore/contextEstimation.ts";
import { buildAutoCandidates } from "../../open-sse/services/combo.ts";
import { scoreAutoTargets } from "../../open-sse/services/combo/autoStrategy.ts";
import { DEFAULT_WEIGHTS } from "../../open-sse/services/autoCombo/scoring.ts";
import { createVirtualAutoCombo } from "../../open-sse/services/autoCombo/virtualFactory.ts";
import { parseModel } from "../../open-sse/services/model.ts";
import { classifyTier } from "../../open-sse/services/tierResolver.ts";
import {
  consumeSseText,
  createSseState,
  evaluateQuality,
  flushSseText,
  isStreamComplete,
} from "./omniroute-shadow-benchmark-core.mjs";

const BASE_URL = process.env.OMNIROUTE_BASE_URL || "http://127.0.0.1:20128";
const REQUEST_TIMEOUT_MS = Math.max(
  30_000,
  Number(process.env.SHADOW_REQUEST_TIMEOUT_MS || 600_000)
);
const MAX_TOKENS = 128;
const MAX_OUTPUT_CAPTURE = 8_192;
const poolOnly = process.argv.includes("--pool-only");
const workloadOnly = process.argv.includes("--workload-only");
const e2eOnly = process.argv.includes("--e2e-only");
const directOnly = process.argv.includes("--direct-only");
const replayOnly = process.argv.includes("--replay-only");
const e2eReplayOnly = process.argv.includes("--e2e-replay");
const requestedPairs = Number(
  process.argv.find((arg) => arg.startsWith("--pairs="))?.split("=")[1] || 10
);

/** Fixed before any request. Do not edit this list based on observed choices. */
export const DIVERGENCE_WORKLOAD = [
  {
    id: "simple-fast",
    category: "SIMPLE_FAST",
    prompt: "Reply with exactly DIVERGENCE-SIMPLE-OK and nothing else.",
    expected: "DIVERGENCE-SIMPLE-OK",
  },
  {
    id: "structured-json",
    category: "STRUCTURED_JSON",
    prompt: 'Return only this JSON object: {"status":"ok","value":17}',
    expectedJson: { status: "ok", value: 17 },
    quality: "json",
  },
  {
    id: "code-generation",
    category: "CODE_GENERATION",
    prompt:
      "Return exactly this JavaScript function and nothing else: function add(a, b) { return a + b; }",
    expectedOutput: "function add(a, b) { return a + b; }",
    quality: "code",
  },
  {
    id: "code-reasoning",
    category: "CODE_REASONING",
    prompt: "What does this print? Reply with exactly 8 and nothing else: let x = 3; x += 5;",
    expected: "8",
  },
  {
    id: "long-context",
    category: "LONG_CONTEXT",
    prompt: `Read the fixed context below and reply with exactly LONG-CONTEXT-OK and nothing else.\n${"context-marker-20260819 ".repeat(
      300
    )}`,
    expected: "LONG-CONTEXT-OK",
  },
  {
    id: "portuguese",
    category: "PORTUGUESE",
    prompt: "Responda exatamente com DIVERGENCIA-PT-OK e nada mais.",
    expected: "DIVERGENCIA-PT-OK",
  },
  {
    id: "english",
    category: "ENGLISH",
    prompt: "Output exactly DIVERGENCE-EN-OK and no other text.",
    expected: "DIVERGENCE-EN-OK",
  },
  {
    id: "extraction",
    category: "EXTRACTION",
    prompt:
      "Extract the value of ticket from this text and reply with exactly T-2048: owner=omniroute; ticket=T-2048; priority=high",
    expected: "T-2048",
  },
  {
    id: "classification",
    category: "CLASSIFICATION",
    prompt: "Classify the word 'oak' as plant or animal. Reply with exactly plant.",
    expected: "plant",
  },
  {
    id: "reasoning",
    category: "REASONING",
    prompt: "A box has 4 rows of 6 items. Reply with exactly 24 and nothing else.",
    expected: "24",
  },
  {
    id: "format-strict",
    category: "FORMAT_STRICT",
    prompt: "Reply with exactly [STRICT|20260819] including brackets and the pipe.",
    expected: "[STRICT|20260819]",
  },
  {
    id: "low-cost-candidate",
    category: "LOW_COST_CANDIDATE_SCENARIO",
    prompt: "For this light request, reply with exactly LOW-COST-OK and nothing else.",
    expected: "LOW-COST-OK",
  },
];

function finite(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function header(response, name) {
  return response.headers.get(name) || response.headers.get(name.toLowerCase()) || null;
}

function targetKey(provider, model) {
  return `${provider}/${model}`;
}

function normalizeTarget(provider, model) {
  const parsed = parseModel(`${provider}/${model}`);
  return targetKey(provider || parsed.provider || "unknown", parsed.model || model);
}

function targetFromResolved(target) {
  const parsed = parseModel(target.modelStr);
  return {
    provider: target.provider || parsed.provider || "unknown",
    model: parsed.model || target.modelStr,
    key: normalizeTarget(
      target.provider || parsed.provider || "unknown",
      parsed.model || target.modelStr
    ),
    modelStr: target.modelStr,
  };
}

function safePlan(row) {
  const plan = row?.counterfactualPlan;
  if (!plan) return null;
  return {
    governorMode: row.governorMode || null,
    selectedProvider: plan.selectedProvider || null,
    selectedModel: plan.selectedModel || null,
    resolvedModelTier: plan.resolvedModelTier || null,
    estimatedCurrentCost: plan.estimatedCurrentCost ?? null,
    estimatedCounterfactualCost: plan.estimatedCounterfactualCost ?? null,
    costEstimateBasis: plan.costEstimateBasis || null,
    estimatedSavings: plan.estimatedSavings ?? null,
    confidence: plan.confidence || null,
    executable: plan.executable === true,
    unresolvedFields: Array.isArray(plan.unresolvedFields) ? plan.unresolvedFields : [],
    guardrails: plan.guardrailResults || {},
    reasons: Array.isArray(plan.reasons) ? plan.reasons : [],
    recommendationTier: row.recommendation?.modelPolicy?.recommendedTier || null,
    routingStrategy: row.recommendation?.routingPolicy?.strategy || null,
    actualProvider: row.actualProvider || null,
    actualModel: row.actualModel || null,
    decisionLatencyMs: finite(row.decisionLatencyMs),
  };
}

async function readGovernorPlan(correlationId) {
  if (!correlationId) return null;
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const row = queryGovernorTelemetryRows(300).find(
      (entry) => entry.correlationId === correlationId && entry.counterfactualPlan
    );
    const plan = safePlan(row);
    if (plan) return plan;
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  return null;
}

async function readStreamingBody(response, input, started) {
  const state = createSseState();
  if (!response.body) return state;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      const now = performance.now();
      state.firstByteAt ??= now;
      buffer = consumeSseText(buffer, decoder.decode(value, { stream: true }), state, now);
    }
    buffer += decoder.decode();
    flushSseText(buffer, state, performance.now());
    state.readerCompleted = true;
  } finally {
    state.connectionClosedAt = performance.now();
    reader.releaseLock();
  }
  state.quality = evaluateQuality(input, state.content, {
    outputCaptureLimit: MAX_OUTPUT_CAPTURE,
  });
  state.qualityPass = state.quality.pass === true;
  state.completionMs = Math.round(state.connectionClosedAt - started);
  state.firstByteMs = state.firstByteAt ? Math.round(state.firstByteAt - started) : null;
  state.firstContentMs = state.firstContentAt ? Math.round(state.firstContentAt - started) : null;
  state.doneMs = state.doneAt ? Math.round(state.doneAt - started) : null;
  return state;
}

export async function request(model, input, armLabel) {
  const started = performance.now();
  const requestCorrelationId = `divergence-${input.id}-${armLabel}-${randomUUID()}`;
  let response = null;
  try {
    response = await fetch(`${BASE_URL}/api/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "text/event-stream",
        "X-OmniRoute-No-Cache": "true",
        "X-Correlation-Id": requestCorrelationId,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: input.prompt }],
        stream: true,
        temperature: 0,
        max_tokens: MAX_TOKENS,
      }),
    });
    const headersAt = performance.now();
    const stream = await readStreamingBody(response, input, started);
    const responseCorrelationId = header(response, "x-correlation-id");
    const streamCompleted = isStreamComplete(response.status, stream);
    const quality = stream.quality || evaluateQuality(input, stream.content);
    return {
      status: response.status,
      completionMs: stream.completionMs ?? Math.round(performance.now() - started),
      latencyMs: Math.round(performance.now() - started),
      headersAtMs: Math.round(headersAt - started),
      firstByteMs: stream.firstByteMs,
      firstContentMs: stream.firstContentMs,
      doneMs: stream.doneMs,
      streamCompleted,
      streamEventCount: stream.eventCount,
      responseModel: stream.responseModel,
      usage: stream.usage,
      actualOutput: quality.actualOutput,
      outputLength: quality.outputLength,
      outputTruncated: quality.outputTruncated,
      qualityValidator: quality.validator,
      qualityReason: quality.reason,
      qualityPass: streamCompleted && quality.pass === true,
      failureClass: streamCompleted
        ? null
        : response.status === 200
          ? "INCOMPLETE_STREAM"
          : "HTTP_ERROR",
      errorCode: stream.errorCode || stream.parseError,
      requestCorrelationId,
      responseCorrelationId,
      correlationId: responseCorrelationId || requestCorrelationId,
      requestId: header(response, "x-request-id") || header(response, "x-omniroute-request-id"),
      fallbackAttempts: Number(header(response, "x-omniroute-fallback-attempts")) || 0,
      model,
      armLabel,
      category: input.category,
    };
  } catch (error) {
    const name = error instanceof Error ? error.name : "TRANSPORT_ERROR";
    return {
      status: 0,
      completionMs: null,
      latencyMs: Math.round(performance.now() - started),
      headersAtMs: null,
      firstByteMs: null,
      firstContentMs: null,
      doneMs: null,
      streamCompleted: false,
      streamEventCount: 0,
      responseModel: null,
      usage: null,
      actualOutput: "",
      outputLength: 0,
      outputTruncated: false,
      qualityValidator: input.quality || "exact",
      qualityReason: "transport_error",
      qualityPass: false,
      failureClass:
        name === "TimeoutError" || name === "AbortError" ? "HARNESS_TIMEOUT" : "TRANSPORT_ERROR",
      errorCode: name,
      requestCorrelationId,
      responseCorrelationId: null,
      correlationId: requestCorrelationId,
      requestId: null,
      fallbackAttempts: null,
      model,
      armLabel,
      category: input.category,
    };
  }
}

function modelForTarget(pool, provider, model) {
  const key = normalizeTarget(provider, model);
  const target = pool.targets.find((item) => targetFromResolved(item).key === key);
  return target?.modelStr || `${provider}/${model}`;
}

function candidateKey(candidate) {
  return normalizeTarget(candidate.provider, candidate.model);
}

function candidateDetails(pool, provider, model) {
  const key = normalizeTarget(provider, model);
  const candidate = pool.candidates.find((item) => candidateKey(item) === key);
  const score = pool.scored.find((item) => targetFromResolved(item.target).key === key);
  return {
    score: finite(score?.score),
    factors: score?.factors || null,
    health: finite(
      candidate?.reliabilityObserved === false
        ? null
        : candidate?.failureRate != null
          ? 1 - candidate.failureRate
          : candidate?.errorRate != null
            ? 1 - candidate.errorRate
            : null
    ),
    reliabilityObserved: candidate?.reliabilityObserved ?? null,
    errorRate: finite(candidate?.errorRate),
    failureRate: finite(candidate?.failureRate),
    circuitBreakerState: candidate?.circuitBreakerState || null,
    statusPenalty: candidate?.statusPenalty === true,
    quotaCutoffBlocked: candidate?.quotaCutoffBlocked === true,
    latencyMs: finite(candidate?.p95LatencyMs),
  };
}

async function buildPool() {
  const virtualCombo = await createVirtualAutoCombo(undefined);
  const targets = virtualCombo.models.map((item) => ({
    kind: "model",
    stepId: item.id,
    executionKey: item.id,
    modelStr: item.model,
    provider: item.providerId,
    providerId: item.providerId,
    connectionId: item.connectionId,
    allowedConnectionIds: item.allowedConnectionIds || null,
    weight: item.weight,
    label: item.label,
  }));
  const candidates = await buildAutoCandidates(targets, "auto");
  const scored = scoreAutoTargets(
    targets,
    candidates,
    "default",
    virtualCombo.weights || DEFAULT_WEIGHTS
  );
  const connections = await getCachedProviderConnections({ isActive: true });
  const connectionState = new Map(
    connections.map((connection) => [
      connection.id,
      {
        provider: connection.provider,
        active: connection.isActive === true,
        testStatus: connection.testStatus || null,
        rateLimitedUntil: connection.rateLimitedUntil || null,
      },
    ])
  );
  const metadata = await Promise.all(
    candidates.slice(0, 24).map(async (candidate) => {
      const capabilities = getResolvedModelCapabilities({
        provider: candidate.provider,
        model: candidate.model,
      });
      const pricing = await resolveGovernorPricingEvidence(candidate.provider, candidate.model);
      const score = scored.find(
        (entry) => candidateKey(candidate) === targetFromResolved(entry.target).key
      );
      return {
        provider: candidate.provider,
        model: candidate.model,
        score: finite(score?.score),
        contextWindow: capabilities.contextWindow ?? null,
        capabilities: {
          tools: capabilities.toolCalling || capabilities.supportsTools === true,
          structuredOutput: capabilities.structuredOutput === true,
          vision: capabilities.supportsVision === true,
          reasoning: capabilities.reasoning ?? null,
        },
        pricing: pricing.pricingKnown ? "known" : "unknown",
        tier: classifyTier(candidate.provider, candidate.model).tier || null,
        latencyP95Ms: finite(candidate.p95LatencyMs),
        reliabilityObserved: candidate.reliabilityObserved ?? null,
        failureRate: finite(candidate.failureRate),
        errorRate: finite(candidate.errorRate),
        healthScore:
          candidate.reliabilityObserved === false
            ? null
            : finite(
                candidate.failureRate != null
                  ? 1 - candidate.failureRate
                  : candidate.errorRate != null
                    ? 1 - candidate.errorRate
                    : null
              ),
        circuitBreakerState: candidate.circuitBreakerState || null,
        connectionState:
          candidate.connectionId === "noauth"
            ? "synthetic-noauth"
            : connectionState.get(candidate.connectionId) || "unreported",
      };
    })
  );
  const byProvider = {};
  for (const target of targets)
    byProvider[target.provider] = (byProvider[target.provider] || 0) + 1;
  return {
    virtualCombo,
    targets,
    candidates,
    scored,
    metadata,
    connectionState,
    byProvider,
    raw: targets.length,
    active: targets.length,
    eligible: candidates.filter((candidate) => candidate.quotaCutoffBlocked !== true).length,
    healthy: candidates.filter(
      (candidate) =>
        candidate.circuitBreakerState !== "OPEN" &&
        candidate.statusPenalty !== true &&
        candidate.quotaCutoffBlocked !== true
    ).length,
    executablePlans: null,
  };
}

async function revalidateTarget(pool, provider, model) {
  const key = normalizeTarget(provider, model);
  const target = pool.targets.find((item) => targetFromResolved(item).key === key);
  const candidate = pool.candidates.find((item) => candidateKey(item) === key);
  if (!target || !candidate) return { valid: false, reason: "target_not_in_current_pool" };
  const breaker = getCircuitBreaker(provider).getStatus();
  const connectionId = target.connectionId;
  const connection =
    connectionId && connectionId !== "noauth" ? pool.connectionState?.get(connectionId) : null;
  const rateLimitedUntil = connection?.rateLimitedUntil
    ? new Date(connection.rateLimitedUntil).getTime()
    : 0;
  const cooldownActive = Number.isFinite(rateLimitedUntil) && rateLimitedUntil > Date.now();
  const unavailableStatus = ["unavailable", "banned", "expired", "credits_exhausted"].includes(
    connection?.testStatus
  );
  const valid =
    breaker.state !== "OPEN" &&
    candidate.statusPenalty !== true &&
    candidate.quotaCutoffBlocked !== true &&
    !cooldownActive &&
    !unavailableStatus;
  return {
    valid,
    providerCircuitState: breaker.state,
    connectionState: connection || (connectionId === "noauth" ? "synthetic-noauth" : "unreported"),
    cooldownActive,
    unavailableStatus,
    reason: valid ? null : "stale_or_ineligible_target",
  };
}

function planTarget(plan) {
  return plan?.selectedProvider && plan?.selectedModel
    ? normalizeTarget(plan.selectedProvider, plan.selectedModel)
    : null;
}

function nativeTarget(observation) {
  if (!observation.plan?.actualProvider || !observation.plan?.actualModel) return null;
  if (observation.request.status !== 200 || observation.request.fallbackAttempts !== 0) return null;
  return normalizeTarget(observation.plan.actualProvider, observation.plan.actualModel);
}

function summarizeTarget(pool, key) {
  if (!key) return null;
  const [provider, ...modelParts] = key.split("/");
  return {
    target: key,
    ...candidateDetails(pool, provider, modelParts.join("/")),
  };
}

function choiceReason(pool, plan) {
  if (!plan) return "no_governor_plan";
  const selected = summarizeTarget(pool, planTarget(plan));
  return [
    `tier=${plan.resolvedModelTier || "unknown"}`,
    `strategy=${plan.routingStrategy || "unknown"}`,
    `health=${selected?.health ?? "unknown"}`,
    `score=${selected?.score ?? "unavailable"}`,
    `guards=${plan.executable ? "executable" : "not_executable"}`,
  ].join(",");
}

async function runDivergenceWorkload(pool) {
  const decisions = [];
  for (const input of DIVERGENCE_WORKLOAD) {
    const requestResult = await request("auto/chat", input, "native-observe");
    const plan = await readGovernorPlan(requestResult.correlationId);
    const native = nativeTarget({ request: requestResult, plan });
    const governor = planTarget(plan);
    const agreement = native && governor ? native === governor : null;
    decisions.push({
      caseId: input.id,
      category: input.category,
      nativeTarget: native,
      governorTarget: governor,
      agreement,
      nativeProven: native !== null,
      request: requestResult,
      plan,
      governorScore: summarizeTarget(pool, governor)?.score ?? null,
      governorHealth: summarizeTarget(pool, governor)?.health ?? null,
      governorReliabilityObserved: summarizeTarget(pool, governor)?.reliabilityObserved ?? null,
      unresolvedFields: plan?.unresolvedFields || ["governorPlan"],
      reasonForGovernorChoice: choiceReason(pool, plan),
      featuresThatDiffer: {
        native: summarizeTarget(pool, native),
        governor: summarizeTarget(pool, governor),
      },
    });
  }
  return decisions;
}

function replayLatestDecisionsFromTelemetry() {
  const rows = queryGovernorTelemetryRows(500)
    .filter((row) => row.governorMode === "simulate" && row.counterfactualPlan)
    .sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0));
  const completedCaseIds = DIVERGENCE_WORKLOAD.filter((input) => input.id !== "classification").map(
    (input) => input.id
  );
  const selectedRows = rows.slice(-completedCaseIds.length);
  return selectedRows.map((row, index) => {
    const plan = safePlan(row);
    // The first completed row in this run followed a factual NVIDIA 404 and
    // fallback in the server log. Without the original response headers in
    // telemetry, fail closed and do not treat that terminal model as Native's
    // first target for direct comparison.
    const native =
      index === 0
        ? null
        : row.actualProvider && row.actualModel
          ? normalizeTarget(row.actualProvider, row.actualModel)
          : null;
    const governor = planTarget(plan);
    return {
      caseId: completedCaseIds[index],
      category: DIVERGENCE_WORKLOAD.find((input) => input.id === completedCaseIds[index]).category,
      nativeTarget: native,
      governorTarget: governor,
      agreement: native && governor ? native === governor : null,
      nativeProven: Boolean(native),
      request: null,
      plan,
      governorScore: summarizeTarget(pool, governor)?.score ?? null,
      governorHealth: summarizeTarget(pool, governor)?.health ?? null,
      governorReliabilityObserved: summarizeTarget(pool, governor)?.reliabilityObserved ?? null,
      unresolvedFields: plan?.unresolvedFields || ["governorPlan"],
      reasonForGovernorChoice: choiceReason(pool, plan),
      featuresThatDiffer: {
        native: summarizeTarget(pool, native),
        governor: summarizeTarget(pool, governor),
      },
    };
  });
}

async function runDirectComparisons(pool, decisions) {
  const eligible = decisions.filter((decision) => decision.nativeTarget && decision.governorTarget);
  const disagreements = eligible.filter((decision) => decision.agreement === false);
  const controls = eligible.filter((decision) => decision.agreement === true).slice(0, 2);
  const selected = [...disagreements, ...controls];
  const results = [];
  for (const [index, decision] of selected.entries()) {
    const nativeParts = decision.nativeTarget.split("/");
    const governorParts = decision.governorTarget.split("/");
    const nativeProvider = nativeParts.shift();
    const governorProvider = governorParts.shift();
    const nativeModel = nativeParts.join("/");
    const governorModel = governorParts.join("/");
    const input = DIVERGENCE_WORKLOAD.find((item) => item.id === decision.caseId);
    const nativeCheck = await revalidateTarget(pool, nativeProvider, nativeModel);
    const governorCheck = await revalidateTarget(pool, governorProvider, governorModel);
    if (!nativeCheck.valid || !governorCheck.valid) {
      results.push({
        caseId: decision.caseId,
        targetComparison: decision.agreement ? "AGREEMENT_CONTROL" : "DISAGREEMENT",
        invalid: true,
        invalidReason: { native: nativeCheck, governor: governorCheck },
      });
      continue;
    }
    const nativeModelStr = modelForTarget(pool, nativeProvider, nativeModel);
    const governorModelStr = modelForTarget(pool, governorProvider, governorModel);
    const governorFirst = index % 2 === 1;
    const first = governorFirst
      ? await request(governorModelStr, input, "governor-direct")
      : await request(nativeModelStr, input, "native-direct");
    const second = governorFirst
      ? await request(nativeModelStr, input, "native-direct")
      : await request(governorModelStr, input, "governor-direct");
    const native = governorFirst ? second : first;
    const governor = governorFirst ? first : second;
    const qualityWinner =
      native.qualityPass === governor.qualityPass
        ? "tie"
        : native.qualityPass
          ? "native"
          : "governor";
    const reliabilityWinner =
      native.streamCompleted === governor.streamCompleted
        ? "tie"
        : native.streamCompleted
          ? "native"
          : "governor";
    const nativeSucceeded = native.status === 200 && native.streamCompleted === true;
    const governorSucceeded = governor.status === 200 && governor.streamCompleted === true;
    const latencyWinner =
      Number.isFinite(native.completionMs) && Number.isFinite(governor.completionMs)
        ? native.completionMs === governor.completionMs
          ? "tie"
          : native.completionMs < governor.completionMs
            ? "native"
            : "governor"
        : Number.isFinite(native.firstContentMs) && Number.isFinite(governor.firstContentMs)
          ? native.firstContentMs === governor.firstContentMs
            ? "tie"
            : native.firstContentMs < governor.firstContentMs
              ? "native"
              : "governor"
          : "tie";
    const winner =
      qualityWinner !== "tie"
        ? qualityWinner
        : nativeSucceeded !== governorSucceeded
          ? nativeSucceeded
            ? "native"
            : "governor"
          : latencyWinner;
    const winnerReason =
      qualityWinner !== "tie"
        ? "quality"
        : nativeSucceeded !== governorSucceeded
          ? "success"
          : latencyWinner !== "tie"
            ? Number.isFinite(native.completionMs) && Number.isFinite(governor.completionMs)
              ? "completion_latency"
              : "ttft"
            : "tie";
    results.push({
      caseId: decision.caseId,
      targetComparison: decision.agreement ? "AGREEMENT_CONTROL" : "DISAGREEMENT",
      invalid: false,
      order: governorFirst ? "governor_then_native" : "native_then_governor",
      native,
      governor,
      pairwise: {
        qualityWinner,
        reliabilityWinner,
        latencyWinner,
        winner,
        winnerReason,
        completionDeltaMs:
          (governor.completionMs ?? governor.latencyMs) - (native.completionMs ?? native.latencyMs),
      },
    });
  }
  return results;
}

async function runGovernorE2E(pool, input, nativeKey) {
  const started = performance.now();
  const nativeTargetResolved = pool.targets.find(
    (target) => targetFromResolved(target).key === nativeKey
  );
  if (!nativeTargetResolved) {
    return { caseId: input.id, valid: false, reason: "native_target_not_in_current_pool" };
  }
  const body = {
    model: "auto/chat",
    messages: [{ role: "user", content: input.prompt }],
    stream: true,
    max_tokens: MAX_TOKENS,
  };
  const planningStarted = performance.now();
  const runtime = await applyGovernorToAutoComboOrder({
    body,
    promptText: input.prompt,
    estimatedInputTokens: estimateFinalInputTokens(body),
    taskType: "default",
    correlationId: `e2e-governor-${input.id}-${randomUUID()}`,
    nativeSelectedTarget: nativeTargetResolved,
    orderedTargets: pool.targets,
    routableCandidates: pool.candidates,
  });
  const planningMs = Math.round(performance.now() - planningStarted);
  const plan = runtime.context?.plan || null;
  const key = planTarget(plan);
  if (!plan || !key || plan.executable !== true) {
    return {
      caseId: input.id,
      valid: false,
      reason: "governor_plan_not_executable",
      planningMs,
      e2eCompletionMs: Math.round(performance.now() - started),
      plan,
    };
  }
  const [provider, ...modelParts] = key.split("/");
  const model = modelParts.join("/");
  const revalidation = await revalidateTarget(pool, provider, model);
  if (!revalidation.valid) {
    return {
      caseId: input.id,
      valid: false,
      reason: "governor_target_stale",
      planningMs,
      e2eCompletionMs: Math.round(performance.now() - started),
      plan,
      revalidation,
    };
  }
  const direct = await request(modelForTarget(pool, provider, model), input, "governor-e2e-direct");
  return {
    caseId: input.id,
    valid: true,
    planningMs,
    e2eCompletionMs: Math.round(performance.now() - started),
    plan,
    revalidation,
    direct,
    selectedTarget: key,
  };
}

async function runNativeE2E(input) {
  const started = performance.now();
  const requestResult = await request("auto/chat", input, "native-e2e");
  const plan = await readGovernorPlan(requestResult.correlationId);
  const observedTarget =
    plan?.actualProvider && plan?.actualModel
      ? normalizeTarget(plan.actualProvider, plan.actualModel)
      : requestResult.responseModel
        ? normalizeTarget(
            parseModel(requestResult.responseModel).provider || "unknown",
            parseModel(requestResult.responseModel).model || requestResult.responseModel
          )
        : null;
  return {
    caseId: input.id,
    valid: requestResult.status === 200 && requestResult.streamCompleted,
    e2eCompletionMs: Math.round(performance.now() - started),
    routingOverheadMs: null,
    request: requestResult,
    plan,
    selectedTarget: observedTarget,
  };
}

async function runE2E(pool, decisions, pairCount) {
  const usable = decisions
    .filter((decision) => decision.nativeTarget)
    .slice(0, Math.min(10, pairCount));
  const pairs = [];
  for (const [index, decision] of usable.entries()) {
    const input = DIVERGENCE_WORKLOAD.find((item) => item.id === decision.caseId);
    const governorFirst = index % 2 === 1;
    const nativeTarget = decision.nativeTarget;
    const governorPromise = () => runGovernorE2E(pool, input, nativeTarget);
    const nativePromise = () => runNativeE2E(input);
    const first = governorFirst ? await governorPromise() : await nativePromise();
    const second = governorFirst ? await nativePromise() : await governorPromise();
    const native = governorFirst ? second : first;
    const governor = governorFirst ? first : second;
    pairs.push({
      caseId: decision.caseId,
      order: governorFirst ? "governor_then_native" : "native_then_governor",
      native,
      governor,
    });
  }
  return pairs;
}

function summarizeResults(results, resultSelector) {
  const values = results
    .map(resultSelector)
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
  const percentile = (fraction) =>
    values.length
      ? values[Math.min(values.length - 1, Math.floor((values.length - 1) * fraction))]
      : null;
  return {
    count: results.length,
    success: results.filter(
      (result) =>
        (result.valid && result.request?.status === 200) ||
        (result.valid && result.direct?.status === 200)
    ).length,
    quality: results.filter((result) => (result.request || result.direct)?.qualityPass === true)
      .length,
    ttftP50: percentile(0.5),
    completionP50: percentile(0.5),
    completionP95: percentile(0.95),
  };
}

function summarizeE2EArm(pairs, side) {
  const values = pairs
    .map((pair) => pair[side])
    .filter((result) => result?.valid)
    .map((result) => result.e2eCompletionMs)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  const ttft = pairs
    .map((pair) => pair[side])
    .filter((result) => result?.valid)
    .map((result) => (result.request || result.direct)?.firstContentMs)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  const percentile = (values, fraction) =>
    values.length
      ? values[Math.min(values.length - 1, Math.floor((values.length - 1) * fraction))]
      : null;
  const results = pairs.map((pair) => pair[side]);
  return {
    pairs: pairs.length,
    success: results.filter(
      (result) => result?.valid && (result.request?.status === 200 || result.direct?.status === 200)
    ).length,
    quality: results.filter((result) => (result.request || result.direct)?.qualityPass === true)
      .length,
    ttftP50Ms: percentile(ttft, 0.5),
    completionP50Ms: percentile(values, 0.5),
    completionP95Ms: percentile(values, 0.95),
    planningP50Ms: percentile(
      pairs
        .map((pair) => pair.governor?.planningMs)
        .filter(Number.isFinite)
        .sort((a, b) => a - b),
      0.5
    ),
  };
}

function compactE2E(pairs) {
  return pairs.map((pair) => ({
    caseId: pair.caseId,
    order: pair.order,
    native: {
      valid: pair.native.valid,
      selectedTarget: pair.native.selectedTarget,
      e2eCompletionMs: pair.native.e2eCompletionMs,
      request: pair.native.request
        ? {
            status: pair.native.request.status,
            streamCompleted: pair.native.request.streamCompleted,
            qualityPass: pair.native.request.qualityPass,
            firstContentMs: pair.native.request.firstContentMs,
            completionMs: pair.native.request.completionMs,
            responseModel: pair.native.request.responseModel,
          }
        : null,
    },
    governor: {
      valid: pair.governor.valid,
      selectedTarget: pair.governor.selectedTarget,
      planningMs: pair.governor.planningMs,
      e2eCompletionMs: pair.governor.e2eCompletionMs,
      direct: pair.governor.direct
        ? {
            status: pair.governor.direct.status,
            streamCompleted: pair.governor.direct.streamCompleted,
            qualityPass: pair.governor.direct.qualityPass,
            firstContentMs: pair.governor.direct.firstContentMs,
            completionMs: pair.governor.direct.completionMs,
            responseModel: pair.governor.direct.responseModel,
          }
        : null,
    },
  }));
}

function outputDocument(result) {
  console.log(JSON.stringify(result, null, 2));
}

const pool = await buildPool();
if (poolOnly) {
  outputDocument({
    governor: "simulate / false / 0",
    pool: {
      raw: pool.raw,
      active: pool.active,
      eligible: pool.eligible,
      healthy: pool.healthy,
      executable: "per-request plan; not a pool scalar",
      byProvider: pool.byProvider,
      topCandidates: pool.metadata,
    },
  });
  process.exit(0);
}
if (directOnly || replayOnly) {
  const decisions = replayLatestDecisionsFromTelemetry();
  if (replayOnly) {
    outputDocument({ decisions });
    process.exit(0);
  }
  const direct = await runDirectComparisons(pool, decisions);
  outputDocument({
    governor: "simulate / false / 0",
    canary: 0,
    pool: {
      raw: pool.raw,
      active: pool.active,
      eligible: pool.eligible,
      healthy: pool.healthy,
      byProvider: pool.byProvider,
    },
    decisions,
    direct,
  });
  process.exit(0);
}
if (e2eReplayOnly) {
  const decisions = replayLatestDecisionsFromTelemetry();
  const usable = decisions.filter((decision) => decision.nativeTarget);
  const calibration = await runE2E(pool, usable.slice(0, 3), 3);
  const calibrationPassed =
    calibration.length === 3 &&
    calibration.every(
      (pair) =>
        pair.native.valid &&
        pair.governor.valid &&
        pair.native.request?.qualityPass === true &&
        pair.governor.direct?.qualityPass === true
    );
  if (!calibrationPassed) {
    outputDocument({
      governor: "simulate / false / 0",
      canary: 0,
      calibration: compactE2E(calibration),
      calibrationPassed: false,
      benchmark: [],
      stopReason: "e2e_calibration_failed",
    });
    process.exit(2);
  }
  const benchmark = await runE2E(pool, usable, 10);
  outputDocument({
    governor: "simulate / false / 0",
    canary: 0,
    calibration: compactE2E(calibration),
    calibrationPassed,
    benchmark: compactE2E(benchmark),
    calibrationSummary: {
      native: summarizeE2EArm(calibration, "native"),
      governor: summarizeE2EArm(calibration, "governor"),
    },
    benchmarkSummary: {
      native: summarizeE2EArm(benchmark, "native"),
      governor: summarizeE2EArm(benchmark, "governor"),
    },
  });
  process.exit(0);
}
if (workloadOnly || e2eOnly) {
  const decisions = await runDivergenceWorkload(pool);
  if (workloadOnly) {
    outputDocument({
      governor: "simulate / false / 0",
      pool: {
        raw: pool.raw,
        active: pool.active,
        eligible: pool.eligible,
        healthy: pool.healthy,
        executable: decisions.filter((item) => item.plan?.executable === true).length,
        byProvider: pool.byProvider,
        topCandidates: pool.metadata,
      },
      workload: DIVERGENCE_WORKLOAD.map(({ id, category, prompt }) => ({
        id,
        category,
        promptLength: prompt.length,
      })),
      decisions,
    });
    process.exit(0);
  }
  const e2e = await runE2E(pool, decisions, Number.isInteger(requestedPairs) ? requestedPairs : 10);
  outputDocument({ pool, decisions, e2e });
  process.exit(0);
}

const decisions = await runDivergenceWorkload(pool);
const direct = await runDirectComparisons(pool, decisions);
pool.executablePlans = decisions.filter((item) => item.plan?.executable === true).length;
const e2eCalibration = await runE2E(pool, decisions.slice(0, 3), 3);
const e2eCalibrationPassed =
  e2eCalibration.length === 3 &&
  e2eCalibration.every(
    (pair) =>
      pair.native.valid &&
      pair.governor.valid &&
      pair.native.request?.qualityPass === true &&
      pair.governor.direct?.qualityPass === true
  );
if (!e2eCalibrationPassed) {
  outputDocument({
    governor: "simulate / false / 0",
    canary: 0,
    baseUrl: BASE_URL,
    pool: {
      raw: pool.raw,
      active: pool.active,
      eligible: pool.eligible,
      healthy: pool.healthy,
      executable: pool.executablePlans,
      byProvider: pool.byProvider,
    },
    workload: DIVERGENCE_WORKLOAD.map(({ id, category, prompt }) => ({
      id,
      category,
      promptLength: prompt.length,
    })),
    decisions,
    direct,
    e2e: {
      calibrationPairs: compactE2E(e2eCalibration),
      calibrationPassed: false,
      benchmarkPairs: [],
      stopReason: "e2e_calibration_failed",
    },
  });
  process.exit(2);
}
const e2eBenchmark = await runE2E(
  pool,
  decisions,
  Number.isInteger(requestedPairs) ? requestedPairs : 10
);
const allE2E = [...e2eCalibration, ...e2eBenchmark];
const agreement = decisions.filter((item) => item.agreement === true).length;
const disagreement = decisions.filter((item) => item.agreement === false).length;
const nativeChoices = Object.fromEntries(
  Object.entries(
    Object.groupBy(decisions.map((item) => item.nativeTarget).filter(Boolean), (value) => value)
  ).map(([key, values]) => [key, values.length])
);
const governorChoices = Object.fromEntries(
  Object.entries(
    Object.groupBy(decisions.map((item) => item.governorTarget).filter(Boolean), (value) => value)
  ).map(([key, values]) => [key, values.length])
);
outputDocument({
  governor: "simulate / false / 0",
  canary: 0,
  baseUrl: BASE_URL,
  pool: {
    raw: pool.raw,
    active: pool.active,
    eligible: pool.eligible,
    healthy: pool.healthy,
    executable: pool.executablePlans,
    byProvider: pool.byProvider,
    topCandidates: pool.metadata,
  },
  workload: DIVERGENCE_WORKLOAD.map(({ id, category, prompt }) => ({
    id,
    category,
    promptLength: prompt.length,
  })),
  decisionBenchmark: {
    cases: decisions.length,
    agreement,
    disagreement,
    validDisagreement: direct.filter(
      (item) => item.targetComparison === "DISAGREEMENT" && !item.invalid
    ).length,
    governorWins: direct.filter((item) => item.pairwise?.winner === "governor").length,
    nativeWins: direct.filter((item) => item.pairwise?.winner === "native").length,
    ties: direct.filter((item) => item.pairwise?.winner === "tie").length,
    invalid: direct.filter((item) => item.invalid).length,
    operation: {
      nativeObservationRequests: decisions.length,
      directRequests: direct.reduce((sum, item) => sum + (item.invalid ? 0 : 2), 0),
    },
  },
  decisions,
  direct,
  e2e: {
    calibrationPairs: e2eCalibration,
    calibrationPassed: e2eCalibrationPassed,
    benchmarkPairs: e2eBenchmark,
    native: summarizeResults(
      e2eBenchmark.map((pair) => pair.native),
      (result) => result.e2eCompletionMs
    ),
    governor: summarizeResults(
      e2eBenchmark.map((pair) => pair.governor),
      (result) => result.e2eCompletionMs
    ),
    nativeChoices,
    governorChoices,
    agreementRate: decisions.length ? agreement / decisions.length : null,
    concentration: {
      nativeMaxShare: decisions.length
        ? Math.max(...Object.values(nativeChoices), 0) / decisions.length
        : null,
      governorMaxShare: decisions.length
        ? Math.max(...Object.values(governorChoices), 0) / decisions.length
        : null,
    },
  },
});
