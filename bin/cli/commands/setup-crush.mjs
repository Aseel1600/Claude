/**
 * omniroute setup-crush — configure Crush (charmbracelet/crush) for OmniRoute.
 *
 * Crush is a terminal AI agent with a file-based config: ~/.config/crush/crush.json
 * (or ./crush.json). It supports a custom `openai-compat` provider. base_url must
 * include /v1; the api_key may reference an env var (`$OMNIROUTE_API_KEY`) so the
 * secret stays out of the file. Remote-aware; curated catalog models.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";
import { printHeading, printInfo, printSuccess, printError } from "../io.mjs";
import { t } from "../i18n.mjs";
import { resolveActiveContext } from "../contexts.mjs";
import { categoriseModel } from "./setup-codex.mjs";

const API_KEY_REF = "$OMNIROUTE_API_KEY";

function ensureV1(url) {
  const s = String(url || "").replace(/\/+$/, "");
  return s.endsWith("/v1") ? s : `${s}/v1`;
}

/** Resolve base_url (WITH /v1) + apiKey from flags → active context → localhost. */
export function resolveCrushTarget(opts = {}) {
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
  return { baseUrl: ensureV1(root), apiKey };
}

/** Build the Crush `openai-compat` provider block from curated catalog ids. */
export function buildCrushProvider(modelIds, baseUrl) {
  const models = [];
  for (const id of modelIds) {
    const cfg = categoriseModel(id);
    if (!cfg) continue;
    models.push({ id, name: `OmniRoute: ${id}`, context_window: cfg.ctx });
  }
  return {
    type: "openai-compat",
    base_url: baseUrl,
    api_key: API_KEY_REF,
    models,
  };
}

/** Merge the OmniRoute provider into an existing crush.json (preserve the rest). */
export function mergeCrushConfig(existing, provider) {
  const cfg = existing && typeof existing === "object" ? { ...existing } : {};
  cfg.providers = { ...(cfg.providers || {}), omniroute: provider };
  return cfg;
}

function readJson(path) {
  try {
    if (existsSync(path)) return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    /* corrupt/missing */
  }
  return {};
}

async function fetchModelIds(baseUrl, apiKey) {
  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
  const res = await fetch(`${baseUrl.replace(/\/v1$/, "")}/v1/models`, {
    headers,
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(t("common.cli.messages.http", { status: res.status }));
  const body = await res.json();
  const list = Array.isArray(body) ? body : (body.data ?? body.models ?? []);
  return list.map((m) => (typeof m === "string" ? m : m?.id)).filter(Boolean);
}

export async function runSetupCrushCommand(opts = {}) {
  const { baseUrl, apiKey } = resolveCrushTarget(opts);
  const dryRun = Boolean(opts.dryRun ?? opts["dry-run"]);
  const only = opts.only
    ? opts.only
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : null;
  const configPath =
    opts.configPath ?? opts["config-path"] ?? join(os.homedir(), ".config", "crush", "crush.json");

  printHeading(t("common.cli.messages.crushTitle"));
  printInfo(`${t("common.cli.messages.baseUrlLabel")} ${baseUrl}`);

  let ids;
  try {
    ids = await fetchModelIds(baseUrl, apiKey);
  } catch (e) {
    printError(t("common.cli.messages.fetchModelsFailed", { error: e.message }));
    printInfo(t("common.cli.messages.checkRemote"));
    return 1;
  }
  if (only) ids = ids.filter((id) => only.some((f) => id.includes(f)));

  const provider = buildCrushProvider(ids, baseUrl);
  if (!provider.models.length) {
    printError(t("common.cli.messages.noMatchingModels"));
    return 1;
  }
  const merged = mergeCrushConfig(readJson(configPath), provider);
  const out = JSON.stringify(merged, null, 2) + "\n";

  if (dryRun) {
    console.log("\n" + (out.length > 3500 ? out.slice(0, 3500) + "\n… (truncated)" : out));
    printInfo(
      `${t("common.cli.messages.dryRunPath", { path: configPath })} (${provider.models.length} model(s) under providers.omniroute)`
    );
    return 0;
  }
  mkdirSync(join(configPath, ".."), { recursive: true });
  writeFileSync(configPath, out, "utf8");
  printSuccess(
    `${t("common.cli.messages.wrote", { path: configPath })} (${provider.models.length} models under providers.omniroute)`
  );
  printInfo(t("common.cli.messages.provideKey"));
  printInfo(t("common.cli.messages.runCrush"));
  return 0;
}

export function registerSetupCrush(program) {
  program
    .command("setup-crush")
    .description(t("common.cli.descriptions.setupCrush"))
    .option("--port <port>", t("common.cli.options.localPort"), "20128")
    .option("--remote <url>", t("common.cli.options.remoteUrl"))
    .option("--api-key <key>", t("common.cli.options.apiKeyEnv"))
    .option("--only <patterns>", t("common.cli.options.onlyPatterns"))
    .option("--config-path <path>", t("common.cli.options.setupConfigPath"))
    .option("--dry-run", t("common.cli.options.dryRun"))
    .action(async (opts) => {
      const code = await runSetupCrushCommand(opts);
      if (code !== 0) process.exit(code);
    });
}
