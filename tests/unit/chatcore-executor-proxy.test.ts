// tests/unit/chatcore-executor-proxy.test.ts
// Characterization of resolveExecutorWithProxy — the upstream-proxy executor resolver extracted from
// handleChatCore (chatCore god-file decomposition, #3501). Exercises the REAL config path through a
// temp DB: disabled/native → the provider's own executor; cliproxyapi → the passthrough executor;
// fallback → a distinct wrapper that owns its own execute(). The wrapper's retry behaviour is not
// invoked here (it would hit the network); the existing cliproxyapi-fallback-wiring.test.ts covers
// the surrounding wiring.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "omni-executor-proxy-test-"));
process.env.DATA_DIR = testDataDir;

// Dynamic imports AFTER DATA_DIR is set so core.ts picks up the temp path.
const coreDb = await import("../../src/lib/db/core.ts");
const upstreamProxyDb = await import("../../src/lib/db/upstreamProxy.ts");
const { resolveExecutorWithProxy } =
  await import("../../open-sse/handlers/chatCore/executorProxy.ts");
const { getExecutor } = await import("../../open-sse/executors/index.ts");
const { clearUpstreamProxyConfigCache } =
  await import("../../open-sse/handlers/chatCore/comboContextCache.ts");

before(async () => {
  await coreDb.ensureDbInitialized();
});

beforeEach(() => {
  clearUpstreamProxyConfigCache();
});

after(() => {
  coreDb.resetDbInstance();
  fs.rmSync(testDataDir, { recursive: true, force: true });
});

test("no config (disabled by default) returns the provider's own executor", async () => {
  clearUpstreamProxyConfigCache("openai");
  const exec = await resolveExecutorWithProxy("openai");
  assert.equal(exec, await getExecutor("openai"));
});

test("mode 'native' returns the provider's own executor", async () => {
  await upstreamProxyDb.upsertUpstreamProxyConfig({
    providerId: "openai",
    mode: "native",
    enabled: true,
  });
  clearUpstreamProxyConfigCache("openai");
  const exec = await resolveExecutorWithProxy("openai");
  assert.equal(exec, await getExecutor("openai"));
});

test("mode 'cliproxyapi' returns the CLIProxyAPI passthrough executor", async () => {
  await upstreamProxyDb.upsertUpstreamProxyConfig({
    providerId: "anthropic",
    mode: "cliproxyapi",
    enabled: true,
  });
  clearUpstreamProxyConfigCache("anthropic");
  const exec = await resolveExecutorWithProxy("anthropic");
  assert.equal(exec, await getExecutor("cliproxyapi"));
});

test("mode 'fallback' returns a distinct wrapper owning its own execute()", async () => {
  await upstreamProxyDb.upsertUpstreamProxyConfig({
    providerId: "openai",
    mode: "fallback",
    enabled: true,
  });
  clearUpstreamProxyConfigCache("openai");
  const exec = await resolveExecutorWithProxy("openai");
  assert.notEqual(exec, await getExecutor("openai"));
  assert.notEqual(exec, await getExecutor("cliproxyapi"));
  assert.equal(typeof exec.execute, "function");
});

// === Per-connection routing override (#6339) ===
// The resolved connection's providerSpecificData.cliproxyapiMode === "claude-native"
// opts THIS connection into the CLIProxyAPI executor regardless of the provider-level
// upstream_proxy_config mode. Precedence: connection override > provider mode > default.

test("connection override 'claude-native' selects CLIProxyAPI even when provider mode is native", async () => {
  await upstreamProxyDb.upsertUpstreamProxyConfig({
    providerId: "openai",
    mode: "native",
    enabled: true,
  });
  clearUpstreamProxyConfigCache("openai");
  const exec = await resolveExecutorWithProxy("openai", undefined, {
    cliproxyapiMode: "claude-native",
  });
  assert.equal(exec, await getExecutor("cliproxyapi"));
});

test("connection override 'claude-native' selects CLIProxyAPI even with no provider config (default)", async () => {
  clearUpstreamProxyConfigCache("anthropic");
  const exec = await resolveExecutorWithProxy("anthropic", undefined, {
    cliproxyapiMode: "claude-native",
  });
  assert.equal(exec, await getExecutor("cliproxyapi"));
});

test("no connection override + provider mode native → native executor (unchanged)", async () => {
  await upstreamProxyDb.upsertUpstreamProxyConfig({
    providerId: "openai",
    mode: "native",
    enabled: true,
  });
  clearUpstreamProxyConfigCache("openai");
  const exec = await resolveExecutorWithProxy("openai", undefined, {
    someOtherField: "x",
  });
  assert.equal(exec, await getExecutor("openai"));
});

test("connection override absent (undefined providerSpecificData) preserves default behaviour", async () => {
  clearUpstreamProxyConfigCache("openai");
  const exec = await resolveExecutorWithProxy("openai");
  assert.equal(exec, await getExecutor("openai"));
});

test("connection override wins over provider mode 'fallback'", async () => {
  await upstreamProxyDb.upsertUpstreamProxyConfig({
    providerId: "openai",
    mode: "fallback",
    enabled: true,
  });
  clearUpstreamProxyConfigCache("openai");
  const exec = await resolveExecutorWithProxy("openai", undefined, {
    cliproxyapiMode: "claude-native",
  });
  // Connection override short-circuits to the passthrough executor, not the fallback wrapper.
  assert.equal(exec, await getExecutor("cliproxyapi"));
});

test("fallback diagnostics omit transcript echoes while preserving operational errors", async () => {
  const nativeSentinel = "PRIVATE_NATIVE_VIDEO_TRANSCRIPT_SENTINEL";
  const thrownFallbackSentinel = "PRIVATE_THROWN_FALLBACK_VIDEO_TRANSCRIPT_SENTINEL";
  const statusFallbackSentinel = "PRIVATE_STATUS_FALLBACK_VIDEO_TRANSCRIPT_SENTINEL";
  const retainedLogs: string[] = [];
  const log = {
    info: (...args: unknown[]) => retainedLogs.push(args.map(String).join(" ")),
    error: (...args: unknown[]) => retainedLogs.push(args.map(String).join(" ")),
  };

  await upstreamProxyDb.upsertUpstreamProxyConfig({
    providerId: "openai",
    mode: "fallback",
    enabled: true,
  });
  clearUpstreamProxyConfigCache("openai");

  const nativeExecutor = await getExecutor("openai");
  const fallbackExecutor = await getExecutor("cliproxyapi");
  const originalNativeExecute = nativeExecutor.execute;
  const originalFallbackExecute = fallbackExecutor.execute;
  const input = {
    model: "video-model",
    body: { messages: [{ role: "user", content: "describe the video" }] },
    stream: false,
    credentials: { apiKey: "test-key" },
    videoTranscriptSensitive: true,
  };

  try {
    nativeExecutor.execute = async () => {
      throw new Error(nativeSentinel);
    };
    fallbackExecutor.execute = async () => {
      throw new Error(thrownFallbackSentinel);
    };

    const thrownWrapper = await resolveExecutorWithProxy("openai", log);
    await assert.rejects(thrownWrapper.execute(input), new RegExp(thrownFallbackSentinel));

    nativeExecutor.execute = async () => ({
      response: new Response("retryable", { status: 500 }),
      url: "https://native.example.test/v1/chat/completions",
      headers: {},
      transformedBody: input.body,
    });
    fallbackExecutor.execute = async () => {
      throw new Error(statusFallbackSentinel);
    };

    const statusWrapper = await resolveExecutorWithProxy("openai", log);
    await assert.rejects(statusWrapper.execute(input), new RegExp(statusFallbackSentinel));

    const retained = retainedLogs.join("\n");
    for (const sentinel of [nativeSentinel, thrownFallbackSentinel, statusFallbackSentinel]) {
      assert.doesNotMatch(retained, new RegExp(sentinel));
    }
    assert.match(retained, /omitted: video transcript/);
  } finally {
    nativeExecutor.execute = originalNativeExecute;
    fallbackExecutor.execute = originalFallbackExecute;
    clearUpstreamProxyConfigCache("openai");
  }
});
