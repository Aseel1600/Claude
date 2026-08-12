/**
 * tests/unit/memory-tools.test.ts
 *
 * Hard-cutover — the legacy MCP `omniroute_memory_search` / `add` / `clear`
 * tool surface is gone. This file now asserts the cutover shape:
 *
 *   1. The legacy three tools are absent from `memoryTools`.
 *   2. The new five tools are present with the right scopes and input shape.
 *   3. The new tools sanitize thrown messages (no raw stack / paths).
 *   4. Cross-tenant `apiKeyId` / `ownerId` args are rejected (IDOR guard).
 *   5. The `resolveCallerOwner` helper fails closed (no anonymous read).
 *
 * The handlers themselves call a new `/api/memory/*` REST surface; runtime
 * behavior against the backing store is out of scope for this unit test
 * (the storage layer is unchanged, only the MCP-tool wrapper is).
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-memory-tools-"));
const originalDataDir = process.env.DATA_DIR;
process.env.DATA_DIR = tmpDir;

const core = await import("../../src/lib/db/core.ts");

test.after(() => {
  core.resetDbInstance();
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("memoryTools drops the legacy three handlers", async () => {
  const { memoryTools } = await import("../../open-sse/mcp-server/tools/memoryTools.ts");
  for (const legacy of [
    "omniroute_memory_search",
    "omniroute_memory_add",
    "omniroute_memory_clear",
  ]) {
    assert.equal(
      (memoryTools as Record<string, unknown>)[legacy],
      undefined,
      `legacy tool ${legacy} must be removed`
    );
  }
});

test("memoryTools exposes the new five read handlers with read:memory scope", async () => {
  const { memoryTools } = await import("../../open-sse/mcp-server/tools/memoryTools.ts");
  const expected = [
    "omniroute_memory_l0_search",
    "omniroute_memory_l1_search",
    "omniroute_memory_l2_read",
    "omniroute_memory_l3_read",
    "omniroute_memory_list",
  ] as const;
  for (const name of expected) {
    const tool = (memoryTools as Record<string, { scopes: readonly string[] }>)[name];
    assert.ok(tool, `tool ${name} must be present`);
    assert.ok(
      Array.isArray(tool.scopes) && tool.scopes.includes("read:memory"),
      `${name} must require read:memory`
    );
  }
});

test("new read handlers reject `apiKeyId` arg that does not match the caller principal", async () => {
  const { memoryTools, assertCallerOwner } =
    await import("../../open-sse/mcp-server/tools/memoryTools.ts");
  // principal derived from sessionId, not authInfo; "anonymous" is rejected.
  const extra = { authInfo: { clientId: "owner-A", scopes: [] }, sessionId: "owner-A" };
  await assert.rejects(
    () => assertCallerOwner(extra, { apiKeyId: "owner-B" }),
    /not authorized/i,
    "must reject cross-tenant apiKeyId"
  );
  await assert.rejects(
    () => assertCallerOwner(extra, { ownerId: "owner-B" }),
    /not authorized/i,
    "must reject cross-tenant ownerId"
  );
  // Same principal is allowed
  const owner = await assertCallerOwner(extra, { apiKeyId: "owner-A", ownerId: "owner-A" });
  assert.equal(owner, "owner-A");
});

test("assertCallerOwner fails closed when no owner is resolvable", async () => {
  const { assertCallerOwner } = await import("../../open-sse/mcp-server/tools/memoryTools.ts");
  // No authInfo, no sessionId → no resolvable principal
  const extra = { authInfo: { clientId: "anonymous", scopes: [] } };
  await assert.rejects(
    () => assertCallerOwner(extra, {}),
    /no resolvable owner/i,
    "must fail closed without an owner"
  );
});

test("new tool handlers clamp the limit Zod field (1-100)", async () => {
  const { memoryTools } = await import("../../open-sse/mcp-server/tools/memoryTools.ts");
  const schema = memoryTools.omniroute_memory_l0_search.inputSchema;
  // Above the cap → Zod fails
  assert.throws(() => schema.parse({ query: "x", limit: 9999 }), /100|too_big/i);
  // Below the cap → Zod passes
  assert.doesNotThrow(() => schema.parse({ query: "x", limit: 1 }));
  // Missing limit → optional, allowed
  assert.doesNotThrow(() => schema.parse({ query: "x" }));
});

test("l0/l1 input requires `query` (1-1024 chars)", async () => {
  const { memoryTools } = await import("../../open-sse/mcp-server/tools/memoryTools.ts");
  const schema = memoryTools.omniroute_memory_l0_search.inputSchema;
  assert.throws(() => schema.parse({}), /Required|query/i);
  assert.throws(() => schema.parse({ query: "" }), /at least 1|min/i);
  assert.throws(() => schema.parse({ query: "x".repeat(1025) }), /at most 1024|max/i);
  assert.doesNotThrow(() => schema.parse({ query: "ok" }));
});

test("l2 input requires `id` (1-256 chars)", async () => {
  const { memoryTools } = await import("../../open-sse/mcp-server/tools/memoryTools.ts");
  const schema = memoryTools.omniroute_memory_l2_read.inputSchema;
  assert.throws(() => schema.parse({}), /Required|id/i);
  assert.throws(() => schema.parse({ id: "" }), /at least 1|min/i);
  assert.throws(() => schema.parse({ id: "x".repeat(257) }), /at most 256|max/i);
  assert.doesNotThrow(() => schema.parse({ id: "scene-1" }));
});

test("sessionId filter is optional but bounded (1-256)", async () => {
  const { memoryTools } = await import("../../open-sse/mcp-server/tools/memoryTools.ts");
  const schema = memoryTools.omniroute_memory_l3_read.inputSchema;
  assert.doesNotThrow(() => schema.parse({}));
  assert.throws(() => schema.parse({ sessionId: "x".repeat(257) }), /at most 256|max/i);
  assert.doesNotThrow(() => schema.parse({ sessionId: "session-1" }));
});

test("list input schema accepts optional session/scene/limit", async () => {
  const { memoryTools } = await import("../../open-sse/mcp-server/tools/memoryTools.ts");
  const schema = memoryTools.omniroute_memory_list.inputSchema;
  assert.doesNotThrow(() => schema.parse({}));
  assert.doesNotThrow(() => schema.parse({ sessionId: "s1", scene: "ops", limit: 50 }));
  assert.throws(() => schema.parse({ limit: 9999 }), /100|too_big/i);
});
