import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_HANDLERS, clampPrompt } from "../../../src/memory/distillation/handlers.ts";
import type { DistillationTask } from "../../../src/memory/distillation/store.ts";

function makeTask(over: Partial<DistillationTask>): DistillationTask {
  return {
    id: "t1",
    kind: "L1_extract",
    scope: "scope-A",
    payload: {},
    priority: 0,
    attempt: 0,
    notBefore: 0,
    status: "queued",
    providerHint: null,
    modelHint: null,
    lastError: null,
    version: 1,
    ...over,
  };
}

describe("distillation/handlers — clampPrompt", () => {
  it("returns the original under the cap", () => {
    assert.equal(clampPrompt("hi", 10), "hi");
  });
  it("truncates over-cap strings", () => {
    const out = clampPrompt("a".repeat(20), 5);
    assert.equal(out.length, 5);
  });
});

describe("distillation/handlers — L1_extract", () => {
  it("parses JSON output and exposes fallback evidence", async () => {
    const handler = DEFAULT_HANDLERS.L1_extract;
    let captured: { messages: unknown } | null = null;
    const out = await handler({
      task: makeTask({
        payload: { conversation: "I prefer dark mode and I always drink coffee." },
      }),
      selection: { provider: "p", model: "m" },
      budget: { maxTokens: 1024, maxSteps: 8, maxCalls: 12, maxDepth: 6 },
      callModel: async (args) => {
        captured = args;
        return {
          text: JSON.stringify({ facts: [{ key: "theme", content: "dark mode" }] }),
          promptTokens: 10,
          completionTokens: 5,
        };
      },
    });
    assert.equal(out.ok, true);
    if (out.ok) {
      assert.ok(Array.isArray((out.result.payload as { facts: unknown[] }).facts));
      assert.ok(out.result.fallbackEvidence.length >= 1);
    }
    assert.ok(captured);
  });

  it("returns parse_failed on non-JSON", async () => {
    const handler = DEFAULT_HANDLERS.L1_extract;
    const out = await handler({
      task: makeTask({ payload: { conversation: "anything" } }),
      selection: { provider: "p", model: "m" },
      budget: { maxTokens: 1024, maxSteps: 8, maxCalls: 12, maxDepth: 6 },
      callModel: async () => ({ text: "not json at all", promptTokens: 1, completionTokens: 1 }),
    });
    assert.equal(out.ok, false);
    if (!out.ok) assert.equal(out.error.kind, "parse_failed");
  });
});

describe("distillation/handlers — L2_scene", () => {
  it("parses summary + tags", async () => {
    const handler = DEFAULT_HANDLERS.L2_scene;
    const out = await handler({
      task: makeTask({ kind: "L2_scene", payload: { conversation: "long convo" } }),
      selection: { provider: "p", model: "m" },
      budget: { maxTokens: 1024, maxSteps: 8, maxCalls: 12, maxDepth: 6 },
      callModel: async () => ({
        text: JSON.stringify({ summary: "We talked about dark mode.", tags: ["ui", "prefs"] }),
        promptTokens: 10,
        completionTokens: 5,
      }),
    });
    assert.equal(out.ok, true);
    if (out.ok) {
      const payload = out.result.payload as { summary: string; tags: string[] };
      assert.ok(payload.summary.length > 0);
      assert.deepEqual(payload.tags, ["ui", "prefs"]);
    }
  });
});

describe("distillation/handlers — L3_persona", () => {
  it("returns model_unset when no samples provided", async () => {
    const handler = DEFAULT_HANDLERS.L3_persona;
    const out = await handler({
      task: makeTask({ kind: "L3_persona", payload: { samples: [] } }),
      selection: { provider: "p", model: "m" },
      budget: { maxTokens: 1024, maxSteps: 8, maxCalls: 12, maxDepth: 6 },
      callModel: async () => ({ text: "", promptTokens: 0, completionTokens: 0 }),
    });
    assert.equal(out.ok, false);
    if (!out.ok) assert.equal(out.error.kind, "model_unset");
  });
});

describe("distillation/handlers — L0_chunk_embed", () => {
  it("parses a short summary", async () => {
    const handler = DEFAULT_HANDLERS.L0_chunk_embed;
    const out = await handler({
      task: makeTask({ kind: "L0_chunk_embed", payload: { chunk: "Some long chunk" } }),
      selection: { provider: "p", model: "m" },
      budget: { maxTokens: 1024, maxSteps: 8, maxCalls: 12, maxDepth: 6 },
      callModel: async () => ({
        text: JSON.stringify({ summary: "tiny" }),
        promptTokens: 1,
        completionTokens: 1,
      }),
    });
    assert.equal(out.ok, true);
    if (out.ok) {
      const payload = out.result.payload as { summary: string };
      assert.equal(payload.summary, "tiny");
    }
  });
});
