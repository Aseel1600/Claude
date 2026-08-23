/**
 * muse-spark (opencode-go) burns its entire output budget on invisible
 * server-side reasoning before emitting any content. With small caller-set
 * budgets the upstream answers 200 with an empty message
 * (`{"message":{"role":"assistant"},"finish_reason":null}` and
 * `completion_tokens == max_tokens`) — chatCore then flags the fake success as
 * "Provider returned empty content" / 502.
 *
 * Verified live 2026-08-23: max_tokens=64 → empty; 100 → empty;
 * 256/512/1024 → content present (reasoning consumed 196–253 of it).
 *
 * Fix: OpencodeExecutor clamps muse-spark* output budgets UP to
 * MUSE_SPARK_MIN_OUTPUT_TOKENS so the reasoning phase can never consume the
 * whole budget. Other models are untouched.
 */
import test from "node:test";
import assert from "node:assert/strict";

const { applyMuseSparkMinOutputTokens, MUSE_SPARK_MIN_OUTPUT_TOKENS } = await import(
  "../../open-sse/executors/opencode.ts"
);

test("RED: muse-spark tiny max_tokens is raised to the floor", () => {
  const body: Record<string, unknown> = { model: "x", max_tokens: 64, messages: [] };
  applyMuseSparkMinOutputTokens("muse-spark-1.2-contributor", body);
  assert.equal(body.max_tokens, MUSE_SPARK_MIN_OUTPUT_TOKENS);
});

test("RED: all muse-spark id variants are covered by the prefix match", () => {
  for (const model of ["muse-spark-1", "muse-spark-1.2", "muse-spark-1.2-contributor"]) {
    const body: Record<string, unknown> = { max_tokens: 100 };
    applyMuseSparkMinOutputTokens(model, body);
    assert.equal(body.max_tokens, MUSE_SPARK_MIN_OUTPUT_TOKENS, model);
  }
});

test("RED: budgets already at or above the floor are untouched", () => {
  const body: Record<string, unknown> = { max_tokens: 4096 };
  applyMuseSparkMinOutputTokens("muse-spark-1.2-contributor", body);
  assert.equal(body.max_tokens, 4096);
});

test("RED: non-muse-spark models are never modified", () => {
  const body: Record<string, unknown> = { max_tokens: 16 };
  applyMuseSparkMinOutputTokens("ox-alpha-free", body);
  assert.equal(body.max_tokens, 16);
});

test("RED: missing/non-numeric max_tokens stays absent (no synthetic budget)", () => {
  const body: Record<string, unknown> = { messages: [] };
  applyMuseSparkMinOutputTokens("muse-spark-1.2-contributor", body);
  assert.equal("max_tokens" in body, false);
});
