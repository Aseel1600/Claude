import { queryGovernorTelemetryRows } from "../../src/lib/db/governorTelemetry.ts";

const BASE_URL = process.env.OMNIROUTE_BASE_URL || "http://127.0.0.1:20128";
const MAX_PAIRS = 20;
const REQUEST_TIMEOUT_MS = Number(process.env.SHADOW_REQUEST_TIMEOUT_MS || 90_000);
const requestedPairs = Number(
  process.argv.find((arg) => arg.startsWith("--pairs="))?.split("=")[1] || 5
);
const pairCount =
  Number.isInteger(requestedPairs) && requestedPairs >= 1 && requestedPairs <= MAX_PAIRS
    ? requestedPairs
    : 5;

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
  if (status === 408 || status === 504 || /timeout/i.test(String(errorCode || "")))
    return "TIMEOUT";
  if (status === 429) return "429";
  if (status === 404) return "404";
  if (status === 503) return "503";
  return status >= 400 ? "OTHER_ERROR" : null;
}

function qualityPass(body, expected) {
  const content = body?.choices?.[0]?.message?.content;
  return typeof content === "string" && content.includes(expected);
}

function parsePositiveInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

async function request(model, input) {
  const started = performance.now();
  let response;
  let body = null;
  let parseError = null;
  try {
    const requestSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    response = await fetch(`${BASE_URL}/api/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: requestSignal,
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: input.prompt }],
        stream: false,
        temperature: 0,
        max_tokens: 32,
      }),
    });
    const rawBody = await response.text();
    try {
      body = JSON.parse(rawBody);
    } catch (error) {
      parseError = error instanceof Error ? error.name : "parse_error";
    }
  } catch (error) {
    const errorName = error instanceof Error ? error.name : "transport_error";
    return {
      status: 0,
      latencyMs: Math.round(performance.now() - started),
      failureClass:
        errorName === "TimeoutError" || errorName === "AbortError" ? "TIMEOUT" : "TRANSPORT_ERROR",
      errorCode: errorName,
      responseModel: null,
      responseProvider: null,
      usage: null,
      requestId: null,
      correlationId: null,
      fallbackAttempts: null,
      qualityPass: false,
    };
  }

  const responseModel = typeof body?.model === "string" ? body.model : null;
  const errorCode = typeof body?.error?.code === "string" ? body.error.code : parseError;
  return {
    status: response.status,
    latencyMs: Math.round(performance.now() - started),
    failureClass: classifyFailure(response.status, errorCode),
    errorCode,
    responseModel,
    responseProvider: providerFromModel(responseModel),
    usage: body?.usage
      ? {
          promptTokens: body.usage.prompt_tokens ?? null,
          outputTokens: body.usage.completion_tokens ?? null,
          totalTokens: body.usage.total_tokens ?? null,
        }
      : null,
    requestId: header(response, "x-request-id") || header(response, "x-omniroute-request-id"),
    correlationId: header(response, "x-correlation-id"),
    fallbackAttempts: parsePositiveInteger(header(response, "x-omniroute-fallback-attempts")),
    qualityPass: response.status === 200 && qualityPass(body, input.expected),
  };
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

const pairs = [];
for (const input of INPUTS.slice(0, pairCount)) {
  // Native is intentionally first because its simulate telemetry supplies the factual
  // Governor plan without changing the production route or adding a second planner arm.
  const native = await request("auto/chat", input);
  const plan = await readGovernorPlan(native.correlationId);
  const targetValid = Boolean(
    plan?.governorMode === "simulate" &&
    plan.selectedProvider &&
    plan.selectedModel &&
    plan.executable &&
    plan.unresolvedFields.length === 0
  );
  const governorTarget = targetValid ? `${plan.selectedProvider}/${plan.selectedModel}` : null;
  const governor = governorTarget ? await request(governorTarget, input) : null;
  pairs.push({
    pairId: input.id,
    executionOrder: "native_then_governor",
    native: {
      ...native,
      firstChoiceProvider: plan?.actualProvider || null,
      firstChoiceModel: plan?.actualModel || null,
      firstChoiceSuccess: Boolean(
        native.status === 200 &&
        plan?.actualProvider &&
        plan?.actualModel &&
        native.responseProvider === plan.actualProvider &&
        native.responseModel === `${plan.actualProvider}/${plan.actualModel}`
      ),
    },
    governorPlan: plan,
    targetValidity: {
      executable: plan?.executable === true,
      unresolvedFields: plan?.unresolvedFields || [],
      guardrails: plan?.guardrails || {},
      directTarget: governorTarget,
    },
    governor: governor ? { ...governor, attempts: 1, fallbackDepth: 0, directChoice: true } : null,
    pairwise: governor
      ? {
          qualityWinner:
            native.qualityPass === governor.qualityPass
              ? "tie"
              : native.qualityPass
                ? "native"
                : "governor",
          reliabilityWinner:
            native.status === 200 && governor.status !== 200
              ? "native"
              : governor.status === 200 && native.status !== 200
                ? "governor"
                : "tie",
          latencyDeltaMs: governor.latencyMs - native.latencyMs,
        }
      : { qualityWinner: "unjudgeable", reliabilityWinner: "unjudgeable", latencyDeltaMs: null },
  });
}

const nativeResults = pairs.map((pair) => pair.native);
const governorResults = pairs.map((pair) => pair.governor).filter(Boolean);
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
      executionOrder: "native_then_governor",
      qualityMethod: "blind-free exact expected-token containment; no LLM judge",
      governor: "simulate / false / 0",
      native: summarizeArm(nativeResults, nativeFirstChoiceSuccess),
      governorDirect: summarizeArm(governorResults),
      qualityWins: qualityCounts,
      reliabilityWins: reliabilityCounts,
      pairs,
    },
    null,
    2
  )
);
