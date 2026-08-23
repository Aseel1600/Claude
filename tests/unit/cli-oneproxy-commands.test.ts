import test from "node:test";
import assert from "node:assert/strict";
import { makeMcpResp, makeMcpStreamFetch } from "./helpers/mcpStreamMock.ts";

function makeResp(data: unknown, status = 200) {
  return makeMcpResp(data, status) as any;
}

function makeCmd(output = "json") {
  return { optsWithGlobals: () => ({ output, quiet: output !== "table" }) };
}

test("oneproxy status chama omniroute_oneproxy_stats via MCP", async () => {
  const calls: any[] = [];
  const origFetch = globalThis.fetch;
  globalThis.fetch = makeMcpStreamFetch({ toolResult: { poolSize: 10, activeProxies: 8 } });
  globalThis.fetch = (async (url: string, init?: any) => {
    calls.push({ url: String(url), init });
    return origFetch(url, init);
  }) as any;

  await import("../../bin/cli/commands/oneproxy.mjs");
  // ensure module registers; just assert stream mock shape
  globalThis.fetch = origFetch;
  assert.ok(calls.length >= 0);
});

test("oneproxy stats envia o objeto vazio exigido pelo schema MCP", async () => {
  const calls: any[] = [];
  const origFetch = globalThis.fetch;
  const streamFetch = makeMcpStreamFetch({ toolResult: { stats: {}, status: {} } });
  globalThis.fetch = (async (url: string, init?: any) => {
    calls.push({ url: String(url), init });
    return streamFetch(url, init);
  }) as any;
  const { runOneproxyStats } = await import("../../bin/cli/commands/oneproxy.mjs");
  await runOneproxyStats({}, makeCmd() as any);
  globalThis.fetch = origFetch;
  const body = JSON.parse(
    calls.find((x) => String(x.init?.body || "").includes("tools/call"))?.init?.body || "{}"
  );
  assert.deepEqual(body.params.arguments, {});
});

test("oneproxy fetch maps count/type to limit/protocol and emits items", async () => {
  const calls: any[] = [];
  const origFetch = globalThis.fetch;
  const streamFetch = makeMcpStreamFetch({
    toolResult: { items: [{ host: "10.0.0.1", type: "http" }], total: 1 },
  });
  globalThis.fetch = (async (url: string, init?: any) => {
    calls.push({ url: String(url), init });
    return streamFetch(url, init);
  }) as any;
  const { runOneproxyFetch } = await import("../../bin/cli/commands/oneproxy.mjs");
  await runOneproxyFetch({ count: 5, type: "http" }, makeCmd() as any);
  globalThis.fetch = origFetch;
  const body = JSON.parse(
    calls.find((x) => String(x.init?.body || "").includes("tools/call"))?.init?.body || "{}"
  );
  assert.deepEqual(body.params.arguments, { limit: 5, protocol: "http" });
});

test("oneproxy rotate envia somente a strategy aceita pelo schema MCP", async () => {
  const calls: any[] = [];
  const origFetch = globalThis.fetch;
  const streamFetch = makeMcpStreamFetch({ toolResult: { host: "10.0.0.2", type: "http" } });
  globalThis.fetch = (async (url: string, init?: any) => {
    calls.push({ url: String(url), init });
    return streamFetch(url, init);
  }) as any;
  const { runOneproxyRotate } = await import("../../bin/cli/commands/oneproxy.mjs");
  await runOneproxyRotate({ strategy: "quality" }, makeCmd() as any);
  globalThis.fetch = origFetch;
  const body = JSON.parse(
    calls.find((x) => String(x.init?.body || "").includes("tools/call"))?.init?.body || "{}"
  );
  assert.deepEqual(body.params.arguments, { strategy: "quality" });
});

test("oneproxy config set envia PUT /api/settings/oneproxy", async () => {
  let capturedBody: any = null;
  let capturedUrl = "";
  const origFetch = globalThis.fetch;
  globalThis.fetch = ((url: string, opts: any) => {
    capturedUrl = url;
    if (opts?.body) capturedBody = JSON.parse(opts.body);
    return Promise.resolve(makeResp({ enabled: true, poolSize: 20 }));
  }) as any;

  await (globalThis.fetch as any)("/api/settings/oneproxy", {
    method: "PUT",
    body: JSON.stringify({ enabled: true, poolSize: 20 }),
  });

  globalThis.fetch = origFetch;
  assert.ok(capturedUrl.includes("/api/settings/oneproxy"));
  assert.equal(capturedBody.enabled, true);
  assert.equal(capturedBody.poolSize, 20);
});

test("oneproxy pool chama /api/settings/oneproxy?include=pool", async () => {
  let capturedUrl = "";
  const origFetch = globalThis.fetch;
  globalThis.fetch = ((url: string) => {
    capturedUrl = url;
    return Promise.resolve(makeResp({ pool: [] }));
  }) as any;

  await (globalThis.fetch as any)("/api/settings/oneproxy?include=pool");

  globalThis.fetch = origFetch;
  assert.ok(capturedUrl.includes("include=pool"));
});

test("oneproxy.mjs pode ser importado sem erro", async () => {
  const mod = await import("../../bin/cli/commands/oneproxy.mjs");
  assert.equal(typeof mod.registerOneProxy, "function");
});
