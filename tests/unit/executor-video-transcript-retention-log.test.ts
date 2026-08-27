import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import type { ExecutorLog } from "../../open-sse/executors/base.ts";
import { createExecutorRetentionLog } from "../../open-sse/handlers/chatCore/executorRetentionLog.ts";

const TRANSCRIPT_SENTINEL = "PRIVATE_EXECUTOR_DIAGNOSTIC_TRANSCRIPT_SENTINEL";

test("sensitive executor logs retain only a constant marker and discard metadata", () => {
  const entries: Array<{ level: string; tag: string; message: string; data?: unknown }> = [];
  const rawLog: ExecutorLog = {
    debug: (tag, message, data) => entries.push({ level: "debug", tag, message, data }),
    info: (tag, message, data) => entries.push({ level: "info", tag, message, data }),
    warn: (tag, message, data) => entries.push({ level: "warn", tag, message, data }),
    error: (tag, message, data) => entries.push({ level: "error", tag, message, data }),
  };
  const retainedLog = createExecutorRetentionLog(rawLog, true);
  assert.ok(retainedLog);

  for (const level of ["debug", "info", "warn", "error"] as const) {
    retainedLog[level]?.("DEEPSEEK-WEB", `DeepSeek error: ${TRANSCRIPT_SENTINEL}`, {
      upstream: TRANSCRIPT_SENTINEL,
    });
  }

  assert.equal(entries.length, 4);
  for (const entry of entries) {
    assert.equal(entry.tag, "DEEPSEEK-WEB");
    assert.equal(entry.message, "[omitted: video transcript]");
    assert.equal(entry.data, undefined);
    assert.equal(JSON.stringify(entry).includes(TRANSCRIPT_SENTINEL), false);
  }
});

test("ordinary executor logs preserve their original logger and diagnostic", () => {
  const messages: string[] = [];
  const rawLog: ExecutorLog = {
    warn: (_tag, message) => messages.push(message),
  };

  const retainedLog = createExecutorRetentionLog(rawLog, false);
  assert.equal(retainedLog, rawLog);
  retainedLog?.warn?.("DEEPSEEK-WEB", "ordinary upstream diagnostic");
  assert.deepEqual(messages, ["ordinary upstream diagnostic"]);
});

test("every chatCore executor dispatch receives the retention-boundary logger", () => {
  const source = fs.readFileSync("open-sse/handlers/chatCore.ts", "utf8");
  const callMarker = "executor.execute({";
  let offset = 0;
  let calls = 0;

  while (true) {
    const start = source.indexOf(callMarker, offset);
    if (start === -1) break;
    calls += 1;
    assert.match(
      source.slice(start, start + 900),
      /\n\s+log: retainedExecutorLog,/,
      `executor dispatch ${calls} must not receive the raw request logger`
    );
    offset = start + callMarker.length;
  }

  assert.equal(calls, 3);
});
