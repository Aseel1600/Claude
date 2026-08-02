/**
 * omniroute setup-goose — configure Goose (block/goose) for OmniRoute.
 *
 * Goose is a terminal AI agent with a file-based config at
 * ~/.config/goose/config.yaml and env-var overrides. For a custom OpenAI-
 * compatible endpoint it uses provider `openai` with OPENAI_HOST = the ROOT url
 * (NO /v1 — Goose appends the path itself). This writes the config.yaml keys and
 * prints the guaranteed env-var recipe (the API key lives in the OS keyring / env,
 * never the config file).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";
import { printHeading, printInfo, printSuccess, printError, createPrompt } from "../io.mjs";
import { t } from "../i18n.mjs";
import { resolveActiveContext } from "../contexts.mjs";

function stripToRoot(url) {
  const s = String(url || "").replace(/\/+$/, "");
  return s.endsWith("/v1") ? s.slice(0, -3) : s;
}

/** Resolve OPENAI_HOST (ROOT, no /v1 — Goose appends) + apiKey. */
export function resolveGooseTarget(opts = {}) {
  let root;
  if (opts.remote) root = stripToRoot(opts.remote);
  else {
    try {
      root = stripToRoot(
        resolveActiveContext(opts.context ?? process.env.OMNIROUTE_CONTEXT)?.baseUrl
      );
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
  return { host: root, apiKey };
}

/** Merge Goose's provider/model keys into config.yaml object (preserve the rest). */
export function buildGooseConfig(existing, { host, model }) {
  const cfg = existing && typeof existing === "object" ? { ...existing } : {};
  cfg.GOOSE_PROVIDER = "openai";
  cfg.GOOSE_MODEL = model;
  cfg.OPENAI_HOST = host; // ROOT — Goose appends /v1/chat/completions
  return cfg;
}

/** The guaranteed env-var recipe (pure → testable). */
export function buildGooseEnvRecipe({ host, model }) {
  return [
    "export GOOSE_PROVIDER=openai",
    `export OPENAI_HOST=${host}`,
    "export OPENAI_API_KEY=$OMNIROUTE_API_KEY",
    `export GOOSE_MODEL=${model}`,
  ].join("\n");
}

function readYamlSafe(yaml, path) {
  try {
    if (existsSync(path)) return yaml.load(readFileSync(path, "utf8")) || {};
  } catch {
    /* corrupt/missing */
  }
  return {};
}

async function fetchModelIds(host, apiKey) {
  try {
    const headers = { "Content-Type": "application/json" };
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
    const res = await fetch(`${host}/v1/models`, { headers, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    const body = await res.json();
    const list = Array.isArray(body) ? body : (body.data ?? body.models ?? []);
    return list.map((m) => (typeof m === "string" ? m : m?.id)).filter(Boolean);
  } catch {
    return [];
  }
}

export async function runSetupGooseCommand(opts = {}) {
  const { host, apiKey } = resolveGooseTarget(opts);
  const dryRun = Boolean(opts.dryRun ?? opts["dry-run"]);
  const configPath =
    opts.configPath ?? opts["config-path"] ?? join(os.homedir(), ".config", "goose", "config.yaml");

  printHeading(t("common.cli.messages.gooseTitle"));
  printInfo(t("common.cli.messages.gooseHostInfo", { host }));

  let model = opts.model;
  if (!model) {
    const ids = await fetchModelIds(host, apiKey);
    if (ids.length && !opts.yes) {
      printInfo(
        t("common.cli.messages.examples", {
          models: `${ids.slice(0, 20).join(", ")}${ids.length > 20 ? " …" : ""}`,
        })
      );
      const prompt = createPrompt();
      try {
        model = await prompt.ask(t("common.cli.messages.gooseModelPrompt"));
      } finally {
        prompt.close();
      }
    }
  }
  if (!model) {
    printError(t("common.cli.messages.modelRequired"));
    return 2;
  }

  const yaml = await import("js-yaml");
  const merged = buildGooseConfig(readYamlSafe(yaml, configPath), { host, model });
  const out = yaml.dump(merged, { lineWidth: -1 });

  if (dryRun) {
    console.log("\n" + out);
    printInfo(t("common.cli.messages.dryRunPath", { path: configPath }));
  } else {
    mkdirSync(join(configPath, ".."), { recursive: true });
    writeFileSync(configPath, out, "utf8");
    printSuccess(t("common.cli.messages.wrote", { path: configPath }));
  }

  printInfo(`\n${t("common.cli.messages.provideEnvKey")}`);
  console.log(buildGooseEnvRecipe({ host, model }));
  printInfo(t("common.cli.messages.runGoose"));
  return 0;
}

export function registerSetupGoose(program) {
  program
    .command("setup-goose")
    .description(t("common.cli.descriptions.setupGoose"))
    .option("--port <port>", t("common.cli.options.localPort"), "20128")
    .option("--remote <url>", t("common.cli.options.remoteUrl"))
    .option("--api-key <key>", t("common.cli.options.apiKeyEnv"))
    .option("--model <id>", t("common.cli.options.setupModelRequired"))
    .option("--config-path <path>", t("common.cli.options.setupConfigPath"))
    .option("--yes", t("common.cli.options.nonInteractiveModel"))
    .option("--dry-run", t("common.cli.options.dryRun"))
    .action(async (opts) => {
      const code = await runSetupGooseCommand(opts);
      if (code !== 0) process.exit(code);
    });
}
