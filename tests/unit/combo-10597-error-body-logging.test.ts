/**
 * #10597 — When a combo target fails with a non-2xx status, the per-target
 * "Model X failed, trying next" COMBO log line only carries `{ status }` —
 * the upstream error BODY (e.g. Anthropic's "prompt is too long" or a
 * tool_use/tool_result pairing 400) is captured in `errorText` but never
 * logged, so operators cannot distinguish failure causes from server logs
 * without reproducing the request.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-combo-10597-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.API_KEY_SECRET = process.env.API_KEY_SECRET || "combo-10597-test-secret";

const { handleComboChat } = await import("../../open-sse/services/combo.ts");
const { getEventHistory } = await import("../../src/lib/events/eventBus.ts");

const DISTINCTIVE_ERROR_TEXT =
  "messages.450: `tool_use` ids were found without `tool_result` blocks immediately after";

type WarnCall = { tag: string; msg: string; meta: unknown };
const warnCalls: WarnCall[] = [];
const log = {
  info: () => {},
  debug: () => {},
  error: () => {},
  warn: (tag: string, msg: string, meta?: unknown) => {
    warnCalls.push({ tag, msg, meta });
  },
};

function failing400() {
  return new Response(
    JSON.stringify({
      type: "error",
      error: { type: "invalid_request_error", message: DISTINCTIVE_ERROR_TEXT },
    }),
    { status: 400, headers: { "Content-Type": "application/json" } }
  );
}

function healthy200(model: string) {
  return new Response(
    JSON.stringify({
      id: "ok",
      object: "chat.completion",
      model,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "hello from " + model },
          finish_reason: "stop",
        },
      ],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

function makeCombo(models: string[]) {
  return {
    name: "test-combo-10597",
    strategy: "priority",
    models: models.map((m) => ({ model: m })),
  };
}

test("#10597 COMBO failure log must surface the upstream error body, not just the status code", async () => {
  const modelsCalled: string[] = [];
  const handleSingleModel = async (_body: unknown, modelStr: string) => {
    modelsCalled.push(modelStr);
    if (modelsCalled.length === 1) return failing400();
    return healthy200(modelStr);
  };

  const result = await handleComboChat({
    body: { model: "test", messages: [{ role: "user", content: "hi" }] },
    combo: makeCombo(["claude/claude-opus-4-8", "openai/gpt-4o-mini"]),
    handleSingleModel,
    log,
    settings: {},
    allCombos: [],
  });

  assert.equal(result.status, 200);
  assert.equal(modelsCalled.length, 2);

  const failureLog = warnCalls.find(
    (c) =>
      typeof c.msg === "string" &&
      c.msg.includes("claude/claude-opus-4-8") &&
      c.msg.includes("failed")
  );
  assert.ok(failureLog, "expected a COMBO warn log for the failing leg");

  const serialized = JSON.stringify(failureLog);
  assert.ok(
    serialized.includes("tool_use") || serialized.includes(DISTINCTIVE_ERROR_TEXT),
    `expected the upstream error body to appear in the COMBO failure log, but got: ${serialized}`
  );
});

test("transcript-sensitive combo failures omit echoed transcript only from retained logs", async () => {
  const transcriptSentinel = "PRIVATE_COMBO_ERROR_TRANSCRIPT_SENTINEL";
  const localWarnCalls: WarnCall[] = [];
  const modelsCalled: string[] = [];
  const result = await handleComboChat({
    body: { model: "test", messages: [{ role: "user", content: "processed video request" }] },
    combo: makeCombo(["claude/private-video", "openai/private-video-fallback"]),
    handleSingleModel: async (_body: unknown, modelStr: string) => {
      modelsCalled.push(modelStr);
      if (modelsCalled.length === 1) {
        return new Response(JSON.stringify({ error: { message: transcriptSentinel } }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }
      return healthy200(modelStr);
    },
    log: {
      info: () => {},
      debug: () => {},
      error: () => {},
      warn: (tag: string, msg: string, meta?: unknown) => {
        localWarnCalls.push({ tag, msg, meta });
      },
    },
    settings: {},
    allCombos: [],
    videoTranscriptSensitive: true,
  });

  assert.equal(result.status, 200);
  assert.equal(modelsCalled.length, 2);
  const retainedFailure = localWarnCalls.find((call) => call.msg.includes("failed, trying next"));
  assert.ok(retainedFailure);
  const serialized = JSON.stringify(retainedFailure);
  assert.equal(serialized.includes(transcriptSentinel), false);
  assert.match(serialized, /omitted: video transcript/);
});

test("transcript-sensitive round-robin failures omit echoed transcript from retained logs", async () => {
  const transcriptSentinel = "PRIVATE_COMBO_RR_ERROR_TRANSCRIPT_SENTINEL";
  const localWarnCalls: WarnCall[] = [];
  const result = await handleComboChat({
    body: { model: "test", messages: [{ role: "user", content: "processed video request" }] },
    combo: {
      name: "test-combo-10597-private-rr",
      strategy: "round-robin",
      models: [{ model: "claude/private-video-rr" }],
      config: { maxRetries: 0 },
    },
    handleSingleModel: async () =>
      new Response(JSON.stringify({ error: { message: transcriptSentinel } }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }),
    log: {
      info: () => {},
      debug: () => {},
      error: () => {},
      warn: (tag: string, msg: string, meta?: unknown) => {
        localWarnCalls.push({ tag, msg, meta });
      },
    },
    settings: {},
    allCombos: [],
    videoTranscriptSensitive: true,
  });

  assert.equal(result.ok, false);
  const retainedFailure = localWarnCalls.find((call) => call.tag === "COMBO-RR");
  assert.ok(retainedFailure);
  const serialized = JSON.stringify(retainedFailure);
  assert.equal(serialized.includes(transcriptSentinel), false);
  assert.match(serialized, /omitted: video transcript/);
});

test("transcript-sensitive masked-200 quality failures omit transcript from logs and live events", async () => {
  const transcriptSentinel = "PRIVATE_COMBO_QUALITY_TRANSCRIPT_SENTINEL";
  const comboName = "test-combo-10597-private-quality";
  const localWarnCalls: WarnCall[] = [];
  const modelsCalled: string[] = [];
  const result = await handleComboChat({
    body: { model: "test", messages: [{ role: "user", content: "processed video request" }] },
    combo: {
      ...makeCombo(["claude/private-quality", "openai/private-quality-fallback"]),
      name: comboName,
    },
    handleSingleModel: async (_body: unknown, modelStr: string) => {
      modelsCalled.push(modelStr);
      if (modelsCalled.length === 1) {
        return new Response(JSON.stringify({ error: { message: transcriptSentinel } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return healthy200(modelStr);
    },
    log: {
      info: () => {},
      debug: () => {},
      error: () => {},
      warn: (tag: string, msg: string, meta?: unknown) => {
        localWarnCalls.push({ tag, msg, meta });
      },
    },
    settings: {},
    allCombos: [],
    videoTranscriptSensitive: true,
  });

  assert.equal(result.status, 200);
  assert.equal(modelsCalled.length, 2);
  const retainedLogs = JSON.stringify(localWarnCalls);
  assert.equal(retainedLogs.includes(transcriptSentinel), false);
  assert.match(retainedLogs, /omitted: video transcript/);

  const failedEvent = getEventHistory(undefined, 100).find((entry) => {
    if (entry.event !== "combo.target.failed") return false;
    return (entry.payload as { comboName?: string }).comboName === comboName;
  });
  assert.ok(failedEvent, "expected a retained combo.target.failed event for the quality rejection");
  const retainedEvent = JSON.stringify(failedEvent);
  assert.equal(retainedEvent.includes(transcriptSentinel), false);
  assert.match(retainedEvent, /omitted: video transcript/);
});

test("transcript-sensitive round-robin masked-200 failures omit quality echoes from every log", async () => {
  const transcriptSentinel = "PRIVATE_COMBO_RR_QUALITY_TRANSCRIPT_SENTINEL";
  const localWarnCalls: WarnCall[] = [];
  const result = await handleComboChat({
    body: { model: "test", messages: [{ role: "user", content: "processed video request" }] },
    combo: {
      name: "test-combo-10597-private-rr-quality",
      strategy: "round-robin",
      models: [{ model: "claude/private-video-rr-quality" }],
      config: { maxRetries: 0 },
    },
    handleSingleModel: async () =>
      new Response(JSON.stringify({ error: { message: transcriptSentinel } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    log: {
      info: () => {},
      debug: () => {},
      error: () => {},
      warn: (tag: string, msg: string, meta?: unknown) => {
        localWarnCalls.push({ tag, msg, meta });
      },
    },
    settings: {},
    allCombos: [],
    videoTranscriptSensitive: true,
  });

  assert.equal(result.ok, false);
  const retainedLogs = JSON.stringify(localWarnCalls);
  assert.equal(retainedLogs.includes(transcriptSentinel), false);
  assert.match(retainedLogs, /omitted: video transcript/);
});

test("transcript-sensitive terminal logs omit the echo while the functional client error stays intact", async () => {
  const transcriptSentinel = "PRIVATE_COMBO_TERMINAL_TRANSCRIPT_SENTINEL";
  const localWarnCalls: WarnCall[] = [];
  const result = await handleComboChat({
    body: { model: "test", messages: [{ role: "user", content: "processed video request" }] },
    combo: {
      name: "test-combo-10597-private-terminal",
      strategy: "priority",
      models: [{ model: "claude/private-video-terminal" }],
      config: { maxRetries: 0 },
    },
    handleSingleModel: async () =>
      new Response(JSON.stringify({ error: { message: transcriptSentinel } }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }),
    log: {
      info: () => {},
      debug: () => {},
      error: () => {},
      warn: (tag: string, msg: string, meta?: unknown) => {
        localWarnCalls.push({ tag, msg, meta });
      },
    },
    settings: {},
    allCombos: [],
    videoTranscriptSensitive: true,
  });

  assert.equal(result.ok, false);
  assert.match(await result.text(), new RegExp(transcriptSentinel));
  const retainedLogs = JSON.stringify(localWarnCalls);
  assert.equal(retainedLogs.includes(transcriptSentinel), false);
  assert.match(retainedLogs, /omitted: video transcript/);
});
