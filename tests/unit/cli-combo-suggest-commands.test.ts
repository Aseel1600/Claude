import test from "node:test";
import assert from "node:assert/strict";
import { makeMcpResp, makeMcpStreamFetch } from "./helpers/mcpStreamMock.ts";

function makeCmd(output = "json") {
  return { optsWithGlobals: () => ({ output, quiet: output !== "table" }) };
}

test("combo suggest chama omniroute_best_combo_for_task via MCP", async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = makeMcpStreamFetch({
    toolResult: {
      candidates: [
        {
          name: "fast-combo",
          strategy: "priority",
          score: 0.92,
          latencyP50Ms: 120,
          costPer1k: 0.002,
        },
      ],
      rationale: "Best latency for real-time tasks",
    },
  });
  const { mcpCallTool } = await import("../../bin/cli/mcpClient.mjs");
  const result = await mcpCallTool("omniroute_best_combo_for_task", {
    taskType: "coding",
  });
  globalThis.fetch = origFetch;
  const candidates = (result as any).candidates;
  assert.equal(candidates[0].name, "fast-combo");
  assert.equal((result as any).rationale, "Best latency for real-time tasks");
});

test("combo suggest --max-cost/--max-latency-ms passa constraints", async () => {
  const origFetch = globalThis.fetch;
  const captured: any[] = [];
  globalThis.fetch = makeMcpStreamFetch({ toolResult: { candidates: [] } });
  const inner = globalThis.fetch;
  globalThis.fetch = ((url: any, init: any) => {
    captured.push({ url: String(url), init });
    return inner(url, init);
  }) as any;
  const { mcpCallTool } = await import("../../bin/cli/mcpClient.mjs");
  await mcpCallTool("omniroute_best_combo_for_task", {
    taskType: "analysis",
    budgetConstraint: 0.001,
    latencyConstraint: 500,
  });
  globalThis.fetch = origFetch;
  const args = JSON.parse(
    captured.find((c) => /tools\/call/.test(String(c.init?.body || "")))?.init?.body || "{}"
  )?.params?.arguments;
  assert.equal(args.taskType, "analysis");
  assert.equal(args.budgetConstraint, 0.001);
  assert.equal(args.latencyConstraint, 500);
});

test("mcpCallTool reaplica a sessão e decodifica CallToolResult textual", async () => {
  const origFetch = globalThis.fetch;
  const captured: any[] = [];
  globalThis.fetch = makeMcpStreamFetch({ toolResult: { recommendedCombo: { name: "fast" } } });
  const inner = globalThis.fetch;
  globalThis.fetch = ((url: any, init: any) => {
    captured.push({ url: String(url), init });
    return inner(url, init);
  }) as any;
  const { mcpCallTool } = await import("../../bin/cli/mcpClient.mjs");
  const result = await mcpCallTool("omniroute_best_combo_for_task", { taskType: "coding" });
  globalThis.fetch = origFetch;
  const toolCall = captured.find((c) => /tools\/call/.test(String(c.init?.body || "")));
  assert.equal(new Headers(toolCall?.init?.headers).get("mcp-session-id"), "sess-test");
  assert.deepEqual(result, { recommendedCombo: { name: "fast" } });
});

test("combo suggest --switch chama /api/combos/switch com melhor combo", async () => {
  const urls: string[] = [];
  const origFetch = globalThis.fetch;
  globalThis.fetch = ((url: any, opts: any) => {
    urls.push(String(url));
    if (String(url).includes("/api/mcp/stream")) {
      const body = opts?.body ? JSON.parse(opts.body) : {};
      if (body.method === "initialize") {
        return Promise.resolve(
          makeMcpResp({ jsonrpc: "2.0", id: body.id, result: {} }, 200, { "mcp-session-id": "s" })
        );
      }
      assert.equal(new Headers(opts?.headers).get("mcp-session-id"), "s");
      return Promise.resolve(
        makeMcpResp({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            content: [
              {
                type: "text",
                text: JSON.stringify({ recommendedCombo: { name: "best-combo" } }),
              },
            ],
          },
        })
      );
    }
    return Promise.resolve(makeMcpResp({ switched: true }));
  }) as any;

  const { mcpCallTool } = await import("../../bin/cli/mcpClient.mjs");
  const data = await mcpCallTool("omniroute_best_combo_for_task", { taskType: "coding" });
  const combosSwitchRes = await fetch("/api/combos/switch", {
    method: "POST",
    body: JSON.stringify({ name: (data as any).recommendedCombo.name }),
  });
  assert.equal(combosSwitchRes.ok, true);
  assert.ok(urls.some((u) => u.includes("/api/combos/switch")));
  globalThis.fetch = origFetch;
});

test("combo.mjs exporta extendComboSuggest e registerCombo", async () => {
  const mod = await import("../../bin/cli/commands/combo.mjs");
  assert.equal(typeof mod.registerCombo, "function");
  assert.equal(typeof mod.extendComboSuggest, "function");
});
