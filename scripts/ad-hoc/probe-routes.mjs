#!/usr/bin/env node
/**
 * Automated production model probe script.
 * Tests each route through 4 gates: plain generation, native tool calling,
 * tool-result continuation, and multi-step tool loop.
 *
 * Usage: node scripts/ad-hoc/probe-routes.mjs [options]
 *   --start <n>   Start from route index n (1-based)
 *   --end <n>     End at route index n
 *   --routes <file>  JSON file with route list (default: inline)
 */
import https from "https";
import http from "http";
import { URL } from "url";
import * as fs from "fs";
import * as path from "path";

// Filtered from production DB (oracle-vps, omniroute-parallel):
//   Active providers + :free / -free models + combo-referenced models.
// Source: key_value namespace 'syncedAvailableModels' filtered to is_active=1
//   providers, plus combos table model strings.
const DEFAULT_ROUTES = [
  ...new Set([
    // --- :free / -free models from active production providers ---
    // command-code
    "command-code/poolside/laguna-s-2.1-free",
    // nous-research
    "nous-research/meituan/longcat-2.0:free",
    "nous-research/poolside/laguna-s-2.1:free",
    "nous-research/poolside/laguna-xs-2.1:free",
    "nous-research/stepfun/step-3.7-flash:free",
    "nous-research/tencent/hy3:free",
    "nous-research/upstage/solar-pro4:free",
    // openai-compatible-chat (a7b11c31-aadd-42d4-91d4-4b19701451f7)
    "openai-compatible-chat-a7b11c31-aadd-42d4-91d4-4b19701451f7/nvidia/nemotron-3-ultra-550b-a55b:free",
    // openrouter
    "openrouter/cohere/north-mini-code:free",
    "openrouter/dots-studio/dots-3-note-preview:free",
    "openrouter/google/gemma-4-26b-a4b-it:free",
    "openrouter/google/gemma-4-31b-it:free",
    "openrouter/nvidia/nemotron-3-nano-30b-a3b:free",
    "openrouter/nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
    "openrouter/nvidia/nemotron-3-super-120b-a12b:free",
    "openrouter/nvidia/nemotron-3-ultra-550b-a55b:free",
    "openrouter/nvidia/nemotron-3.5-content-safety:free",
    "openrouter/nvidia/nemotron-3.5-lightning:free",
    "openrouter/nvidia/nemotron-nano-12b-v2-vl:free",
    "openrouter/nvidia/nemotron-nano-9b-v2:free",
    "openrouter/openai/gpt-oss-20b:free",
    "openrouter/poolside/laguna-s-2.1:free",
    "openrouter/poolside/laguna-xs-2.1:free",
    "openrouter/z-ai/glm-5.2:free",
    // --- Combo-referenced models (active providers not caught by :free) ---
    // antigravity
    "antigravity/claude-opus-4-6-thinking",
    "antigravity/claude-sonnet-4-6",
    "antigravity/gemini-3.5-flash-lite",
    "antigravity/gemini-3.6-flash-medium",
    "antigravity/gemini-3.7-flash-tiered",
    "antigravity/gemini-2.5-flash",
    // codex
    "codex/gpt-5.6-luna",
    // longcat
    "longcat/longcat-2.0",
    // nvidia
    "nvidia/nvidia/nemotron-3-super-120b-a12b",
  ]),
];

const CONFIG = {
  baseUrl: process.env.PROBE_BASE_URL || "https://squrvq.tail0bec0f.ts.net/v1/chat/completions",
  apiKey: process.env.PROBE_API_KEY || "0600",
  timeout: 30000,
  delay: 2000,
};

const CLASSIFICATIONS = {
  STRONG: "STRONG",
  CONDITIONAL: "CONDITIONAL",
  NO_NATIVE_TOOLS: "NO_NATIVE_TOOLS",
  TOOL_CONTINUATION_FAILURE: "TOOL_CONTINUATION_FAILURE",
  ENDPOINT_OR_MODEL_FAILURE: "ENDPOINT_OR_MODEL_FAILURE",
  RATE_LIMITED: "RATE_LIMITED",
  TRANSIENT_FAILURE: "TRANSIENT_FAILURE",
  ROUTE_NOT_PRESENT: "ROUTE_NOT_PRESENT",
  UNRESOLVED: "UNRESOLVED",
};

const ADD_TOOL = {
  type: "function",
  function: {
    name: "add",
    description: "Add two numbers",
    parameters: {
      type: "object",
      properties: { a: { type: "number" }, b: { type: "number" } },
      required: ["a", "b"],
    },
  },
};
const MULTIPLY_TOOL = {
  type: "function",
  function: {
    name: "multiply",
    description: "Multiply two numbers",
    parameters: {
      type: "object",
      properties: { a: { type: "number" }, b: { type: "number" } },
      required: ["a", "b"],
    },
  },
};

const TOOLS = [ADD_TOOL, MULTIPLY_TOOL];

const PROMPT_GATE1 = "What is the capital of France?";
const PROMPT_GATE2 =
  "Using the available tools, calculate (17 + 8) x 4. You must use the tools rather than calculate it internally.";

function makeRequest(body) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(CONFIG.baseUrl);
    const data = JSON.stringify(body);
    const isHttps = parsedUrl.protocol === "https:";
    const lib = isHttps ? https : http;

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${CONFIG.apiKey}`,
        "Content-Length": Buffer.byteLength(data),
      },
      timeout: CONFIG.timeout,
      rejectUnauthorized: true,
    };

    const req = lib.request(options, (res) => {
      let responseData = "";
      res.on("data", (chunk) => (responseData += chunk));
      res.on("end", () => {
        try {
          const parsed = JSON.parse(responseData);
          resolve({ status: res.statusCode, body: parsed, raw: responseData });
        } catch (e) {
          resolve({
            status: res.statusCode,
            body: responseData,
            raw: responseData,
            parseError: true,
          });
        }
      });
    });

    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy(new Error("Request timed out"));
      reject(new Error("TIMEOUT"));
    });
    req.write(data);
    req.end();
  });
}

function extractToolCalls(message) {
  if (!message || !message.tool_calls || !Array.isArray(message.tool_calls)) return [];
  return message.tool_calls
    .filter((tc) => tc.type === "function" && tc.function)
    .map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: tc.function.arguments,
    }));
}

async function probeGate(model, messages, tools) {
  const body = { model, stream: false, messages, tools, max_tokens: 200 };
  try {
    return await makeRequest(body);
  } catch (e) {
    return { error: e.message || String(e), parseError: false };
  }
}

async function probeRoute(route, index) {
  const results = {
    route,
    index,
    timestamp: new Date().toISOString(),
    revision: "v3.8.50",
    executionOrder: index,
    gates: {},
    classification: CLASSIFICATIONS.UNRESOLVED,
    raw: {},
  };

  // --- Gate 1: Plain generation ---
  console.log(`  Gate 1 (plain generation)...`);
  const g1 = await probeGate(route, [{ role: "user", content: PROMPT_GATE1 }], undefined);
  if (g1.error && g1.error === "TIMEOUT") {
    results.gates.gate1 = CLASSIFICATIONS.TRANSIENT_FAILURE;
    results.raw.gate1 = { error: g1.error };
  } else if (!g1.body || g1.status !== 200) {
    if (g1.body && g1.body.error) {
      results.gates.gate1 = classifyError(g1.body.error.type, g1.body.error.code, g1.status);
    } else {
      results.gates.gate1 = CLASSIFICATIONS.TRANSIENT_FAILURE;
    }
    results.raw.gate1 = { status: g1.status, body: g1.body };
  } else {
    const content = g1.body?.choices?.[0]?.message?.content || "";
    results.gates.gate1 = content.trim() ? "PASSED" : CLASSIFICATIONS.TRANSIENT_FAILURE;
    results.raw.gate1 = { status: g1.status, content };
  }
  console.log(`    -> ${results.gates.gate1}`);

  // If gate 1 failed with a terminal error, skip remaining gates
  if (results.gates.gate1 !== "PASSED") {
    if (
      results.gates.gate1 === CLASSIFICATIONS.ROUTE_NOT_PRESENT ||
      results.gates.gate1 === CLASSIFICATIONS.ENDPOINT_OR_MODEL_FAILURE
    ) {
      results.classification = results.gates.gate1;
    }
    return results;
  }

  // --- Gate 2: Native tool calling ---
  console.log(`  Gate 2 (native tool calling)...`);
  const g2 = await probeGate(route, [{ role: "user", content: PROMPT_GATE2 }], TOOLS);
  if (g2.error && g2.error === "TIMEOUT") {
    results.gates.gate2 = CLASSIFICATIONS.TRANSIENT_FAILURE;
    results.raw.gate2 = { error: g2.error };
  } else if (!g2.body || g2.status !== 200) {
    if (g2.body && g2.body.error) {
      results.gates.gate2 = classifyError(g2.body.error.type, g2.body.error.code, g2.status);
    } else {
      results.gates.gate2 = CLASSIFICATIONS.TRANSIENT_FAILURE;
    }
    results.raw.gate2 = { status: g2.status, body: g2.body };
  } else {
    const toolCalls = extractToolCalls(g2.body?.choices?.[0]?.message);
    if (toolCalls.length > 0) {
      results.gates.gate2 = "PASSED";
      results.raw.gate2 = { status: g2.status, toolCalls };
    } else {
      results.gates.gate2 = CLASSIFICATIONS.NO_NATIVE_TOOLS;
      results.raw.gate2 = { status: g2.status, content: g2.body?.choices?.[0]?.message?.content };
    }
  }
  console.log(`    -> ${results.gates.gate2}`);

  if (results.gates.gate2 !== "PASSED") {
    if (results.gates.gate2 === CLASSIFICATIONS.NO_NATIVE_TOOLS) {
      results.classification = CLASSIFICATIONS.NO_NATIVE_TOOLS;
    }
    return results;
  }

  // --- Gate 3: Tool-result continuation ---
  console.log(`  Gate 3 (tool-result continuation)...`);
  const tc = extractToolCalls(g2.body.choices[0].message);
  const toolCall = tc.find((t) => t.name === "add");
  if (!toolCall) {
    results.gates.gate3 = CLASSIFICATIONS.TOOL_CONTINUATION_FAILURE;
    results.raw.gate3 = { error: "No add tool call found for continuation" };
    results.classification = CLASSIFICATIONS.TOOL_CONTINUATION_FAILURE;
    return results;
  }

  const messagesG3 = [
    { role: "user", content: PROMPT_GATE2 },
    {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          type: "function",
          id: toolCall.id,
          function: { name: "add", arguments: toolCall.arguments },
        },
      ],
    },
    { role: "tool", tool_call_id: toolCall.id, content: "25" },
  ];

  const g3 = await probeGate(route, messagesG3, TOOLS);
  if (g3.error && g3.error === "TIMEOUT") {
    results.gates.gate3 = CLASSIFICATIONS.TRANSIENT_FAILURE;
    results.raw.gate3 = { error: g3.error };
  } else if (!g3.body || g3.status !== 200) {
    if (g3.body && g3.body.error) {
      results.gates.gate3 = classifyError(g3.body.error.type, g3.body.error.code, g3.status);
    } else {
      results.gates.gate3 = CLASSIFICATIONS.TRANSIENT_FAILURE;
    }
    results.raw.gate3 = { status: g3.status, body: g3.body };
  } else {
    const toolCallsG3 = extractToolCalls(g3.body?.choices?.[0]?.message);
    const hasMultiply = toolCallsG3.some(
      (t) =>
        t.name === "multiply" && JSON.parse(t.arguments).a === 25 && JSON.parse(t.arguments).b === 4
    );
    if (hasMultiply) {
      results.gates.gate3 = "PASSED";
      results.raw.gate3 = { status: g3.status, toolCalls: toolCallsG3 };
    } else {
      results.gates.gate3 = CLASSIFICATIONS.TOOL_CONTINUATION_FAILURE;
      results.raw.gate3 = {
        status: g3.status,
        toolCalls: toolCallsG3,
        content: g3.body?.choices?.[0]?.message?.content,
      };
    }
  }
  console.log(`    -> ${results.gates.gate3}`);

  if (results.gates.gate3 !== "PASSED") {
    results.classification = CLASSIFICATIONS.TOOL_CONTINUATION_FAILURE;
    return results;
  }

  // --- Gate 4: Multi-step tool loop ---
  console.log(`  Gate 4 (multi-step tool loop)...`);
  const g3ToolCall = extractToolCalls(g3.body.choices[0].message)[0];
  if (!g3ToolCall || !g3ToolCall.id) {
    results.gates.gate4 = CLASSIFICATIONS.TOOL_CONTINUATION_FAILURE;
    results.raw.gate4 = { error: "No tool call in gate 3 response for loop continuation" };
    results.classification = CLASSIFICATIONS.TOOL_CONTINUATION_FAILURE;
    return results;
  }

  // Echo gate 3's assistant message, normalizing null content so the
  // upstream sees a string (Cloudflare /ai/v1 requires content to be a string).
  const g4AssistantMsg = g3.body.choices[0].message;
  if (g4AssistantMsg.content === null) g4AssistantMsg.content = "";

  const messagesG4 = [
    { role: "user", content: PROMPT_GATE2 },
    {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          type: "function",
          id: toolCall.id,
          function: { name: "add", arguments: toolCall.arguments },
        },
      ],
    },
    { role: "tool", tool_call_id: toolCall.id, content: "25" },
    g4AssistantMsg,
    { role: "tool", tool_call_id: g3ToolCall.id, content: "100" },
  ];

  const g4 = await probeGate(route, messagesG4, TOOLS);
  if (g4.error && g4.error === "TIMEOUT") {
    results.gates.gate4 = CLASSIFICATIONS.TRANSIENT_FAILURE;
    results.raw.gate4 = { error: g4.error };
  } else if (!g4.body || g4.status !== 200) {
    if (g4.body && g4.body.error) {
      results.gates.gate4 = classifyError(g4.body.error.type, g4.body.error.code, g4.status);
    } else {
      results.gates.gate4 = CLASSIFICATIONS.TRANSIENT_FAILURE;
    }
    results.raw.gate4 = { status: g4.status, body: g4.body };
  } else {
    const content = g4.body?.choices?.[0]?.message?.content || "";
    results.gates.gate4 = content.includes("100")
      ? "PASSED"
      : CLASSIFICATIONS.TOOL_CONTINUATION_FAILURE;
    results.raw.gate4 = { status: g4.status, content };
  }
  console.log(`    -> ${results.gates.gate4}`);

  // --- Final classification ---
  const allPassed = Object.values(results.gates).every((g) => g === "PASSED");
  if (allPassed) {
    results.classification = CLASSIFICATIONS.STRONG;
  } else if (Object.values(results.gates).some((g) => g === "PASSED")) {
    results.classification = CLASSIFICATIONS.CONDITIONAL;
  } else {
    results.classification =
      results.gates.gate4 !== "PASSED"
        ? CLASSIFICATIONS.TOOL_CONTINUATION_FAILURE
        : CLASSIFICATIONS.UNRESOLVED;
  }

  return results;
}

function classifyError(errorType, errorCode, status) {
  if (
    status === 404 ||
    errorType === "model_not_found" ||
    errorCode === "model_not_found" ||
    errorType === "invalid_model"
  ) {
    return CLASSIFICATIONS.ROUTE_NOT_PRESENT;
  }
  if (
    status === 429 ||
    errorType === "insufficient_quota" ||
    errorCode === "insufficient_quota" ||
    errorType === "rate_limited"
  ) {
    return CLASSIFICATIONS.RATE_LIMITED;
  }
  if (status === 403) {
    return CLASSIFICATIONS.RATE_LIMITED;
  }
  if (status === 401) {
    return CLASSIFICATIONS.ENDPOINT_OR_MODEL_FAILURE;
  }
  if (status >= 500) {
    return CLASSIFICATIONS.TRANSIENT_FAILURE;
  }
  return CLASSIFICATIONS.ENDPOINT_OR_MODEL_FAILURE;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { start: 0, end: DEFAULT_ROUTES.length, routes: DEFAULT_ROUTES };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--start" && args[i + 1]) opts.start = parseInt(args[i + 1]) - 1;
    if (args[i] === "--end" && args[i + 1]) opts.end = parseInt(args[i + 1]);
    if (args[i] === "--routes" && args[i + 1]) {
      const routesFile = path.resolve(args[i + 1]);
      opts.routes = JSON.parse(fs.readFileSync(routesFile, "utf8"));
    }
  }
  return opts;
}

async function main() {
  const opts = parseArgs();
  const routes = opts.routes.slice(opts.start, opts.end);
  const results = [];

  console.log("=== OmniRoute Production Probe ===");
  console.log(`Target: ${CONFIG.baseUrl}`);
  console.log(`Routes: ${routes.length}`);
  console.log(`Starting at index: ${opts.start + 1}`);
  console.log("");

  for (let i = 0; i < routes.length; i++) {
    const route = routes[i];
    const index = opts.start + i + 1;
    console.log(
      `Route ${index}/${opts.start + routes.length} (total: ${DEFAULT_ROUTES.length}): ${route}`
    );

    try {
      const result = await probeRoute(route, index);
      results.push(result);
      console.log(`  Classification: ${result.classification}`);
    } catch (e) {
      console.error(`  FATAL ERROR: ${e.message}`);
      results.push({
        route,
        index,
        timestamp: new Date().toISOString(),
        classification: CLASSIFICATIONS.UNRESOLVED,
        error: e.message,
        gates: {},
        raw: {},
      });
    }

    if (i < routes.length - 1) {
      console.log(`  Waiting ${CONFIG.delay}ms...`);
      await new Promise((r) => setTimeout(r, CONFIG.delay));
    }
    console.log("");
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outFile = path.resolve(`scripts/ad-hoc/output/probe-results-${timestamp}.json`);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(results, null, 2));
  console.log(`Results saved to: ${outFile}`);

  console.log("\n=== Summary ===");
  const summary = {};
  for (const r of results) {
    summary[r.classification] = (summary[r.classification] || 0) + 1;
  }
  for (const [k, v] of Object.entries(summary)) {
    console.log(`${k}: ${v}`);
  }

  console.log("\n=== Classification Table ===");
  console.table(
    results.map((r) => ({
      Route: r.route,
      Index: r.index,
      Classification: r.classification,
      G1: r.gates.gate1 || "-",
      G2: r.gates.gate2 || "-",
      G3: r.gates.gate3 || "-",
      G4: r.gates.gate4 || "-",
    }))
  );
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
