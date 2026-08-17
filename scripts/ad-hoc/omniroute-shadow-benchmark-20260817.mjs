import { randomUUID } from "node:crypto";
import { queryGovernorTelemetryRows } from "../../src/lib/db/governorTelemetry.ts";

const BASE_URL = process.env.OMNIROUTE_BASE_URL || "http://127.0.0.1:20128";
const MAX_PAIRS = 3;
const configuredTimeout = Number(process.env.SHADOW_REQUEST_TIMEOUT_MS || 600_000);
const REQUEST_TIMEOUT_MS =
  Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : 600_000;
const smokeOnly = process.argv.includes("--smoke");
const requestedPairs = Number(
  process.argv.find((arg) => arg.startsWith("--pairs="))?.split("=")[1] || MAX_PAIRS
);
const pairCount =
  Number.isInteger(requestedPairs) && requestedPairs >= 1 && requestedPairs <= MAX_PAIRS
    ? requestedPairs
    : MAX_PAIRS;

const INPUTS = [
  {
    id: "alpha",
    prompt: "Reply with exactly SHADOW-ALPHA-7 and nothing else.",
    expected: "SHADOW-ALPHA-7",
  },
  {
    id: "bravo",
    prompt: "Reply with exactly SHADOW-BRAVO-8 and nothing else.",
    expected: "SHADOW-BRAVO-8",
  },
  {
    id: "charlie",
    prompt: "Reply with exactly SHADOW-CHARLIE-9 and nothing else.",
    expected: "SHADOW-CHARLIE-9",
  },
  {
    id: "delta",
    prompt: "Reply with exactly SHADOW-DELTA-10 and nothing else.",
    expected: "SHADOW-DELTA-10",
  },
  {
    id: "echo",
    prompt: "Reply with exactly SHADOW-ECHO-11 and nothing else.",
    expected: "SHADOW-ECHO-11",
  },
  {
    id: "foxtrot",
    prompt: "Reply with exactly SHADOW-FOXTROT-12 and nothing else.",
    expected: "SHADOW-FOXTROT-12",
  },
  {
    id: "golf",
    prompt: "Reply with exactly SHADOW-GOLF-13 and nothing else.",
    expected: "SHADOW-GOLF-13",
  },
  {
    id: "hotel",
    prompt: "Reply with exactly SHADOW-HOTEL-14 and nothing else.",
    expected: "SHADOW-HOTEL-14",
  },
  {
    id: "india",
    prompt: "Reply with exactly SHADOW-INDIA-15 and nothing else.",
    expected: "SHADOW-INDIA-15",
  },
  {
    id: "juliett",
    prompt: "Reply with exactly SHADOW-JULIETT-16 and nothing else.",
    expected: "SHADOW-JULIETT-16",
  },
  {
    id: "kilo",
    prompt: "Reply with exactly SHADOW-KILO-17 and nothing else.",
    expected: "SHADOW-KILO-17",
  },
  {
    id: "lima",
    prompt: "Reply with exactly SHADOW-LIMA-18 and nothing else.",
    expected: "SHADOW-LIMA-18",
  },
  {
    id: "mike",
    prompt: "Reply with exactly SHADOW-MIKE-19 and nothing else.",
    expected: "SHADOW-MIKE-19",
  },
  {
    id: "november",
    prompt: "Reply with exactly SHADOW-NOVEMBER-20 and nothing else.",
    expected: "SHADOW-NOVEMBER-20",
  },
  {
    id: "oscar",
    prompt: "Reply with exactly SHADOW-OSCAR-21 and nothing else.",
    expected: "SHADOW-OSCAR-21",
  },
  {
    id: "papa",
    prompt: "Reply with exactly SHADOW-PAPA-22 and nothing else.",
    expected: "SHADOW-PAPA-22",
  },
  {
    id: "quebec",
    prompt: "Reply with exactly SHADOW-QUEBEC-23 and nothing else.",
    expected: "SHADOW-QUEBEC-23",
  },
  {
    id: "romeo",
    prompt: "Reply with exactly SHADOW-ROMEO-24 and nothing else.",
    expected: "SHADOW-ROMEO-24",
  },
  {
    id: "sierra",
    prompt: "Reply with exactly SHADOW-SIERRA-25 and nothing else.",
    expected: "SHADOW-SIERRA-25",
  },
  {
    id: "tango",
    prompt: "Reply with exactly SHADOW-TANGO-26 and nothing else.",
    expected: "SHADOW-TANGO-26",
  },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function header(response, name) {
  return response.headers.get(name) || null;
}

function providerFromModel(model) {
  if (typeof model !== "string" || !model.includes("/")) return null;
  return model.slice(0, model.indexOf("/"));
}

function modelFromModel(model) {
  if (typeof model !== "string" || !model.includes("/")) return model || null;
  return model.slice(model.indexOf("/") + 1);
}

function classifyFailure(status, errorCode) {
  if (status === 429) return "429";
  if (status === 404) return "404";
  if (status === 503) return "503";
  return status >= 400 ? "OTHER_ERROR" : null;
}

function parsePositiveInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function normalizeUsage(usage) {
  if (!usage || typeof usage !== "object") return null;
  return {
    promptTokens: usage.prompt_tokens ?? usage.input_tokens ?? null,
    outputTokens: usage.completion_tokens ?? usage.output_tokens ?? null,
    totalTokens: usage.total_tokens ?? null,
  };
}

function parseSseFrame(frame, state, expected) {
  const data = frame
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n")
    .trim();
  if (!data) return;

  state.eventCount += 1;
  state.firstEventAt ??= performance.now();
  state.lastEventAt = performance.now();
  if (data === "[DONE]") {
    state.sawDone = true;
    state.doneAt ??= performance.now();
    return;
  }

  let payload;
  try {
    payload = JSON.parse(data);
  } catch {
    state.parseError = "sse_json_parse_error";
    return;
  }

  if (typeof payload?.model === "string") state.responseModel = payload.model;
  if (payload?.usage) state.usage = normalizeUsage(payload.usage);
  if (payload?.error) {
    state.errorCode =
      typeof payload.error.code === "string"
        ? payload.error.code
        : typeof payload.error.type === "string"
          ? payload.error.type
          : "provider_error";
  }

  const choice = payload?.choices?.[0];
  const content = choice?.delta?.content ?? choice?.message?.content;
  if (typeof content === "string") state.content += content;
  if (choice?.finish_reason != null) state.sawFinishReason = true;
  state.qualityPass = state.content.includes(expected);
}

async function readStreamingBody(response, expected, started) {
  const state = {
    content: "",
    eventCount: 0,
    firstByteAt: null,
    firstEventAt: null,
    lastEventAt: null,
    doneAt: null,
    connectionClosedAt: null,
    sawDone: false,
    sawFinishReason: false,
    responseModel: null,
    usage: null,
    errorCode: null,
    parseError: null,
    qualityPass: false,
  };

  if (!response.body) {
    state.connectionClosedAt = performance.now();
    return state;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      if (!chunk.value?.byteLength) continue;
      state.firstByteAt ??= performance.now();
      buffer += decoder.decode(chunk.value, { stream: true });
      let separator;
      while ((separator = buffer.search(/\r?\n\r?\n/)) >= 0) {
        const match = buffer.slice(separator).match(/^\r?\n\r?\n/);
        const separatorLength = match?.[0].length || 2;
        const frame = buffer.slice(0, separator);
        buffer = buffer.slice(separator + separatorLength);
        parseSseFrame(frame, state, expected);
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) parseSseFrame(buffer, state, expected);
  } finally {
    state.connectionClosedAt = performance.now();
    reader.releaseLock();
  }
  return state;
}

async function request(model, input, armLabel) {
  const started = performance.now();
  const requestCorrelationId = `shadow-${input.id}-${armLabel}-${randomUUID()}`;
  let response = null;
  try {
    const requestSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    response = await fetch(`${BASE_URL}/api/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "text/event-stream",
        "X-Correlation-Id": requestCorrelationId,
      },
      signal: requestSignal,
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: input.prompt }],
        stream: true,
        temperature: 0,
        max_tokens: 32,
      }),
    });
    const headersAt = performance.now();
    const stream = await readStreamingBody(response, input.expected, started);
    const responseCorrelationId = header(response, "x-correlation-id");
    const streamCompleted = response.status === 200 && (stream.sawDone || stream.sawFinishReason);
    return {
      status: response.status,
      latencyMs: Math.round(performance.now() - started),
      headersAtMs: Math.round(headersAt - started),
      firstByteMs: stream.firstByteAt ? Math.round(stream.firstByteAt - started) : null,
      firstEventMs: stream.firstEventAt ? Math.round(stream.firstEventAt - started) : null,
      lastEventMs: stream.lastEventAt ? Math.round(stream.lastEventAt - started) : null,
      doneMs: stream.doneAt ? Math.round(stream.doneAt - started) : null,
      connectionClosedMs: stream.connectionClosedAt
        ? Math.round(stream.connectionClosedAt - started)
        : null,
      streamCompleted,
      streamEventCount: stream.eventCount,
      failureClass: streamCompleted
        ? null
        : classifyFailure(response.status, stream.errorCode) ||
          (response.status === 200 ? "INCOMPLETE_STREAM" : null),
      errorCode: stream.errorCode || stream.parseError,
      responseModel: stream.responseModel,
      responseProvider: providerFromModel(stream.responseModel),
      usage: stream.usage,
      requestId: header(response, "x-request-id") || header(response, "x-omniroute-request-id"),
      requestCorrelationId,
      responseCorrelationId,
      correlationId: responseCorrelationId,
      fallbackAttempts: parsePositiveInteger(header(response, "x-omniroute-fallback-attempts")),
      qualityPass: streamCompleted && stream.qualityPass,
      harnessTimeout: false,
      model,
      armLabel,
    };
  } catch (error) {
    const errorName = error instanceof Error ? error.name : "transport_error";
    const harnessTimeout = errorName === "TimeoutError" || errorName === "AbortError";
    return {
      status: 0,
      latencyMs: Math.round(performance.now() - started),
      headersAtMs: null,
      firstByteMs: null,
      firstEventMs: null,
      lastEventMs: null,
      doneMs: null,
      connectionClosedMs: null,
      streamCompleted: false,
      streamEventCount: 0,
      failureClass: harnessTimeout ? "HARNESS_TIMEOUT" : "TRANSPORT_ERROR",
      errorCode: errorName,
      responseModel: null,
      responseProvider: null,
      usage: null,
      requestId: null,
      requestCorrelationId,
      responseCorrelationId: null,
      correlationId: null,
      fallbackAttempts: null,
      qualityPass: false,
      harnessTimeout,
      model,
      armLabel,
    };
  }
}

async function readGovernorPlan(correlationId) {
  if (!correlationId) return null;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const row = queryGovernorTelemetryRows(100).find(
      (entry) => entry.correlationId === correlationId
    );
    if (row?.counterfactualPlan) {
      const plan = row.counterfactualPlan;
      return {
        governorMode: row.governorMode,
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
        recommendationTier: row.recommendation?.modelPolicy?.recommendedTier || null,
        routingStrategy: row.recommendation?.routingPolicy?.strategy || null,
        actualProvider: row.actualProvider || null,
        actualModel: row.actualModel || null,
      };
    }
    await sleep(150);
  }
  return null;
}

async function requestWithPlan(input, armLabel) {
  const requestResult = await request("auto/chat", input, armLabel);
  const plan = await readGovernorPlan(requestResult.correlationId);
  return { request: requestResult, plan };
}

async function runGovernorArm(input) {
  const planned = await requestWithPlan(input, "governor-plan");
  const targetValid = Boolean(
    planned.plan?.governorMode === "simulate" &&
    planned.plan.selectedProvider &&
    planned.plan.selectedModel &&
    planned.plan.executable &&
    planned.plan.unresolvedFields.length === 0
  );
  const directTarget = targetValid
    ? `${planned.plan.selectedProvider}/${planned.plan.selectedModel}`
    : null;
  const direct = directTarget ? await request(directTarget, input, "governor-exec") : null;
  return { ...planned, direct, directTarget };
}

function summarizeArm(results, firstChoiceSuccess = false) {
  const latencies = results
    .map((result) => result.latencyMs)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  const successes = results.filter((result) => result.status === 200);
  const quality = results.filter((result) => result.qualityPass);
  const percentile = (fraction) =>
    latencies.length
      ? latencies[Math.min(latencies.length - 1, Math.floor((latencies.length - 1) * fraction))]
      : null;
  const mean = latencies.length
    ? Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length)
    : null;
  return {
    count: results.length,
    success: successes.length,
    successRate: results.length ? successes.length / results.length : null,
    qualityPass: quality.length,
    qualityPassRate: results.length ? quality.length / results.length : null,
    timeout: results.filter((result) => result.failureClass === "TIMEOUT").length,
    errors: results.filter((result) => result.status >= 400 || result.status === 0).length,
    minLatencyMs: latencies[0] ?? null,
    meanLatencyMs: mean,
    p50LatencyMs: percentile(0.5),
    p95LatencyMs: percentile(0.95),
    maxLatencyMs: latencies.at(-1) ?? null,
    firstChoiceSuccess,
  };
}

if (smokeOnly) {
  const smoke = await requestWithPlan(INPUTS[0], "correlation-smoke");
  console.log(
    JSON.stringify(
      {
        baseUrl: BASE_URL,
        requestTimeoutMs: REQUEST_TIMEOUT_MS,
        governor: "simulate / false / 0",
        request: smoke.request,
        plan: smoke.plan,
        correlationPass: Boolean(
          smoke.request.requestCorrelationId &&
          smoke.request.responseCorrelationId &&
          smoke.plan?.governorMode === "simulate"
        ),
      },
      null,
      2
    )
  );
  process.exit(smoke.plan ? 0 : 1);
}

const pairs = [];
for (const [index, input] of INPUTS.slice(0, pairCount).entries()) {
  const governorFirst = index % 2 === 1;
  let native;
  let governor;
  if (governorFirst) {
    governor = await runGovernorArm(input);
    const nativeArm = await requestWithPlan(input, "native");
    native = {
      ...nativeArm.request,
      plan: nativeArm.plan,
      firstChoiceProvider: nativeArm.plan?.actualProvider || null,
      firstChoiceModel: nativeArm.plan?.actualModel || null,
      firstChoiceSuccess: Boolean(
        nativeArm.request.streamCompleted &&
        nativeArm.plan?.actualProvider &&
        nativeArm.plan?.actualModel &&
        nativeArm.request.responseModel ===
          `${nativeArm.plan.actualProvider}/${nativeArm.plan.actualModel}`
      ),
    };
  } else {
    const nativeArm = await requestWithPlan(input, "native");
    native = {
      ...nativeArm.request,
      plan: nativeArm.plan,
      firstChoiceProvider: nativeArm.plan?.actualProvider || null,
      firstChoiceModel: nativeArm.plan?.actualModel || null,
      firstChoiceSuccess: Boolean(
        nativeArm.request.streamCompleted &&
        nativeArm.plan?.actualProvider &&
        nativeArm.plan?.actualModel &&
        nativeArm.request.responseModel ===
          `${nativeArm.plan.actualProvider}/${nativeArm.plan.actualModel}`
      ),
    };
    governor = await runGovernorArm(input);
  }

  const nativePlan = native.plan;
  const governorPlan = governor.plan;
  const direct = governor.direct;
  pairs.push({
    pairId: input.id,
    executionOrder: governorFirst ? "governor_then_native" : "native_then_governor",
    native,
    governor: {
      planningRequest: governor.request,
      plan: governorPlan,
      directTarget: governor.directTarget,
      direct: direct ? { ...direct, attempts: 1, fallbackDepth: 0, directChoice: true } : null,
    },
    targetValidity: {
      executable: governorPlan?.executable === true,
      unresolvedFields: governorPlan?.unresolvedFields || [],
      guardrails: governorPlan?.guardrails || {},
      directTarget: governor.directTarget,
    },
    pairwise: direct
      ? {
          qualityWinner:
            native.qualityPass === direct.qualityPass
              ? "tie"
              : native.qualityPass
                ? "native"
                : "governor",
          reliabilityWinner:
            native.streamCompleted && !direct.streamCompleted
              ? "native"
              : direct.streamCompleted && !native.streamCompleted
                ? "governor"
                : "tie",
          latencyDeltaMs: direct.latencyMs - native.latencyMs,
        }
      : { qualityWinner: "unjudgeable", reliabilityWinner: "unjudgeable", latencyDeltaMs: null },
    correlation: {
      native: native.correlationId,
      governorPlan: governor.request.correlationId,
      governorExecution: direct?.correlationId || null,
      distinct:
        new Set(
          [
            native.requestCorrelationId,
            governor.request.requestCorrelationId,
            direct?.requestCorrelationId,
          ].filter(Boolean)
        ).size === (direct ? 3 : 2),
    },
    nativeFirstChoiceProvider: nativePlan?.actualProvider || null,
    nativeFirstChoiceModel: nativePlan?.actualModel || null,
  });
}

const nativeResults = pairs.map((pair) => pair.native);
const governorResults = pairs.map((pair) => pair.governor.direct).filter(Boolean);
const nativeFirstChoiceSuccess = nativeResults.filter((result) => result.firstChoiceSuccess).length;
const qualityCounts = pairs.reduce((counts, pair) => {
  counts[pair.pairwise.qualityWinner] = (counts[pair.pairwise.qualityWinner] || 0) + 1;
  return counts;
}, {});
const reliabilityCounts = pairs.reduce((counts, pair) => {
  counts[pair.pairwise.reliabilityWinner] = (counts[pair.pairwise.reliabilityWinner] || 0) + 1;
  return counts;
}, {});

console.log(
  JSON.stringify(
    {
      baseUrl: BASE_URL,
      pairCount: pairs.length,
      executionOrder: ["native_then_governor", "governor_then_native", "native_then_governor"],
      qualityMethod: "blind-free exact expected-token containment; no LLM judge",
      governor: "simulate / false / 0",
      requestMode: "stream=true",
      requestTimeoutMs: REQUEST_TIMEOUT_MS,
      externalTimeoutClassification: "HARNESS_TIMEOUT",
      native: summarizeArm(nativeResults, nativeFirstChoiceSuccess),
      governorDirect: summarizeArm(governorResults),
      governorPlansCorrelated: pairs.filter((pair) => pair.governor.plan).length,
      governorExecutable: pairs.filter((pair) => pair.governor.plan?.executable === true).length,
      qualityWins: qualityCounts,
      reliabilityWins: reliabilityCounts,
      pairs,
    },
    null,
    2
  )
);
