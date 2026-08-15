import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * #10225 — combo known-context-overflow must NOT hard-reject a compressible
 * request before OmniRoute's compression pipeline can run.
 *
 * Root cause: getKnownContextOverflow() estimates the RAW body (ceil(serializedChars/4)
 * over the whole Responses input[]) during combo target resolution, before any
 * compression. When every known target limit is below that raw estimate, both call
 * sites (round-robin + target-resolution) convert it into an immediate local 400
 * `context_length_exceeded` with attempted:0 — so chatCore's proactive compression
 * (which can shrink 294133→111529, 62% in the reporter's case) never runs. The only
 * existing bypass (clientManagedResponsesContext) is gated to VERIFIED native Codex
 * clients, so a generic Responses client (e.g. OpenCode) pointed at a codex model
 * still hits the hard gate.
 *
 * Fix: thread a request-scoped `deferContextOverflowWhenCompressible` flag (set when
 * the global compression switch is ON and not API-key opted-out). When set AND at
 * least one target can run compression, getKnownContextOverflow returns null so the
 * request reaches chatCore, whose post-compression enforceOutputTokenBudget becomes
 * the final context gate — a local 400 only if the compressed body still cannot fit.
 */

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-combo-overflow-compress-"));
const ORIGINAL_DATA_DIR = process.env.DATA_DIR;
process.env.DATA_DIR = TEST_DATA_DIR;

const core = await import("../../src/lib/db/core.ts");
const { saveModelsDevCapabilities, clearModelsDevCapabilities } =
  await import("../../src/lib/modelsDevSync.ts");
const { getKnownContextOverflow, handleComboChat } = await import(
  "../../open-sse/services/combo.ts"
);

test.after(() => {
  core.resetDbInstance();
  if (ORIGINAL_DATA_DIR === undefined) {
    delete process.env.DATA_DIR;
  } else {
    process.env.DATA_DIR = ORIGINAL_DATA_DIR;
  }
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

test.beforeEach(() => {
  clearModelsDevCapabilities();
});

function capabilityEntry(limitContext: number | null) {
  return {
    tool_call: true,
    reasoning: false,
    attachment: false,
    structured_output: true,
    temperature: true,
    modalities_input: JSON.stringify(["text"]),
    modalities_output: JSON.stringify(["text"]),
    knowledge_cutoff: null,
    release_date: null,
    last_updated: null,
    status: null,
    family: null,
    open_weights: false,
    limit_context: limitContext,
    limit_input: limitContext,
    limit_output: 4096,
    interleaved_field: null,
  };
}

function target(modelStr: string) {
  return {
    kind: "model" as const,
    stepId: modelStr,
    executionKey: modelStr,
    modelStr,
    provider: modelStr.includes("/") ? modelStr.split("/")[0] : modelStr,
    providerId: null,
    connectionId: null,
    weight: 1,
    label: null,
  };
}

// A generic Responses-API body whose estimate lands near `tokens` tokens (4 chars/token).
// Uses `input:` (not `messages:`) to mirror the OpenCode/Codex Responses surface.
function bigResponsesBody(tokens: number) {
  return { input: [["user", "x".repeat(tokens * 4)]] };
}

const noopLog = { info() {}, warn() {}, error() {}, debug() {} };

test("#10225 getKnownContextOverflow defers the hard overflow when compression is available", () => {
  saveModelsDevCapabilities({ codex: { "gpt-5.6-terra": capabilityEntry(272_000) } });
  const body = bigResponsesBody(275_000);

  // Compression enabled + target can compress -> defer (null).
  assert.equal(
    getKnownContextOverflow([target("codex/gpt-5.6-terra")], body, {
      deferContextOverflowWhenCompressible: true,
    }),
    null,
    "compressible request must defer so chatCore compression can run (#10225)"
  );

  // Compression disabled -> the existing hard overflow is preserved (never lose #7177).
  const hard = getKnownContextOverflow([target("codex/gpt-5.6-terra")], body);
  assert.ok(hard);
  assert.ok(hard.requiredContextTokens > hard.maxKnownContextTokens);

  // Compression enabled but EVERY target is excluded from compression -> keep the hard gate.
  const excluded = getKnownContextOverflow([target("codex/gpt-5.6-terra")], body, {
    deferContextOverflowWhenCompressible: true,
    compressionExclusions: ["gpt-5.6-terra"],
  });
  assert.ok(excluded, "fully-excluded targets must retain the hard preflight");
});

test("#10225 combo does not early-400 a compressible over-limit request when deferral is on", async () => {
  saveModelsDevCapabilities({ codex: { "gpt-5.6-terra": capabilityEntry(272_000) } });
  let dispatches = 0;

  const response = await handleComboChat({
    body: bigResponsesBody(275_000),
    combo: {
      name: "codex-compress-overflow",
      strategy: "priority",
      models: ["codex/gpt-5.6-terra"],
    },
    deferContextOverflowWhenCompressible: true,
    clientManagedResponsesContext: false,
    isModelAvailable: async () => true,
    handleSingleModel: async () => {
      dispatches += 1;
      return new Response("ok", { status: 200 });
    },
    log: noopLog,
  });

  assert.notEqual(response.status, 400, "compression-enabled request must reach chatCore");
  assert.equal(dispatches, 1, "must dispatch so chatCore compaction runs first");
});

test("#10225 combo keeps the fast 400 when compression is disabled", async () => {
  saveModelsDevCapabilities({ codex: { "gpt-5.6-terra": capabilityEntry(272_000) } });
  let dispatches = 0;

  const response = await handleComboChat({
    body: bigResponsesBody(275_000),
    combo: {
      name: "codex-compress-disabled",
      strategy: "priority",
      models: ["codex/gpt-5.6-terra"],
    },
    deferContextOverflowWhenCompressible: false,
    clientManagedResponsesContext: false,
    isModelAvailable: async () => true,
    handleSingleModel: async () => {
      dispatches += 1;
      return new Response("ok", { status: 200 });
    },
    log: noopLog,
  });

  assert.equal(response.status, 400);
  assert.equal(dispatches, 0, "#7177 anti-exhaustion guard must survive when compression is off");
  const body = await response.json();
  assert.equal(body.error.code, "context_length_exceeded");
});
