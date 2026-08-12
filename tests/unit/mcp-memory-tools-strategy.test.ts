/**
 * tests/unit/mcp-memory-tools-strategy.test.ts
 *
 * Hard-cutover — the legacy `omniroute_memory_search` MCP tool is gone; the
 * read surface is now `omniroute_memory_l0_search` / `l1_search` / `l2_read`
 * / `l3_read` / `list`, none of which call `retrieveMemories` directly (they
 * hit the new `/api/memory/*` REST surface). The strategy mapping itself is
 * still tested below — the underlying `toMemoryRetrievalConfig` helper is the
 * public contract used by the chat pipeline (and by anyone wiring a custom
 * adapter on top of the new REST surface).
 */

import test from "node:test";
import assert from "node:assert/strict";

// ── A: toMemoryRetrievalConfig: "hybrid" → retrievalStrategy="hybrid" ─────────

test("toMemoryRetrievalConfig: strategy=hybrid → retrievalStrategy=hybrid", async () => {
  const { toMemoryRetrievalConfig, DEFAULT_MEMORY_SETTINGS } =
    await import("../../src/lib/memory/settings.ts");
  const settings = { ...DEFAULT_MEMORY_SETTINGS, strategy: "hybrid" as const };
  const config = toMemoryRetrievalConfig(settings);
  assert.equal(
    config.retrievalStrategy,
    "hybrid",
    "hybrid strategy must map to retrievalStrategy=hybrid"
  );
});

// ── B: toMemoryRetrievalConfig: "semantic" → retrievalStrategy="semantic" ─────

test("toMemoryRetrievalConfig: strategy=semantic → retrievalStrategy=semantic", async () => {
  const { toMemoryRetrievalConfig, DEFAULT_MEMORY_SETTINGS } =
    await import("../../src/lib/memory/settings.ts");
  const settings = { ...DEFAULT_MEMORY_SETTINGS, strategy: "semantic" as const };
  const config = toMemoryRetrievalConfig(settings);
  assert.equal(
    config.retrievalStrategy,
    "semantic",
    "semantic strategy must map to retrievalStrategy=semantic"
  );
});

// ── C: toMemoryRetrievalConfig: "recent" → retrievalStrategy="exact" ──────────

test("toMemoryRetrievalConfig: strategy=recent → retrievalStrategy=exact (mapped)", async () => {
  const { toMemoryRetrievalConfig, DEFAULT_MEMORY_SETTINGS } =
    await import("../../src/lib/memory/settings.ts");
  const settings = { ...DEFAULT_MEMORY_SETTINGS, strategy: "recent" as const };
  const config = toMemoryRetrievalConfig(settings);
  assert.equal(
    config.retrievalStrategy,
    "exact",
    "recent strategy must map to retrievalStrategy=exact"
  );
});

// ── D: DEFAULT settings map to retrievalStrategy="hybrid" ─────────────────────

test("toMemoryRetrievalConfig: DEFAULT_MEMORY_SETTINGS maps to retrievalStrategy=hybrid", async () => {
  const { toMemoryRetrievalConfig, DEFAULT_MEMORY_SETTINGS } =
    await import("../../src/lib/memory/settings.ts");
  assert.equal(
    DEFAULT_MEMORY_SETTINGS.strategy,
    "hybrid",
    "DEFAULT_MEMORY_SETTINGS.strategy must be 'hybrid'"
  );
  const config = toMemoryRetrievalConfig(DEFAULT_MEMORY_SETTINGS);
  assert.equal(
    config.retrievalStrategy,
    "hybrid",
    "default settings must map to retrievalStrategy=hybrid"
  );
});

// ── E: fallback path — disabled settings with strategy "recent" maps to "exact" ─

test("toMemoryRetrievalConfig: disabled settings with strategy=recent maps to retrievalStrategy=exact", async () => {
  const { toMemoryRetrievalConfig, DEFAULT_MEMORY_SETTINGS } =
    await import("../../src/lib/memory/settings.ts");
  const disabledSettings = { ...DEFAULT_MEMORY_SETTINGS, strategy: "recent" as const };
  const config = toMemoryRetrievalConfig(disabledSettings);
  assert.equal(
    config.retrievalStrategy,
    "exact",
    "fallback from catch path must use retrievalStrategy=exact"
  );
});

// ── F: legacy MCP tool handlers are removed from the cutover surface ────────

test("memoryTools no longer exposes the legacy search/add/clear handlers", async () => {
  const { memoryTools } = await import("../../open-sse/mcp-server/tools/memoryTools.ts");
  for (const legacy of [
    "omniroute_memory_search",
    "omniroute_memory_add",
    "omniroute_memory_clear",
  ]) {
    assert.equal(
      (memoryTools as Record<string, unknown>)[legacy],
      undefined,
      `legacy tool ${legacy} must be removed from memoryTools`
    );
  }
  for (const fresh of [
    "omniroute_memory_l0_search",
    "omniroute_memory_l1_search",
    "omniroute_memory_l2_read",
    "omniroute_memory_l3_read",
    "omniroute_memory_list",
  ]) {
    assert.equal(
      typeof (memoryTools as Record<string, unknown>)[fresh],
      "object",
      `new tool ${fresh} must be present in memoryTools`
    );
  }
});
