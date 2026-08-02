/** Configure Qwen Code's OpenAI-compatible provider for OmniRoute. */

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  mergeQwenCodeEnv,
  mergeQwenCodeSettings,
  normalizeQwenCodeBaseUrl,
} from "../../../src/shared/services/qwenCodeConfig.ts";
import { resolveActiveContext } from "../contexts.mjs";
import { createPrompt, printError, printHeading, printInfo, printSuccess } from "../io.mjs";
import { t } from "../i18n.mjs";

/** Resolve base URL and key from flags, active context, then local defaults. */
export function resolveQwenTarget(opts = {}) {
  let root = opts.remote ? String(opts.remote) : "";
  let context;

  if (!root || !(opts.apiKey ?? opts["api-key"])) {
    try {
      context = resolveActiveContext(opts.context ?? process.env.OMNIROUTE_CONTEXT);
    } catch {
      // An active context is optional for local setup.
    }
  }

  if (!root) root = context?.baseUrl || "";
  if (!root) {
    const port = Number(opts.port ?? process.env.PORT ?? 20128) || 20128;
    root = `http://localhost:${port}`;
  }

  const apiKey =
    opts.apiKey ??
    opts["api-key"] ??
    context?.accessToken ??
    context?.apiKey ??
    process.env.OMNIROUTE_API_KEY ??
    "sk_omniroute";

  return { baseUrl: normalizeQwenCodeBaseUrl(root), apiKey };
}

const readSettings = (filePath) => {
  if (!existsSync(filePath)) return {};
  const parsed = JSON.parse(readFileSync(filePath, "utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(t("common.cli.messages.qwenSettingsObjectRequired"));
  }
  return parsed;
};

const readText = (filePath) => (existsSync(filePath) ? readFileSync(filePath, "utf8") : "");

const writeAtomic = (filePath, content, mode) => {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(tempPath, content, { encoding: "utf8", mode });
    if (mode !== undefined) chmodSync(tempPath, mode);
    renameSync(tempPath, filePath);
  } catch (error) {
    try {
      unlinkSync(tempPath);
    } catch {
      // The temporary file may not have been created.
    }
    throw error;
  }
};

const fetchModelIds = async (baseUrl, apiKey) => {
  try {
    const response = await fetch(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return [];
    const body = await response.json();
    const models = Array.isArray(body) ? body : (body.data ?? body.models ?? []);
    return models.map((entry) => (typeof entry === "string" ? entry : entry?.id)).filter(Boolean);
  } catch {
    return [];
  }
};

export async function runSetupQwenCommand(opts = {}) {
  const { baseUrl, apiKey } = resolveQwenTarget(opts);
  const dryRun = Boolean(opts.dryRun ?? opts["dry-run"]);
  const settingsPath =
    opts.configPath ?? opts["config-path"] ?? path.join(os.homedir(), ".qwen", "settings.json");
  const envPath = opts.envPath ?? opts["env-path"] ?? path.join(path.dirname(settingsPath), ".env");

  printHeading(t("common.cli.messages.qwenTitle"));
  printInfo(t("common.cli.messages.qwenBaseUrlInfo", { baseUrl }));

  let model = String(opts.model || "").trim();
  if (!model && !opts.yes) {
    const modelIds = await fetchModelIds(baseUrl, apiKey);
    if (modelIds.length > 0) {
      printInfo(
        t("common.cli.messages.examples", {
          models: `${modelIds.slice(0, 20).join(", ")}${modelIds.length > 20 ? " …" : ""}`,
        })
      );
    }
    const prompt = createPrompt();
    try {
      model = String(await prompt.ask(t("common.cli.messages.qwenModelPrompt"))).trim();
    } finally {
      prompt.close();
    }
  }

  if (!model) {
    printError(t("common.cli.messages.modelRequired"));
    return 2;
  }

  try {
    const settings = mergeQwenCodeSettings(readSettings(settingsPath), { baseUrl, model });
    const envText = mergeQwenCodeEnv(readText(envPath), apiKey);
    const settingsText = `${JSON.stringify(settings, null, 2)}\n`;

    if (dryRun) {
      console.log(`\n${settingsText}`);
      printInfo(t("common.cli.messages.qwenDrySettings", { path: settingsPath }));
      printInfo(t("common.cli.messages.qwenDryCredential", { path: envPath }));
      return 0;
    }

    mkdirSync(path.dirname(settingsPath), { recursive: true, mode: 0o700 });
    mkdirSync(path.dirname(envPath), { recursive: true, mode: 0o700 });
    writeAtomic(settingsPath, settingsText);
    writeAtomic(envPath, envText, 0o600);
    printSuccess(t("common.cli.messages.wrote", { path: settingsPath }));
    printSuccess(t("common.cli.messages.qwenUpdated", { path: envPath }));
    printInfo(t("common.cli.messages.runQwen"));
    return 0;
  } catch (error) {
    printError(t("common.cli.messages.qwenFailed", { error: error?.message || error }));
    return 1;
  }
}

export function registerSetupQwen(program) {
  program
    .command("setup-qwen")
    .description(t("common.cli.descriptions.setupQwen"))
    .option("--port <port>", t("common.cli.options.localPort"), "20128")
    .option("--remote <url>", t("common.cli.options.qwenRemote"))
    .option("--api-key <key>", t("common.cli.options.qwenApiKey"))
    .option("--model <id>", t("common.cli.options.qwenModel"))
    .option("--config-path <path>", t("common.cli.options.qwenConfigPath"))
    .option("--env-path <path>", t("common.cli.options.qwenEnvPath"))
    .option("--yes", t("common.cli.options.qwenYes"))
    .option("--dry-run", t("common.cli.options.qwenDryRun"))
    .action(async (opts) => {
      const code = await runSetupQwenCommand(opts);
      if (code !== 0) process.exitCode = code;
    });
}
