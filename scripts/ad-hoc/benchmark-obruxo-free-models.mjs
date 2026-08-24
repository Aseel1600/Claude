#!/usr/bin/env node
/**
 * Two-pass latency benchmark for candidate obruxo-free models.
 *
 * Measures HTTP status, time to first streamed data (TTFT), total latency and
 * response text using the same deterministic prompt for every model.
 *
 * Usage:
 *   OMNIROUTE_TOKEN=... node scripts/ad-hoc/benchmark-obruxo-free-models.mjs
 */

import { writeFile } from "node:fs/promises";

const endpoint = process.env.OMNIROUTE_URL ?? "http://127.0.0.1:20131/v1/chat/completions";
const token = process.env.OMNIROUTE_TOKEN;
const timeoutMs = Number(process.env.BENCHMARK_TIMEOUT_MS ?? 90_000);
const pauseMs = Number(process.env.BENCHMARK_PAUSE_MS ?? 750);

if (!token) {
  console.error("OMNIROUTE_TOKEN is required");
  process.exit(1);
}

const models = [
  "nvidia/deepseek-ai/deepseek-v4-flash-0731",
  "deepseek/deepseek-v4-flash",
  "antigravity/gemini-3.6-flash-medium",
  "antigravity/gemini-2.5-flash",
  "antigravity/gemini-3.1-flash-lite",
  "antigravity/gemini-2.5-flash-lite",
  "[VB]-/deepseek-v4-flash",
  "[VB]-/mimo-v2.5",
  "[VB]-/deepseek-v4-flash-0731",
  "cu/auto",
  "ds/deepseek-v4-pro",
  "ds/deepseek-v4-flash",
  "[TCB]/deepseek-v4-pro",
  "[TCB]/deepseek-v4-flash",
  "[TCB]/gemini-3.1-pro-preview",
  "[TCB]/gemini-3-pro-preview",
  "[TCB]/gemini-2.5-flash",
  "[TCB]/mimo-v2.5-pro",
  "[TCB]/glm-5.2",
  "[TCB]/glm-5",
  "[TCB]/minimax-m2.5",
  "gemini/gemini-3.1-flash-lite",
  "gemini/gemini-3.5-flash",
  "[VOID]/gemini-2.5-flash",
  "[VOID]/gemini-3.5-flash",
  "[VOID]/gemini-2.5-pro",
  "[VOID]/gemini-3.1-pro-preview",
  "[VOID]/deepseek-v4-flash",
  "[VOID]/deepseek-v4-flash-0731",
  "[VOID]/deepseek-v4-pro-0813",
  "[VOID]/deepseek-v4-pro",
];

const prompt = "Responda somente com a palavra OK, sem pontuação nem explicação.";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const round = (n) => Math.round(n * 10) / 10;

async function benchmark(model, battery) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();
  let ttft = null;
  let status = null;
  let text = "";
  let error = null;
  let provider = null;
  let resolvedModel = null;
  let cache = null;

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "x-omniroute-no-cache": "true",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0,
        max_tokens: 8,
        stream: true,
      }),
      signal: controller.signal,
    });
    status = response.status;
    provider = response.headers.get("x-omniroute-provider");
    resolvedModel = response.headers.get("x-omniroute-model");
    cache = response.headers.get("x-omniroute-cache");

    if (!response.ok) {
      text = (await response.text()).slice(0, 500);
      error = `HTTP ${response.status}`;
    } else if (response.body) {
      const decoder = new TextDecoder();
      for await (const chunk of response.body) {
        if (ttft === null) ttft = performance.now() - started;
        text += decoder.decode(chunk, { stream: true });
      }
      text += decoder.decode();
    }
  } catch (cause) {
    error =
      cause?.name === "AbortError" ? `timeout ${timeoutMs}ms` : String(cause?.message ?? cause);
  } finally {
    clearTimeout(timer);
  }

  return {
    battery,
    model,
    ok: status === 200 && !error,
    status,
    provider,
    resolvedModel,
    cache,
    ttftMs: ttft === null ? null : round(ttft),
    totalMs: round(performance.now() - started),
    error,
    responsePreview: text.replace(/\s+/g, " ").slice(0, 180),
  };
}

const results = [];
for (let battery = 1; battery <= 2; battery += 1) {
  console.log(`\n=== BATTERY ${battery}/2 ===`);
  for (const [index, model] of models.entries()) {
    const result = await benchmark(model, battery);
    results.push(result);
    console.log(
      `${String(index + 1).padStart(2, "0")}/${models.length} ${model}: ${result.ok ? "OK" : "FAIL"}` +
        ` | TTFT=${result.ttftMs ?? "-"}ms | total=${result.totalMs}ms` +
        ` | upstream=${result.provider ?? "-"}/${result.resolvedModel ?? "-"}` +
        `${result.error ? ` | ${result.error}` : ""}`
    );
    await sleep(pauseMs);
  }
}

const ranking = models
  .map((model) => {
    const attempts = results.filter((result) => result.model === model);
    const successful = attempts.filter((result) => result.ok);
    const average = (key) =>
      successful.length === 0
        ? null
        : round(successful.reduce((sum, result) => sum + result[key], 0) / successful.length);
    return {
      model,
      successes: successful.length,
      attempts: attempts.length,
      avgTtftMs: average("ttftMs"),
      avgTotalMs: average("totalMs"),
      battery1Ms: attempts[0]?.totalMs ?? null,
      battery2Ms: attempts[1]?.totalMs ?? null,
      errors: attempts
        .filter((result) => !result.ok)
        .map((result) => result.error ?? `HTTP ${result.status}`),
    };
  })
  .sort((a, b) => {
    if (a.successes !== b.successes) return b.successes - a.successes;
    return (a.avgTtftMs ?? Infinity) - (b.avgTtftMs ?? Infinity);
  });

const report = {
  generatedAt: new Date().toISOString(),
  endpoint,
  prompt,
  timeoutMs,
  batteries: 2,
  ranking,
  results,
};
const output = process.env.BENCHMARK_OUTPUT ?? "/tmp/obruxo-free-benchmark.json";
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);

console.log("\n=== RANKING (successful runs, then average TTFT) ===");
console.table(ranking);
console.log(`Full report: ${output}`);
