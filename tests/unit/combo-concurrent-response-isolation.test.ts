/**
 * Concurrent combo response isolation (#concurrent-combo-isolation)
 *
 * Regression test: two concurrent requests targeting the same combo with DIFFERENT
 * payloads must each receive an independent response. Before the fix, the
 * requestDedup service could coalesce concurrent requests with the same hash into
 * a single upstream call, delivering the first caller's response to the other
 * caller when both happened to land on the same provider target at the same time.
 *
 * What this tests
 * ──────────────
 * 1. Two concurrent requests with different prompts each receive their own
 *    unique response (no cross-contamination).
 * 2. The requestDedup `inflight` map stays empty after combo requests complete
 *    (dedup never adds combo calls to the shared in-flight registry).
 * 3. N concurrent requests each receive distinct responses (stress variant).
 *
 * Implementation note: handleComboChat is exercised at the integration level so the
 * full combo → handleSingleModel call chain executes. handleSingleModel is stubbed
 * to return request-payload-echoing responses without touching a real provider.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-concurrent-isolation-"));
const ORIGINAL_DATA_DIR = process.env.DATA_DIR;
process.env.DATA_DIR = TEST_DATA_DIR;

const { handleComboChat } = await import("../../open-sse/services/combo.ts");
const core = await import("../../src/lib/db/core.ts");
const { resetAllComboMetrics } = await import("../../open-sse/services/comboMetrics.ts");
const { resetAllCircuitBreakers } = await import("../../src/shared/utils/circuitBreaker.ts");
const { resetAll: resetAllSemaphores } =
  await import("../../open-sse/services/rateLimitSemaphore.ts");
const { _resetAllDecks } = await import("../../src/shared/utils/shuffleDeck.ts");
const { clearSessions } = await import("../../open-sse/services/sessionManager.ts");
const { getInflightCount, clearInflight } = await import("../../open-sse/services/requestDedup.ts");

// ─── Helpers ────────────────────────────────────────────────────────────────

function createLog() {
  const entries: unknown[] = [];
  const push =
    (level: string) =>
    (tag: unknown, msg: unknown, ...rest: unknown[]) =>
      entries.push({ level, tag, msg, rest });
  return {
    info: push("info"),
    warn: push("warn"),
    error: push("error"),
    debug: push("debug"),
    entries,
  };
}

/** Build a minimal combo with a single target for isolation tests. */
function makeCombo(name: string, strategy = "priority") {
  return {
    name,
    strategy,
    models: ["openai/gpt-4o-mini"],
    config: { maxRetries: 0, retryDelayMs: 0, fallbackDelayMs: 0 },
  };
}

/**
 * A handleSingleModel stub that echoes the prompt content from the request body
 * back in the response, so callers can verify they received their own response.
 */
function makeEchoHandleSingleModel() {
  return async (reqBody: Record<string, unknown>): Promise<Response> => {
    const messages = Array.isArray(reqBody.messages) ? reqBody.messages : [];
    const lastUser = [...messages]
      .reverse()
      .find((m) => m && typeof m === "object" && (m as { role?: string }).role === "user");
    const content =
      lastUser && typeof (lastUser as { content?: unknown }).content === "string"
        ? (lastUser as { content: string }).content
        : "unknown";
    const responseBody = {
      choices: [{ message: { role: "assistant", content: `Echo: ${content}` } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    };
    return new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
}

// ─── Setup / teardown ────────────────────────────────────────────────────────

test.beforeEach(() => {
  resetAllComboMetrics();
  resetAllCircuitBreakers();
  resetAllSemaphores();
  _resetAllDecks();
  clearSessions();
  clearInflight();
});

test.after(() => {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  if (ORIGINAL_DATA_DIR === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = ORIGINAL_DATA_DIR;
});

// ─── Tests ───────────────────────────────────────────────────────────────────

test("concurrent combo requests with different prompts each receive their own response", async () => {
  const combo = makeCombo("iso-basic");
  const handleSingleModel = makeEchoHandleSingleModel();

  const makeRequest = (prompt: string) =>
    handleComboChat({
      body: {
        model: "iso-basic",
        temperature: 0, // temp=0 — the dedup-eligible window
        messages: [{ role: "user", content: prompt }],
      },
      combo,
      handleSingleModel,
      isModelAvailable: async () => true,
      log: createLog(),
      settings: null,
      allCombos: null,
    });

  // Launch concurrently — both in-flight at the same time
  const [resA, resB] = await Promise.all([makeRequest("Prompt-A"), makeRequest("Prompt-B")]);

  assert.ok(resA.ok, `Request A failed with status ${resA.status}`);
  assert.ok(resB.ok, `Request B failed with status ${resB.status}`);

  const bodyA = (await resA.json()) as { choices: Array<{ message: { content: string } }> };
  const bodyB = (await resB.json()) as { choices: Array<{ message: { content: string } }> };

  const contentA = bodyA.choices?.[0]?.message?.content ?? "";
  const contentB = bodyB.choices?.[0]?.message?.content ?? "";

  assert.match(
    contentA,
    /Prompt-A/,
    `Request A received wrong content: "${contentA}" — expected echo of "Prompt-A"`
  );
  assert.match(
    contentB,
    /Prompt-B/,
    `Request B received wrong content: "${contentB}" — expected echo of "Prompt-B"`
  );

  assert.notEqual(
    contentA,
    contentB,
    "Both concurrent requests received the same response — response cross-contamination detected"
  );
});

test("requestDedup inflight map stays empty after combo requests complete", async () => {
  const combo = makeCombo("iso-inflight");
  const handleSingleModel = makeEchoHandleSingleModel();

  await Promise.all([
    handleComboChat({
      body: {
        model: "iso-inflight",
        temperature: 0,
        messages: [{ role: "user", content: "req-1" }],
      },
      combo,
      handleSingleModel,
      isModelAvailable: async () => true,
      log: createLog(),
      settings: null,
      allCombos: null,
    }),
    handleComboChat({
      body: {
        model: "iso-inflight",
        temperature: 0,
        messages: [{ role: "user", content: "req-2" }],
      },
      combo,
      handleSingleModel,
      isModelAvailable: async () => true,
      log: createLog(),
      settings: null,
      allCombos: null,
    }),
  ]);

  assert.equal(
    getInflightCount(),
    0,
    `requestDedup inflight map should be empty after combo requests complete but has ${getInflightCount()} entries — dedup was incorrectly applied to combo calls`
  );
});

test("N concurrent combo requests each receive distinct responses (stress variant)", async () => {
  const N = 5;
  const combo = makeCombo("iso-stress");
  const handleSingleModel = makeEchoHandleSingleModel();

  const promises = Array.from({ length: N }, (_, i) =>
    handleComboChat({
      body: {
        model: "iso-stress",
        temperature: 0,
        messages: [{ role: "user", content: `Stress-Prompt-${i}` }],
      },
      combo,
      handleSingleModel,
      isModelAvailable: async () => true,
      log: createLog(),
      settings: null,
      allCombos: null,
    })
  );

  const responses = await Promise.all(promises);
  const bodies = await Promise.all(
    responses.map(
      async (r) =>
        ((await r.json()) as { choices: Array<{ message: { content: string } }> }).choices?.[0]
          ?.message?.content ?? ""
    )
  );

  // Each response must echo its own prompt
  for (let i = 0; i < N; i++) {
    assert.match(
      bodies[i],
      new RegExp(`Stress-Prompt-${i}`),
      `Request ${i} received content "${bodies[i]}" — expected echo of "Stress-Prompt-${i}"`
    );
  }

  // All responses must be distinct
  const unique = new Set(bodies);
  assert.equal(
    unique.size,
    N,
    `Expected ${N} distinct responses but got ${unique.size}: [${[...unique].join(", ")}]`
  );
});
