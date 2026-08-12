/**
 * OmniRoute CLI — Memory command (four-layer hard cutover).
 *
 * Shape:
 *   memory l0 search <query> [--session <id>] [--scene <key>] [--limit <n>]
 *   memory l1 search <query> [--session <id>] [--scene <key>] [--limit <n>]
 *   memory l2 read <id>
 *   memory l3 read  [--session <id>]
 *   memory list     [--session <id>] [--scene <key>] [--limit <n>]
 *   memory settings get | set <key> <value> | reset
 *   memory distil status | retry-dlq
 *
 * The legacy flat verbs (`search`, `add`, `clear`, `list`, `get`, `delete`,
 * `health`) are intentionally removed; callers must use the layered verbs.
 * Owner-scoping comes from the API key configured in the active context
 * (the CLI does not let the user pass a different `owner`/`apiKey` to read
 * another tenant's memory).
 *
 * All routes use the existing `apiFetch` client. Errors are sanitized by a
 * local `sanitizeErrorMessage` (mirrors `open-sse/utils/error.ts`) so we
 * never print raw stack traces — Hard Rule #12.
 */

import { apiFetch } from "../api.mjs";
import { emit } from "../output.mjs";
import { t } from "../i18n.mjs";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const MIN_LIMIT = 1;
const MAX_QUERY_LEN = 1024;
const MAX_ID_LEN = 256;
const MAX_SESSION_LEN = 256;
const MAX_ERROR_LEN = 4096;
const SOURCE_EXT = ["ts", "tsx", "js", "jsx", "mjs", "cjs"];

/**
 * Lightweight error-message sanitizer for CLI responses (Hard Rule #12).
 * Mirrors the behavior of `open-sse/utils/error.ts::sanitizeErrorMessage` so
 * we never print raw `err.stack` or absolute source paths from the API to the
 * operator's terminal. Avoids importing the .ts file (the bin CLI is plain
 * ESM `.mjs` with no TS loader).
 */
function sanitizeErrorMessage(message) {
  let str = typeof message === "string" ? message : String(message ?? "");
  if (str.length > MAX_ERROR_LEN) str = str.slice(0, MAX_ERROR_LEN);
  const nl = str.indexOf("\n");
  const firstLine = nl >= 0 ? str.slice(0, nl) : str;
  const parts = firstLine.split(/(\s+)/);
  for (let i = 0; i < parts.length; i++) {
    const tok = parts[i];
    if (tok.length < 4 || tok.length > 2048) continue;
    const isPosix = tok.charCodeAt(0) === 0x2f;
    const isWindows = tok.length > 2 && tok.charCodeAt(1) === 0x3a && /[A-Za-z]/.test(tok[0]);
    if (!isPosix && !isWindows) continue;
    const dot = tok.lastIndexOf(".");
    if (dot <= 0 || dot === tok.length - 1) continue;
    const ext = tok
      .slice(dot + 1)
      .split(":", 1)[0]
      .toLowerCase();
    if (SOURCE_EXT.includes(ext)) parts[i] = "<path>";
  }
  return parts.join("");
}

function clampLimit(raw) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < MIN_LIMIT) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, n);
}

function trimLen(value, max) {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

function truncate(v, len = 60) {
  if (v == null) return "-";
  const s = String(v);
  return s.length > len ? s.slice(0, len - 1) + "…" : s;
}

function fmtTs(v) {
  if (!v) return "-";
  try {
    return new Date(v).toLocaleString();
  } catch {
    return String(v);
  }
}

const layerSearchSchema = [
  { key: "id", header: "ID", width: 14 },
  { key: "sessionId", header: "Session", width: 14 },
  { key: "scene", header: "Scene", width: 18 },
  { key: "content", header: "Content", width: 60, formatter: truncate },
  { key: "score", header: "Score", formatter: (v) => (v != null ? v.toFixed(3) : "-") },
  { key: "createdAt", header: "Created", formatter: fmtTs },
];

const listSchema = [
  { key: "layer", header: "Layer", width: 5 },
  { key: "id", header: "ID", width: 14 },
  { key: "sessionId", header: "Session", width: 14 },
  { key: "scene", header: "Scene", width: 18 },
  { key: "content", header: "Content", width: 60, formatter: truncate },
  { key: "createdAt", header: "Created", formatter: fmtTs },
];

const settingsSchema = [
  { key: "key", header: "Key", width: 32 },
  { key: "value", header: "Value", width: 60 },
];

const distilSchema = [
  { key: "id", header: "ID", width: 14 },
  { key: "status", header: "Status", width: 12 },
  { key: "attempts", header: "Attempts", width: 10 },
  { key: "lastError", header: "Last error", width: 60, formatter: truncate },
  { key: "updatedAt", header: "Updated", formatter: fmtTs },
];

function pickLayerRows(items) {
  if (!Array.isArray(items)) return [];
  return items.map((raw) => {
    const item = raw && typeof raw === "object" ? raw : {};
    return {
      id: item.id ?? item.memoryId ?? "-",
      sessionId: item.sessionId ?? item.session_id ?? "-",
      scene: item.scene ?? "-",
      content: item.content ?? item.text ?? "",
      score: item.score,
      createdAt: item.createdAt ?? item.created_at ?? null,
    };
  });
}

function pickListRows(payload) {
  if (!payload || typeof payload !== "object") return [];
  const items = Array.isArray(payload.items)
    ? payload.items
    : Array.isArray(payload)
      ? payload
      : [];
  return items.map((raw) => {
    const item = raw && typeof raw === "object" ? raw : {};
    return {
      layer: item.layer ?? item.l ?? "-",
      id: item.id ?? item.memoryId ?? "-",
      sessionId: item.sessionId ?? item.session_id ?? "-",
      scene: item.scene ?? "-",
      content: item.content ?? item.text ?? "",
      createdAt: item.createdAt ?? item.created_at ?? null,
    };
  });
}

function pickSettingsRows(payload) {
  if (!payload || typeof payload !== "object") return [];
  if (Array.isArray(payload)) {
    return payload.map((entry) => ({
      key: entry?.key ?? "-",
      value: typeof entry?.value === "string" ? entry.value : JSON.stringify(entry?.value ?? ""),
    }));
  }
  return Object.entries(payload).map(([key, value]) => ({
    key,
    value: typeof value === "string" ? value : JSON.stringify(value ?? ""),
  }));
}

function pickDistilRows(payload) {
  if (!payload || typeof payload !== "object") return [];
  const rows = Array.isArray(payload.items) ? payload.items : Array.isArray(payload) ? payload : [];
  return rows.map((raw) => {
    const item = raw && typeof raw === "object" ? raw : {};
    return {
      id: item.id ?? "-",
      status: item.status ?? "-",
      attempts: item.attempts ?? 0,
      lastError: item.lastError ?? item.error ?? "",
      updatedAt: item.updatedAt ?? item.updated_at ?? null,
    };
  });
}

async function runLayerSearch(layer, query, opts, cmd) {
  const globalOpts = cmd.optsWithGlobals();
  const safeQuery = trimLen(query, MAX_QUERY_LEN);
  if (!safeQuery) {
    process.stderr.write("Query is required (1-1024 chars)\n");
    process.exit(2);
  }
  const params = new URLSearchParams({ q: safeQuery, limit: String(clampLimit(opts.limit)) });
  if (opts.session) params.set("sessionId", trimLen(opts.session, MAX_SESSION_LEN));
  if (opts.scene) params.set("scene", trimLen(opts.scene, MAX_ID_LEN));
  const res = await apiFetch(`/api/memory/${layer}/search?${params.toString()}`);
  if (!res.ok) {
    process.stderr.write(`Error: ${sanitizeErrorMessage(await res.text().catch(() => "error"))}\n`);
    process.exit(1);
  }
  const data = await res.json().catch(() => ({}));
  emit(pickLayerRows(data.items ?? data), globalOpts, layerSearchSchema);
}

export async function runL0Search(query, opts, cmd) {
  return runLayerSearch("l0", query, opts, cmd);
}

export async function runL1Search(query, opts, cmd) {
  return runLayerSearch("l1", query, opts, cmd);
}

export async function runL2Read(id, opts, cmd) {
  const globalOpts = cmd.optsWithGlobals();
  const safeId = trimLen(id, MAX_ID_LEN);
  if (!safeId) {
    process.stderr.write("Id is required (1-256 chars)\n");
    process.exit(2);
  }
  const res = await apiFetch(`/api/memory/l2/${encodeURIComponent(safeId)}`);
  if (!res.ok) {
    process.stderr.write(`Error: ${sanitizeErrorMessage(await res.text().catch(() => "error"))}\n`);
    process.exit(1);
  }
  const data = await res.json().catch(() => ({}));
  emit(
    [
      {
        id: safeId,
        scene: data.scene ?? null,
        content: data.content ?? data.text ?? "",
        createdAt: data.createdAt ?? null,
      },
    ],
    globalOpts,
    layerSearchSchema
  );
}

export async function runL3Read(opts, cmd) {
  const globalOpts = cmd.optsWithGlobals();
  const params = new URLSearchParams();
  if (opts.session) params.set("sessionId", trimLen(opts.session, MAX_SESSION_LEN));
  const path = `/api/memory/l3${params.toString() ? `?${params.toString()}` : ""}`;
  const res = await apiFetch(path);
  if (!res.ok) {
    process.stderr.write(`Error: ${sanitizeErrorMessage(await res.text().catch(() => "error"))}\n`);
    process.exit(1);
  }
  const data = await res.json().catch(() => ({}));
  emit(
    [
      {
        id: data.id ?? "persona",
        sessionId: data.sessionId ?? opts.session ?? "-",
        content: data.persona?.content ?? data.content ?? JSON.stringify(data.persona ?? data),
        createdAt: data.persona?.updatedAt ?? data.updatedAt ?? null,
      },
    ],
    globalOpts,
    layerSearchSchema
  );
}

export async function runMemoryList(opts, cmd) {
  const globalOpts = cmd.optsWithGlobals();
  const params = new URLSearchParams({ limit: String(clampLimit(opts.limit)) });
  if (opts.session) params.set("sessionId", trimLen(opts.session, MAX_SESSION_LEN));
  if (opts.scene) params.set("scene", trimLen(opts.scene, MAX_ID_LEN));
  const res = await apiFetch(`/api/memory/list?${params.toString()}`);
  if (!res.ok) {
    process.stderr.write(`Error: ${sanitizeErrorMessage(await res.text().catch(() => "error"))}\n`);
    process.exit(1);
  }
  const data = await res.json().catch(() => ({}));
  emit(pickListRows(data), globalOpts, listSchema);
}

export async function runSettingsGet(opts, cmd) {
  const globalOpts = cmd.optsWithGlobals();
  const res = await apiFetch("/api/memory/settings");
  if (!res.ok) {
    process.stderr.write(`Error: ${sanitizeErrorMessage(await res.text().catch(() => "error"))}\n`);
    process.exit(1);
  }
  const data = await res.json().catch(() => ({}));
  emit(pickSettingsRows(data), globalOpts, settingsSchema);
}

export async function runSettingsSet(key, value, opts, cmd) {
  const globalOpts = cmd.optsWithGlobals();
  if (!key || typeof value !== "string") {
    process.stderr.write("Settings key and value are required\n");
    process.exit(2);
  }
  const res = await apiFetch("/api/memory/settings", {
    method: "PUT",
    body: { key, value },
  });
  if (!res.ok) {
    process.stderr.write(`Error: ${sanitizeErrorMessage(await res.text().catch(() => "error"))}\n`);
    process.exit(1);
  }
  const data = await res.json().catch(() => ({}));
  emit(pickSettingsRows({ [key]: data.value ?? value }), globalOpts, settingsSchema);
}

export async function runSettingsReset(opts, cmd) {
  const globalOpts = cmd.optsWithGlobals();
  const res = await apiFetch("/api/memory/settings", { method: "POST", body: { reset: true } });
  if (!res.ok) {
    process.stderr.write(`Error: ${sanitizeErrorMessage(await res.text().catch(() => "error"))}\n`);
    process.exit(1);
  }
  const data = await res.json().catch(() => ({}));
  emit(pickSettingsRows(data), globalOpts, settingsSchema);
}

export async function runDistilStatus(opts, cmd) {
  const globalOpts = cmd.optsWithGlobals();
  const res = await apiFetch("/api/memory/distil/status");
  if (!res.ok) {
    process.stderr.write(`Error: ${sanitizeErrorMessage(await res.text().catch(() => "error"))}\n`);
    process.exit(1);
  }
  const data = await res.json().catch(() => ({}));
  emit(pickDistilRows(data), globalOpts, distilSchema);
}

export async function runDistilRetryDlq(opts, cmd) {
  const globalOpts = cmd.optsWithGlobals();
  if (!opts.yes) {
    process.stderr.write("Use --yes to confirm DLQ retry.\n");
    process.exit(2);
  }
  const res = await apiFetch("/api/memory/distil/retry-dlq", { method: "POST", body: {} });
  if (!res.ok) {
    process.stderr.write(`Error: ${sanitizeErrorMessage(await res.text().catch(() => "error"))}\n`);
    process.exit(1);
  }
  const data = await res.json().catch(() => ({}));
  emit(data, globalOpts);
}

export function registerMemory(program) {
  const memory = program.command("memory").description(t("memory.description"));

  // Layer subcommands
  const l0 = memory.command("l0").description("Layer-0 (vector/semantic) memory operations");
  l0.command("search <query>")
    .description("Search layer-0 memory (vector/semantic)")
    .option("--session <id>", "Filter by session id")
    .option("--scene <key>", "Filter by scene key")
    .option("--limit <n>", "Max items to return (1-100, default 20)", String, "20")
    .action(runL0Search);

  const l1 = memory.command("l1").description("Layer-1 (full-text/FTS5) memory operations");
  l1.command("search <query>")
    .description("Search layer-1 memory (FTS5)")
    .option("--session <id>", "Filter by session id")
    .option("--scene <key>", "Filter by scene key")
    .option("--limit <n>", "Max items to return (1-100, default 20)", String, "20")
    .action(runL1Search);

  const l2 = memory.command("l2").description("Layer-2 (scene/pod) memory operations");
  l2.command("read <id>").description("Read a layer-2 scene/pod by id").action(runL2Read);

  const l3 = memory.command("l3").description("Layer-3 (current persona) memory operations");
  l3.command("read")
    .description("Read the layer-3 current persona (optionally filtered by session)")
    .option("--session <id>", "Filter by session id")
    .action(runL3Read);

  // Cross-layer list
  memory
    .command("list")
    .description("List memory across all layers (L0+L1+L2+L3) for the calling API key")
    .option("--session <id>", "Filter by session id")
    .option("--scene <key>", "Filter by scene key")
    .option("--limit <n>", "Max items to return (1-100, default 20)", String, "20")
    .action(runMemoryList);

  // Settings subcommand
  const settings = memory.command("settings").description("Memory settings");
  settings.command("get").description("Show current memory settings").action(runSettingsGet);
  settings
    .command("set <key> <value>")
    .description("Set a single memory setting")
    .action(runSettingsSet);
  settings
    .command("reset")
    .description("Reset memory settings to defaults")
    .action(runSettingsReset);

  // Distil subcommand
  const distil = memory.command("distil").description("Memory distillation queue");
  distil
    .command("status")
    .description("Show the distillation queue status")
    .action(runDistilStatus);
  distil
    .command("retry-dlq")
    .description("Retry the distillation dead-letter queue")
    .option("--yes", "Skip confirmation prompt")
    .action(runDistilRetryDlq);
}
