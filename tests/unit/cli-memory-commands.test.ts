/**
 * tests/unit/cli-memory-commands.test.ts
 *
 * Hard-cutover CLI memory surface — four-layer verbs only.
 *
 * Cases:
 *   A) runL0Search posts to /api/memory/l0/search with q + limit
 *   B) runL1Search posts to /api/memory/l1/search
 *   C) runL2Read fetches /api/memory/l2/:id
 *   D) runL3Read fetches /api/memory/l3 (optionally with sessionId)
 *   E) runMemoryList fetches /api/memory/list
 *   F) runSettingsGet fetches /api/memory/settings
 *   G) runSettingsSet PUTs to /api/memory/settings
 *   H) runSettingsReset POSTs to /api/memory/settings
 *   I) runDistilStatus fetches /api/memory/distil/status
 *   J) runDistilRetryDlq POSTs to /api/memory/distil/retry-dlq (gated by --yes)
 *   K) legacy exports (runMemorySearch, runMemoryAdd, runMemoryClear,
 *      runMemoryList, runMemoryGet, runMemoryDelete, runMemoryHealth) are
 *      removed.
 */

import test from "node:test";
import assert from "node:assert/strict";

const L0_ITEMS = [
  {
    id: "m_l0_1",
    sessionId: "s1",
    scene: "dev",
    content: "L0 vector hit",
    score: 0.91,
    createdAt: "2026-05-10T10:00:00Z",
  },
];

const L1_ITEMS = [
  {
    id: "m_l1_1",
    sessionId: "s1",
    scene: "ops",
    content: "L1 fts hit",
    score: 0.5,
    createdAt: "2026-05-09T10:00:00Z",
  },
];

const L2_SCENE = { id: "scene_x", content: "scene payload", createdAt: "2026-05-09T10:00:00Z" };
const L3_PERSONA = { id: "persona", sessionId: "s1", persona: { content: "persona body" } };
const LIST_PAYLOAD = {
  layers: { L0: 1, L1: 1, L2: 1, L3: 1 },
  items: [
    { layer: "L0", id: "a", sessionId: "s", scene: "x", content: "l0" },
    { layer: "L1", id: "b", sessionId: "s", scene: "x", content: "l1" },
    { layer: "L2", id: "c", sessionId: "s", scene: "x", content: "l2" },
    { layer: "L3", id: "d", sessionId: "s", scene: "x", content: "l3" },
  ],
};
const SETTINGS_PAYLOAD = { strategy: "hybrid", maxTokens: 4000 };
const DISTIL_PAYLOAD = {
  items: [
    {
      id: "d1",
      status: "failed",
      attempts: 3,
      lastError: "boom",
      updatedAt: "2026-05-10T10:00:00Z",
    },
  ],
};

function makeResp(data: unknown, status = 200) {
  const obj = {
    ok: status < 400,
    status,
    headers: new Headers(),
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  };
  return obj as unknown as Response;
}

async function captureStdout(fn: () => Promise<void>): Promise<string> {
  const chunks: string[] = [];
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = (c: string | Uint8Array) => {
    if (typeof c === "string") chunks.push(c);
    return true;
  };
  try {
    await fn();
  } finally {
    process.stdout.write = orig;
  }
  return chunks.join("");
}

function makeCmd(output = "json") {
  return { optsWithGlobals: () => ({ output, quiet: output !== "table" }) };
}

function installFetch(impl: (url: string, init?: unknown) => Promise<Response>) {
  const orig = globalThis.fetch;
  globalThis.fetch = impl as unknown as typeof fetch;
  return () => {
    globalThis.fetch = orig;
  };
}

// ── A: runL0Search — URL + params + JSON items ─────────────────────────────

test("runL0Search calls GET /api/memory/l0/search?q=...&limit=...", async () => {
  let capturedUrl = "";
  const restore = installFetch((url) => {
    capturedUrl = String(url);
    return Promise.resolve(makeResp({ items: L0_ITEMS }));
  });
  try {
    const { runL0Search } = await import("../../bin/cli/commands/memory.mjs");
    const out = await captureStdout(() =>
      runL0Search("vector query", { limit: "10" }, makeCmd() as never)
    );
    const parsed = JSON.parse(out);
    assert.ok(Array.isArray(parsed));
    assert.equal(parsed[0].id, "m_l0_1");
    assert.ok(capturedUrl.includes("/api/memory/l0/search"));
    assert.ok(capturedUrl.includes("q=vector"));
    assert.ok(capturedUrl.includes("limit=10"));
  } finally {
    restore();
  }
});

// ── B: runL1Search — URL + params ────────────────────────────────────────

test("runL1Search calls GET /api/memory/l1/search?q=...&scene=...", async () => {
  let capturedUrl = "";
  const restore = installFetch((url) => {
    capturedUrl = String(url);
    return Promise.resolve(makeResp({ items: L1_ITEMS }));
  });
  try {
    const { runL1Search } = await import("../../bin/cli/commands/memory.mjs");
    await captureStdout(() =>
      runL1Search("fts query", { limit: "5", scene: "ops" }, makeCmd() as never)
    );
    assert.ok(capturedUrl.includes("/api/memory/l1/search"));
    assert.ok(capturedUrl.includes("q=fts"));
    assert.ok(capturedUrl.includes("scene=ops"));
  } finally {
    restore();
  }
});

// ── C: runL2Read — /api/memory/l2/:id ─────────────────────────────────────

test("runL2Read calls GET /api/memory/l2/:id", async () => {
  let capturedUrl = "";
  const restore = installFetch((url) => {
    capturedUrl = String(url);
    return Promise.resolve(makeResp(L2_SCENE));
  });
  try {
    const { runL2Read } = await import("../../bin/cli/commands/memory.mjs");
    await captureStdout(() => runL2Read("scene_x", {}, makeCmd() as never));
    assert.ok(capturedUrl.includes("/api/memory/l2/scene_x"));
  } finally {
    restore();
  }
});

// ── D: runL3Read — /api/memory/l3 ─────────────────────────────────────────

test("runL3Read calls GET /api/memory/l3 (optionally with sessionId)", async () => {
  let capturedUrl = "";
  const restore = installFetch((url) => {
    capturedUrl = String(url);
    return Promise.resolve(makeResp(L3_PERSONA));
  });
  try {
    const { runL3Read } = await import("../../bin/cli/commands/memory.mjs");
    await captureStdout(() => runL3Read({ session: "s1" }, makeCmd() as never));
    assert.ok(capturedUrl.includes("/api/memory/l3"));
    assert.ok(capturedUrl.includes("sessionId=s1"));
  } finally {
    restore();
  }
});

// ── E: runMemoryList — /api/memory/list ───────────────────────────────────

test("runMemoryList calls GET /api/memory/list", async () => {
  let capturedUrl = "";
  const restore = installFetch((url) => {
    capturedUrl = String(url);
    return Promise.resolve(makeResp(LIST_PAYLOAD));
  });
  try {
    const { runMemoryList } = await import("../../bin/cli/commands/memory.mjs");
    await captureStdout(() =>
      runMemoryList({ limit: "50", session: "s1", scene: "x" }, makeCmd() as never)
    );
    assert.ok(capturedUrl.includes("/api/memory/list"));
    assert.ok(capturedUrl.includes("limit=50"));
    assert.ok(capturedUrl.includes("sessionId=s1"));
    assert.ok(capturedUrl.includes("scene=x"));
  } finally {
    restore();
  }
});

// ── F: runSettingsGet — GET /api/memory/settings ──────────────────────────

test("runSettingsGet calls GET /api/memory/settings", async () => {
  let capturedUrl = "";
  const restore = installFetch((url) => {
    capturedUrl = String(url);
    return Promise.resolve(makeResp(SETTINGS_PAYLOAD));
  });
  try {
    const { runSettingsGet } = await import("../../bin/cli/commands/memory.mjs");
    const out = await captureStdout(() => runSettingsGet({}, makeCmd() as never));
    const parsed = JSON.parse(out);
    assert.ok(Array.isArray(parsed));
    assert.equal(parsed[0].key, "strategy");
    assert.ok(capturedUrl.endsWith("/api/memory/settings"));
  } finally {
    restore();
  }
});

// ── G: runSettingsSet — PUT /api/memory/settings with {key, value} ────────

test("runSettingsSet calls PUT /api/memory/settings with {key,value} body", async () => {
  let capturedUrl = "";
  let capturedInit: any = null;
  const restore = installFetch((url, init) => {
    capturedUrl = String(url);
    capturedInit = init;
    return Promise.resolve(makeResp({ value: "hybrid" }));
  });
  try {
    const { runSettingsSet } = await import("../../bin/cli/commands/memory.mjs");
    await captureStdout(() => runSettingsSet("strategy", "hybrid", {}, makeCmd() as never));
    assert.ok(capturedUrl.endsWith("/api/memory/settings"));
    assert.equal(capturedInit?.method, "PUT");
    const body = JSON.parse(capturedInit?.body);
    assert.equal(body.key, "strategy");
    assert.equal(body.value, "hybrid");
  } finally {
    restore();
  }
});

// ── H: runSettingsReset — POST /api/memory/settings {reset:true} ─────────

test("runSettingsReset calls POST /api/memory/settings with {reset:true}", async () => {
  let capturedUrl = "";
  let capturedInit: any = null;
  const restore = installFetch((url, init) => {
    capturedUrl = String(url);
    capturedInit = init;
    return Promise.resolve(makeResp(SETTINGS_PAYLOAD));
  });
  try {
    const { runSettingsReset } = await import("../../bin/cli/commands/memory.mjs");
    await captureStdout(() => runSettingsReset({}, makeCmd() as never));
    assert.ok(capturedUrl.endsWith("/api/memory/settings"));
    assert.equal(capturedInit?.method, "POST");
    const body = JSON.parse(capturedInit?.body);
    assert.equal(body.reset, true);
  } finally {
    restore();
  }
});

// ── I: runDistilStatus — GET /api/memory/distil/status ────────────────────

test("runDistilStatus calls GET /api/memory/distil/status", async () => {
  let capturedUrl = "";
  const restore = installFetch((url) => {
    capturedUrl = String(url);
    return Promise.resolve(makeResp(DISTIL_PAYLOAD));
  });
  try {
    const { runDistilStatus } = await import("../../bin/cli/commands/memory.mjs");
    const out = await captureStdout(() => runDistilStatus({}, makeCmd() as never));
    const parsed = JSON.parse(out);
    assert.ok(Array.isArray(parsed));
    assert.equal(parsed[0].id, "d1");
    assert.ok(capturedUrl.endsWith("/api/memory/distil/status"));
  } finally {
    restore();
  }
});

// ── J: runDistilRetryDlq — gated by --yes, POSTs to retry-dlq ────────────

test("runDistilRetryDlq calls POST /api/memory/distil/retry-dlq when --yes", async () => {
  let capturedUrl = "";
  let capturedInit: any = null;
  const restore = installFetch((url, init) => {
    capturedUrl = String(url);
    capturedInit = init;
    return Promise.resolve(makeResp({ retried: 3 }));
  });
  try {
    const { runDistilRetryDlq } = await import("../../bin/cli/commands/memory.mjs");
    await captureStdout(() => runDistilRetryDlq({ yes: true }, makeCmd() as never));
    assert.ok(capturedUrl.endsWith("/api/memory/distil/retry-dlq"));
    assert.equal(capturedInit?.method, "POST");
  } finally {
    restore();
  }
});

test("runDistilRetryDlq refuses without --yes", async () => {
  const origExit = process.exit;
  let exitCode: number | null = null;
  process.exit = ((code?: number) => {
    exitCode = code ?? 0;
    throw new Error("__exit__");
  }) as never;
  try {
    const { runDistilRetryDlq } = await import("../../bin/cli/commands/memory.mjs");
    await runDistilRetryDlq({}, makeCmd() as never).catch(() => {});
    assert.equal(exitCode, 2, "expected exit code 2 (invalid args) when --yes is missing");
  } finally {
    process.exit = origExit;
  }
});

// ── K: legacy exports are removed ────────────────────────────────────────

test("legacy memory CLI exports are removed", async () => {
  const mod = await import("../../bin/cli/commands/memory.mjs");
  for (const legacy of [
    "runMemorySearch",
    "runMemoryAdd",
    "runMemoryClear",
    "runMemoryGet",
    "runMemoryDelete",
    "runMemoryHealth",
  ]) {
    assert.equal(
      (mod as Record<string, unknown>)[legacy],
      undefined,
      `legacy export ${legacy} must be removed`
    );
  }
  // The new exports exist.
  for (const fresh of [
    "runL0Search",
    "runL1Search",
    "runL2Read",
    "runL3Read",
    "runMemoryList",
    "runSettingsGet",
    "runSettingsSet",
    "runSettingsReset",
    "runDistilStatus",
    "runDistilRetryDlq",
  ]) {
    assert.equal(
      typeof (mod as Record<string, unknown>)[fresh],
      "function",
      `new export ${fresh} must be a function`
    );
  }
});

// ── L: error response is sanitized (no raw stack) ────────────────────────

test("CLI memory commands sanitize error responses (no raw stack)", async () => {
  const origExit = process.exit;
  const origWrite = process.stderr.write.bind(process.stderr);
  let stderrText = "";
  process.stderr.write = (c: string | Uint8Array) => {
    if (typeof c === "string") stderrText += c;
    return true;
  };
  process.exit = ((code?: number) => {
    throw new Error("__exit__" + String(code));
  }) as never;
  const restore = installFetch(() =>
    Promise.resolve(makeResp({ error: "Some\n    at /abs/path/foo.ts:1:1\n  (more stack)" }, 500))
  );
  try {
    const { runL0Search } = await import("../../bin/cli/commands/memory.mjs");
    await runL0Search("boom", { limit: "5" }, makeCmd() as never).catch(() => {});
    assert.ok(!stderrText.includes("at /abs/path"), `stderr leaked path: ${stderrText}`);
    assert.ok(
      !stderrText.includes("\n  (more stack)"),
      `stderr leaked multi-line stack: ${stderrText}`
    );
  } finally {
    process.exit = origExit;
    process.stderr.write = origWrite;
    restore();
  }
});
