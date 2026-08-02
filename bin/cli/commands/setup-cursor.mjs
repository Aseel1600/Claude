/**
 * omniroute setup-cursor — guide Cursor to use OmniRoute.
 *
 * Cursor stores its OpenAI key + "Override OpenAI Base URL" in an opaque SQLite
 * DB (state.vscdb) with no documented stable schema — NOT safe to file-write.
 * So this command prints the exact in-app steps (and can list available models
 * from /v1/models). Note: Cursor's custom base URL only powers the Chat panel;
 * Composer / inline-edit / autocomplete stay on Cursor's own backend.
 */

import { printHeading, printInfo, printSuccess } from "../io.mjs";
import { t } from "../i18n.mjs";
import { resolveActiveContext } from "../contexts.mjs";

function ensureV1(url) {
  const s = String(url || "").replace(/\/+$/, "");
  return s.endsWith("/v1") ? s : `${s}/v1`;
}

/** Resolve apiBase (WITH /v1 — Cursor appends /chat/completions) + apiKey. */
export function resolveCursorTarget(opts = {}) {
  let root;
  if (opts.remote) root = String(opts.remote).replace(/\/+$/, "");
  else {
    try {
      root = resolveActiveContext(opts.context ?? process.env.OMNIROUTE_CONTEXT)?.baseUrl;
    } catch {
      /* none */
    }
    if (!root) root = `http://localhost:${Number(opts.port ?? process.env.PORT ?? 20128) || 20128}`;
  }
  let apiKey = opts.apiKey ?? opts["api-key"];
  if (!apiKey) {
    try {
      const c = resolveActiveContext(opts.context ?? process.env.OMNIROUTE_CONTEXT);
      apiKey = c?.accessToken || c?.apiKey;
    } catch {
      /* none */
    }
  }
  if (!apiKey) apiKey = process.env.OMNIROUTE_API_KEY || "";
  return { apiBase: ensureV1(root), apiKey };
}

/** The step-by-step Cursor UI instructions (pure → testable). */
export function buildCursorInstructions({ apiBase, models }) {
  const lines = [
    t("common.cli.messages.cursorIntro"),
    "",
    t("common.cli.messages.cursorStep1"),
    t("common.cli.messages.cursorStep2"),
    t("common.cli.messages.cursorApiBase", { apiBase }),
    t("common.cli.messages.cursorApiKey"),
    t("common.cli.messages.cursorModels"),
  ];
  const sample = (models && models.length ? models : ["glm/glm-5.2", "kmc/kimi-k2.7"]).slice(0, 8);
  lines.push(t("common.cli.messages.cursorExamples", { models: sample.join(", ") }));
  lines.push(t("common.cli.messages.cursorStep5"));
  lines.push("");
  lines.push(t("common.cli.messages.cursorWarning1"));
  lines.push(t("common.cli.messages.cursorWarning2"));
  return lines.join("\n");
}

async function fetchModelIds(apiBase, apiKey) {
  try {
    const headers = { "Content-Type": "application/json" };
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
    const res = await fetch(`${apiBase.replace(/\/v1$/, "")}/v1/models`, {
      headers,
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const body = await res.json();
    const list = Array.isArray(body) ? body : (body.data ?? body.models ?? []);
    return list.map((m) => (typeof m === "string" ? m : m?.id)).filter(Boolean);
  } catch {
    return [];
  }
}

export async function runSetupCursorCommand(opts = {}) {
  const { apiBase, apiKey } = resolveCursorTarget(opts);
  printHeading(t("common.cli.messages.cursorTitle"));
  printInfo(`${t("common.cli.messages.serverLabel")} ${apiBase}`);

  let models = [];
  const only = opts.only
    ? opts.only
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : null;
  const ids = await fetchModelIds(apiBase, apiKey);
  models = only ? ids.filter((id) => only.some((f) => id.includes(f))) : ids;

  console.log("\n" + buildCursorInstructions({ apiBase, models }));
  printSuccess(`\n${t("common.cli.messages.cursorConfigured")}`);
  return 0;
}

export function registerSetupCursor(program) {
  program
    .command("setup-cursor")
    .description(t("common.cli.descriptions.setupCursor"))
    .option("--port <port>", t("common.cli.options.localPort"), "20128")
    .option("--remote <url>", t("common.cli.options.remoteUrl"))
    .option("--api-key <key>", t("common.cli.options.apiKeyEnv"))
    .option("--only <patterns>", t("common.cli.options.onlyModelPatterns"))
    .action(async (opts) => {
      const code = await runSetupCursorCommand(opts);
      if (code !== 0) process.exit(code);
    });
}
