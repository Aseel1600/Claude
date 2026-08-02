/**
 * omniroute setup-kilo — configure Kilo Code to use OmniRoute.
 *
 * Kilo Code (kilocode.kilo-code, a Cline/Roo descendant) has two surfaces:
 *   - CLI/standalone mode reads ~/.local/share/kilo/auth.json.
 *   - The VS Code extension reads `kilocode.*` keys from VS Code settings.json.
 * This writes BOTH (matching the OmniRoute dashboard) and prints the UI settings.
 *
 * Unlike Cline, Kilo's openAi baseURL INCLUDES /v1 (it appends /chat/completions).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";
import { printHeading, printInfo, printSuccess, printError, createPrompt } from "../io.mjs";
import { t } from "../i18n.mjs";
import { resolveActiveContext } from "../contexts.mjs";

/** Ensure the URL ends with /v1 (Kilo appends /chat/completions to it). */
function ensureV1(url) {
  const s = String(url || "").replace(/\/+$/, "");
  return s.endsWith("/v1") ? s : `${s}/v1`;
}

/** Resolve baseUrl (WITH /v1) + apiKey from flags → active context → localhost. */
export function resolveKiloTarget(opts = {}) {
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

/** Merge the OmniRoute openai-compatible provider into Kilo's CLI auth.json. */
export function buildKiloAuth(existing, { apiKey, baseUrl, model }) {
  const auth = { ...(existing || {}) };
  auth["openai-compatible"] = {
    ...(auth["openai-compatible"] || {}),
    apiKey: apiKey || "sk_omniroute",
    baseUrl,
    model,
  };
  return auth;
}

/** Merge the kilocode.* keys into VS Code settings.json (extension surface). */
export function buildKiloVscodeSettings(existing, { apiKey, baseUrl, model }) {
  const s = { ...(existing || {}) };
  s["kilocode.customProvider"] = {
    name: "OmniRoute",
    baseURL: baseUrl,
    apiKey: apiKey || "sk_omniroute",
  };
  s["kilocode.defaultModel"] = model;
  return s;
}

function readJson(path) {
  try {
    if (existsSync(path)) return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    /* corrupt/missing */
  }
  return {};
}

async function fetchModelIds(root, apiKey) {
  try {
    const headers = { "Content-Type": "application/json" };
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
    const res = await fetch(`${root.replace(/\/v1$/, "")}/v1/models`, {
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

export async function runSetupKiloCommand(opts = {}) {
  const { baseUrl, apiKey } = resolveKiloTarget(opts);
  const dryRun = Boolean(opts.dryRun ?? opts["dry-run"]);
  const authPath =
    opts.authPath ??
    opts["auth-path"] ??
    join(os.homedir(), ".local", "share", "kilo", "auth.json");
  const vscodePath =
    opts.vscodeSettings ??
    opts["vscode-settings"] ??
    join(os.homedir(), ".config", "Code", "User", "settings.json");

  printHeading(t("common.cli.messages.kiloTitle"));
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
      const prompt = createPrompt();
      try {
        model = await prompt.ask(t("common.cli.messages.kiloModelPrompt"));
      } finally {
        prompt.close();
      }
    }
  }
  if (!model) {
    printError(t("common.cli.messages.kiloModelRequired"));
    return 2;
  }

  const auth = buildKiloAuth(readJson(authPath), { apiKey, baseUrl, model });
  // Only touch VS Code settings.json if it already exists (avoid creating a
  // bogus one for users who don't use that VS Code variant).
  const vscodeExists = existsSync(vscodePath);
  const vscodeSettings = vscodeExists
    ? buildKiloVscodeSettings(readJson(vscodePath), { apiKey, baseUrl, model })
    : null;

  if (dryRun) {
    console.log(t("common.cli.messages.dryRunHeader", { path: authPath }));
    console.log(
      JSON.stringify(
        {
          "openai-compatible": {
            ...auth["openai-compatible"],
            apiKey: apiKey ? "set" : "sk_omniroute",
          },
        },
        null,
        2
      )
    );
    console.log(
      `${t("common.cli.messages.dryRunHeader", { path: vscodePath })} ${vscodeExists ? t("common.cli.messages.kiloWouldMerge") : t("common.cli.messages.fileAbsentSkipped")}`
    );
  } else {
    mkdirSync(join(authPath, ".."), { recursive: true });
    writeFileSync(authPath, JSON.stringify(auth, null, 2) + "\n", "utf8");
    printSuccess(t("common.cli.messages.wrote", { path: authPath }));
    if (vscodeSettings) {
      writeFileSync(vscodePath, JSON.stringify(vscodeSettings, null, 2) + "\n", "utf8");
      printSuccess(t("common.cli.messages.kiloSettingsUpdated", { path: vscodePath }));
    } else {
      printInfo(t("common.cli.messages.vscodeSettingsSkipped", { path: vscodePath }));
    }
  }

  printInfo(t("common.cli.messages.kiloExtensionInstructions"));
  printInfo(`  ${t("common.cli.messages.kiloBaseUrlValue", { value: baseUrl })}`);
  printInfo(`  ${t("common.cli.messages.apiKeyValue", { value: "<your OMNIROUTE_API_KEY>" })}`);
  printInfo(`  ${t("common.cli.messages.modelValue", { value: model })}`);
  return 0;
}

export function registerSetupKilo(program) {
  program
    .command("setup-kilo")
    .description(t("common.cli.descriptions.setupKilo"))
    .option("--port <port>", t("common.cli.options.localPort"), "20128")
    .option("--remote <url>", t("common.cli.options.remoteUrl"))
    .option("--api-key <key>", t("common.cli.options.apiKeyEnv"))
    .option("--model <id>", t("common.cli.options.kiloModel"))
    .option("--auth-path <path>", t("common.cli.options.kiloAuthPath"))
    .option("--vscode-settings <path>", t("common.cli.options.vscodeSettings"))
    .option("--yes", t("common.cli.options.nonInteractiveModel"))
    .option("--dry-run", t("common.cli.options.dryRun"))
    .action(async (opts) => {
      const code = await runSetupKiloCommand(opts);
      if (code !== 0) process.exit(code);
    });
}
