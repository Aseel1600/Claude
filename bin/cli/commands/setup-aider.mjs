/**
 * omniroute setup-aider — configure Aider (aider.chat) for OmniRoute.
 *
 * Aider (LiteLLM under the hood) talks to an OpenAI-compatible endpoint via env
 * `OPENAI_API_BASE` (ROOT url — LiteLLM appends /v1/chat/completions) + the model
 * flag `--model openai/<model>`. This writes ~/.aider.conf.yml (openai-api-base +
 * model) — the key stays in OPENAI_API_KEY (env, never the file) — and prints the
 * guaranteed env recipe + headless command. Remote-aware.
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

/** Resolve OPENAI_API_BASE (ROOT, no /v1 — LiteLLM appends) + apiKey. */
export function resolveAiderTarget(opts = {}) {
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
  return { apiBase: root, apiKey };
}

/** Merge openai-api-base + model into an .aider.conf.yml object (preserve rest). */
export function buildAiderConfig(existing, { apiBase, model }) {
  const cfg = existing && typeof existing === "object" ? { ...existing } : {};
  cfg["openai-api-base"] = apiBase;
  if (model) cfg.model = `openai/${model}`;
  return cfg;
}

/** The guaranteed env + run recipe (pure → testable). */
export function buildAiderRecipe({ apiBase, model }) {
  return [
    `export OPENAI_API_BASE=${apiBase}`,
    "export OPENAI_API_KEY=$OMNIROUTE_API_KEY",
    `aider --model openai/${model}`,
    `# headless:  aider --model openai/${model} --message "reply OK" --yes`,
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

async function fetchModelIds(apiBase, apiKey) {
  try {
    const headers = { "Content-Type": "application/json" };
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
    const res = await fetch(`${apiBase}/v1/models`, { headers, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    const body = await res.json();
    const list = Array.isArray(body) ? body : (body.data ?? body.models ?? []);
    return list.map((m) => (typeof m === "string" ? m : m?.id)).filter(Boolean);
  } catch {
    return [];
  }
}

export async function runSetupAiderCommand(opts = {}) {
  const { apiBase, apiKey } = resolveAiderTarget(opts);
  const dryRun = Boolean(opts.dryRun ?? opts["dry-run"]);
  const configPath =
    opts.configPath ?? opts["config-path"] ?? join(os.homedir(), ".aider.conf.yml");

  printHeading(t("common.cli.messages.aiderTitle"));
  printInfo(t("common.cli.messages.aiderApiBaseInfo", { apiBase }));

  let model = opts.model;
  if (!model) {
    const ids = await fetchModelIds(apiBase, apiKey);
    if (ids.length && !opts.yes) {
      printInfo(
        t("common.cli.messages.examples", {
          models: `${ids.slice(0, 20).join(", ")}${ids.length > 20 ? " …" : ""}`,
        })
      );
      const prompt = createPrompt();
      try {
        model = await prompt.ask(t("common.cli.messages.aiderModelPrompt"));
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
  const merged = buildAiderConfig(readYamlSafe(yaml, configPath), { apiBase, model });
  const out = yaml.dump(merged, { lineWidth: -1 });

  if (dryRun) {
    console.log("\n" + out);
    printInfo(t("common.cli.messages.dryRunPath", { path: configPath }));
  } else {
    mkdirSync(join(configPath, ".."), { recursive: true });
    writeFileSync(configPath, out, "utf8");
    printSuccess(t("common.cli.messages.wrote", { path: configPath }));
  }
  printInfo(`\n${t("common.cli.messages.aiderProvideKey")}`);
  console.log(buildAiderRecipe({ apiBase, model }));
  return 0;
}

export function registerSetupAider(program) {
  program
    .command("setup-aider")
    .description(t("common.cli.descriptions.setupAider"))
    .option("--port <port>", t("common.cli.options.localPort"), "20128")
    .option("--remote <url>", t("common.cli.options.remoteUrl"))
    .option("--api-key <key>", t("common.cli.options.apiKeyEnv"))
    .option("--model <id>", t("common.cli.options.setupModel"))
    .option("--config-path <path>", t("common.cli.options.setupConfigPath"))
    .option("--yes", t("common.cli.options.nonInteractiveModel"))
    .option("--dry-run", t("common.cli.options.dryRun"))
    .action(async (opts) => {
      const code = await runSetupAiderCommand(opts);
      if (code !== 0) process.exit(code);
    });
}
