import { test } from "node:test";
import assert from "node:assert/strict";

const {
  buildStreamingResponseHeaders,
  resetDroppedHeadersWarningCache,
} = await import("@omniroute/open-sse/handlers/chatCore/responseHeaders.ts");

/**
 * #10315 regression guard — warn storm on the forwarded-header drop path.
 *
 * Root cause: `buildStreamingResponseHeaders` unconditionally emits a structured
 * `warn` (up to 20 {name,bytes} entries) on EVERY response that drops any header
 * past the forwarding budget. No dedupe/sample. Under multi-stream Desktop flows
 * a chronic over-budget response set buries real errors and adds serialize/log
 * I/O per response.
 *
 * Fix: warn once per process per sorted-dropped-name fingerprint, then degrade
 * to `debug` for repeats of the same dropped set. Distinct dropped sets still
 * each warn once.
 */
function makeLog() {
  const warns: unknown[][] = [];
  const debugs: unknown[][] = [];
  return {
    log: {
      warn: (...args: unknown[]) => warns.push(args),
      debug: (...args: unknown[]) => debugs.push(args),
    },
    warns,
    debugs,
  };
}

function oversizedSet(prefix: string): Headers {
  const headers = new Headers({ "x-request-id": `req-${prefix}` });
  for (let index = 0; index < 24; index += 1) {
    headers.set(`${prefix}-${index.toString().padStart(2, "0")}`, "x".repeat(69));
  }
  return headers;
}

test("#10315: 100 identical oversized responses produce exactly 1 warn then debug", () => {
  resetDroppedHeadersWarningCache();
  const { log, warns, debugs } = makeLog();
  const oversized = oversizedSet("x-big-header");
  for (let index = 0; index < 100; index += 1) {
    buildStreamingResponseHeaders(oversized, { provider: "codex", model: "gpt-5-codex" }, log);
  }
  // Only the first occurrence of this dropped-name set may warn.
  assert.equal(
    warns.length,
    1,
    "expected exactly 1 warn across 100 identical drops, got " + warns.length
  );
  // Every subsequent identical drop must be a debug (or at least not a warn).
  assert.ok(
    debugs.length >= 99,
    "expected repeats to degrade to debug, got " + debugs.length + " debug entries"
  );
});

test("#10315: two distinct dropped sets each warn once even when repeated", () => {
  resetDroppedHeadersWarningCache();
  const { log, warns } = makeLog();
  const setA = oversizedSet("x-big-header-a");
  const setB = oversizedSet("x-big-header-b");
  for (let index = 0; index < 2; index += 1) {
    buildStreamingResponseHeaders(setA, { provider: "codex", model: "gpt-5-codex" }, log);
    buildStreamingResponseHeaders(setB, { provider: "codex", model: "gpt-5-codex" }, log);
  }
  assert.equal(
    warns.length,
    2,
    "expected 1 warn per distinct dropped set (A and B), got " + warns.length
  );
});