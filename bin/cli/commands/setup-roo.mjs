/**
 * omniroute setup-roo — configure Roo Code (RooVeterinaryInc.roo-cline) for OmniRoute.
 *
 * Roo is a VS Code extension (Cline fork). Its live settings live in opaque VS
 * Code globalStorage, but Roo supports **Settings Import** + an
 * `roo-cline.autoImportSettingsPath` (VS Code settings.json) that loads a JSON on
 * startup. So this writes a best-effort import file + wires autoImport (when a VS
 * Code settings.json exists) + prints the UI steps as the guaranteed path.
 *
 * OpenAI-compatible: baseUrl WITH /v1 (Roo appends /chat/completions). The model
 * must support native OpenAI tool-calling (OmniRoute does).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";
import { printHeading, printInfo, printSuccess, printError } from "../io.mjs";
import { t } from "../i18n.mjs";
import { resolveActiveContext } from "../contexts.mjs";

function ensureV1(url) {
  const s = String(url || "").replace(/\/+$/, "");
  return s.endsWith("/v1") ? s : `${s}/v1`;
}

/** Resolve baseUrl (WITH /v1) + apiKey from flags → active context → localhost. */
export function resolveRooTarget(opts = {}) {
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

/** Build a Roo Settings-Import document (provider profile, openai-compatible). */
export function buildRooImport({ baseUrl, apiKey, model }) {
  return {
    providerProfiles: {
      currentApiConfigName: "OmniRoute",
      apiConfigs: {
        OmniRoute: {
          apiProvider: "openai",
          openAiBaseUrl: baseUrl,
          openAiApiKey: apiKey || "sk_omniroute",
          openAiModelId: model,
          openAiCustomModelInfo: { supportsImages: false, supportsPromptCache: false },
        },
      },
    },
  };
}

/** Add the autoImport pointer to a VS Code settings.json object. */
export function buildRooVscodeAutoImport(existing, importPath) {
  return { ...(existing || {}), "roo-cline.autoImportSettingsPath": importPath };
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
  try {
    const headers = { "Content-Type": "application/json" };
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
    const res = await fetch(`${baseUrl.replace(/\/v1$/, "")}/v1/models`, {
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

export async function runSetupRooCommand(opts = {}) {
  const { baseUrl, apiKey } = resolveRooTarget(opts);
  const dryRun = Boolean(opts.dryRun ?? opts["dry-run"]);
  const importPath =
    opts.importPath ?? opts["import-path"] ?? join(os.homedir(), ".omniroute", "roo-settings.json");
  const vscodePath =
    opts.vscodeSettings ??
    opts["vscode-settings"] ??
    join(os.homedir(), ".config", "Code", "User", "settings.json");

  printHeading(t("common.cli.messages.rooTitle"));
  printInfo(`${t("common.cli.messages.serverLabel")} ${baseUrl}`);

  let model = opts.model;
  if (!model) {
    const ids = await fetchModelIds(baseUrl, apiKey);
    if (ids.length && !opts.yes) {
      printInfo(
        t("common.cli.messages.examples", {
          models: `${ids.slice(0, 20).join(", ")}${ids.length > 20 ? " …" : ""}`,
        })
      );
      const { createPrompt } = await import("../io.mjs");
      const prompt = createPrompt();
      try {
        model = await prompt.ask(t("common.cli.messages.rooModelPrompt"));
      } finally {
        prompt.close();
      }
    }
  }
  if (!model) {
    printError(t("common.cli.messages.rooModelRequired"));
    return 2;
  }

  const importDoc = buildRooImport({ baseUrl, apiKey, model });
  const vscodeExists = existsSync(vscodePath);

  if (dryRun) {
    console.log(t("common.cli.messages.dryRunHeader", { path: importPath }));
    console.log(
      JSON.stringify(
        {
          ...importDoc,
          providerProfiles: {
            ...importDoc.providerProfiles,
            apiConfigs: {
              OmniRoute: {
                ...importDoc.providerProfiles.apiConfigs.OmniRoute,
                openAiApiKey: apiKey ? "set" : "sk_omniroute",
              },
            },
          },
        },
        null,
        2
      )
    );
    console.log(
      `\n── [dry-run] ${vscodePath} ── ${vscodeExists ? "(would set roo-cline.autoImportSettingsPath)" : "(skipped — file absent)"}`
    );
  } else {
    mkdirSync(join(importPath, ".."), { recursive: true });
    writeFileSync(importPath, JSON.stringify(importDoc, null, 2) + "\n", "utf8");
    printSuccess(t("common.cli.messages.wrote", { path: importPath }));
    if (vscodeExists) {
      const merged = buildRooVscodeAutoImport(readJson(vscodePath), importPath);
      writeFileSync(vscodePath, JSON.stringify(merged, null, 2) + "\n", "utf8");
      printSuccess(t("common.cli.messages.rooAutoImportSet", { path: vscodePath }));
    }
  }

  printInfo(t("common.cli.messages.rooInstructions"));
  printInfo(`  ${t("common.cli.messages.rooBaseUrlValue", { value: baseUrl })}`);
  printInfo(`  ${t("common.cli.messages.apiKeyValue", { value: "<your OMNIROUTE_API_KEY>" })}`);
  printInfo(`  ${t("common.cli.messages.modelValue", { value: model })}`);
  printInfo(t("common.cli.messages.rooImportInstructions", { path: importPath }));
  return 0;
}

export function registerSetupRoo(program) {
  program
    .command("setup-roo")
    .description(t("common.cli.descriptions.setupRoo"))
    .option("--port <port>", t("common.cli.options.localPort"), "20128")
    .option("--remote <url>", t("common.cli.options.remoteUrl"))
    .option("--api-key <key>", t("common.cli.options.apiKeyEnv"))
    .option("--model <id>", t("common.cli.options.rooModel"))
    .option("--import-path <path>", t("common.cli.options.rooImportPath"))
    .option("--vscode-settings <path>", t("common.cli.options.vscodeSettings"))
    .option("--yes", t("common.cli.options.nonInteractiveModel"))
    .option("--dry-run", t("common.cli.options.dryRun"))
    .action(async (opts) => {
      const code = await runSetupRooCommand(opts);
      if (code !== 0) process.exit(code);
    });
}
