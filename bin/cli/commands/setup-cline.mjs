/**
 * omniroute setup-cline — configure the Cline AI coding agent to use OmniRoute.
 *
 * Cline's VS Code extension keeps its config in VS Code's opaque globalStorage
 * (not file-writable). Its CLI/standalone mode reads ~/.cline/data/. This command
 * writes the CLI-mode files (matching the OmniRoute dashboard) AND prints the
 * Base URL / model to paste into the VS Code extension UI.
 *
 * Cline uses the OpenAI-compatible provider: openAiBaseUrl is the ROOT URL
 * (no /v1 — Cline appends /v1/chat/completions). Plan + Act modes are set to the
 * same provider/model. The key goes in secrets.json (Cline has no env ref).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";
import { printHeading, printInfo, printSuccess, printError, createPrompt } from "../io.mjs";
import { t } from "../i18n.mjs";
import { resolveActiveContext } from "../contexts.mjs";

function stripToRoot(url) {
  let s = String(url || "").replace(/\/+$/, "");
  return s.endsWith("/v1") ? s.slice(0, -3) : s;
}

/** Resolve baseUrl (ROOT, no /v1) + apiKey from flags → active context → localhost. */
export function resolveClineTarget(opts = {}) {
  let baseUrl;
  if (opts.remote) baseUrl = stripToRoot(opts.remote);
  else {
    try {
      baseUrl = stripToRoot(
        resolveActiveContext(opts.context ?? process.env.OMNIROUTE_CONTEXT)?.baseUrl
      );
    } catch {
      /* none */
    }
    if (!baseUrl)
      baseUrl = `http://localhost:${Number(opts.port ?? process.env.PORT ?? 20128) || 20128}`;
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
  return { baseUrl, apiKey };
}

/** Merge OmniRoute openai-compatible settings into Cline's globalState (Plan + Act). */
export function buildClineGlobalState(existing, { baseUrl, model }) {
  const gs = { ...(existing || {}) };
  gs.actModeApiProvider = "openai";
  gs.planModeApiProvider = "openai";
  gs.openAiBaseUrl = baseUrl; // ROOT — Cline appends /v1/chat/completions
  if (model) {
    gs.openAiModelId = model;
    gs.planModeOpenAiModelId = model;
  }
  return gs;
}

/** Merge the API key into Cline's secrets (Cline has no env-var reference). */
export function buildClineSecrets(existing, { apiKey }) {
  return { ...(existing || {}), openAiApiKey: apiKey || "sk_omniroute" };
}

function readJson(path) {
  try {
    if (existsSync(path)) return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    /* corrupt/missing → start fresh */
  }
  return {};
}

async function fetchModelIds(baseUrl, apiKey) {
  try {
    const headers = { "Content-Type": "application/json" };
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
    const res = await fetch(`${baseUrl}/v1/models`, { headers, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    const body = await res.json();
    const list = Array.isArray(body) ? body : (body.data ?? body.models ?? []);
    return list.map((m) => (typeof m === "string" ? m : m?.id)).filter(Boolean);
  } catch {
    return [];
  }
}

export async function runSetupClineCommand(opts = {}) {
  const { baseUrl, apiKey } = resolveClineTarget(opts);
  const dryRun = Boolean(opts.dryRun ?? opts["dry-run"]);
  const clineDir = opts.clineDir ?? opts["cline-dir"] ?? join(os.homedir(), ".cline", "data");

  printHeading(t("common.cli.messages.clineTitle"));
  printInfo(`${t("common.cli.messages.serverLabel")} ${baseUrl}`);

  // Resolve the model (Cline needs one explicit id — no auto-discovery).
  let model = opts.model;
  if (!model) {
    const ids = await fetchModelIds(baseUrl, apiKey);
    if (ids.length && !opts.yes) {
      printInfo(
        t("common.cli.messages.examples", {
          models: `${ids.slice(0, 20).join(", ")}${ids.length > 20 ? " …" : ""}`,
        })
      );
      const prompt = createPrompt();
      try {
        model = await prompt.ask(t("common.cli.messages.clineModelPrompt"));
      } finally {
        prompt.close();
      }
    }
  }
  if (!model) {
    printError(t("common.cli.messages.clineModelRequired"));
    return 2;
  }

  const gsPath = join(clineDir, "globalState.json");
  const secPath = join(clineDir, "secrets.json");
  const globalState = buildClineGlobalState(readJson(gsPath), { baseUrl, model });
  const secrets = buildClineSecrets(readJson(secPath), { apiKey });

  if (dryRun) {
    console.log(t("common.cli.messages.dryRunHeader", { path: gsPath }));
    console.log(
      JSON.stringify(
        {
          actModeApiProvider: globalState.actModeApiProvider,
          planModeApiProvider: globalState.planModeApiProvider,
          openAiBaseUrl: globalState.openAiBaseUrl,
          openAiModelId: globalState.openAiModelId,
        },
        null,
        2
      )
    );
    console.log(
      `${t("common.cli.messages.dryRunHeader", { path: secPath })} (openAiApiKey: ${apiKey ? "set" : "sk_omniroute"})`
    );
  } else {
    if (!existsSync(clineDir)) mkdirSync(clineDir, { recursive: true });
    writeFileSync(gsPath, JSON.stringify(globalState, null, 2) + "\n", "utf8");
    writeFileSync(secPath, JSON.stringify(secrets, null, 2) + "\n", "utf8");
    printSuccess(t("common.cli.messages.wrote", { path: gsPath }));
    printSuccess(t("common.cli.messages.wrote", { path: secPath }));
  }

  // The VS Code extension uses opaque globalStorage — can't be file-written.
  printInfo(t("common.cli.messages.clineExtensionInstructions"));
  printInfo(`  ${t("common.cli.messages.clineBaseUrlValue", { value: baseUrl })}`);
  printInfo(`  ${t("common.cli.messages.apiKeyValue", { value: "<your OMNIROUTE_API_KEY>" })}`);
  printInfo(`  ${t("common.cli.messages.modelValue", { value: model })}`);
  return 0;
}

export function registerSetupCline(program) {
  program
    .command("setup-cline")
    .description(t("common.cli.descriptions.setupCline"))
    .option("--port <port>", t("common.cli.options.localPort"), "20128")
    .option("--remote <url>", t("common.cli.options.remoteUrl"))
    .option("--api-key <key>", t("common.cli.options.apiKeyEnv"))
    .option("--model <id>", t("common.cli.options.clineModel"))
    .option("--cline-dir <dir>", t("common.cli.options.clineDir"))
    .option("--yes", t("common.cli.options.nonInteractiveModel"))
    .option("--dry-run", t("common.cli.options.dryRun"))
    .action(async (opts) => {
      const code = await runSetupClineCommand(opts);
      if (code !== 0) process.exit(code);
    });
}
