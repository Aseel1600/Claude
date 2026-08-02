import { printHeading, printInfo, printSuccess, printError } from "../io.mjs";
import { t } from "../i18n.mjs";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { resolveDataDir } from "../data-dir.mjs";
import { registerContexts } from "./contexts.mjs";

function ensureBackup(configPath) {
  if (!fs.existsSync(configPath)) return;
  const backupDir = path.join(path.dirname(configPath), ".omniroute.bak");
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, path.basename(configPath) + ".bak");
  fs.copyFileSync(configPath, backupPath);
  return backupPath;
}

async function runConfigListCommand(opts = {}) {
  const { detectAllTools } = await import("../../../src/lib/cli-helper/tool-detector.ts");
  const tools = await detectAllTools();

  if (opts.json) {
    console.log(JSON.stringify(tools, null, 2));
  } else {
    printHeading(t("common.cli.messages.configStatusTitle"));
    for (const tool of tools) {
      const status = tool.configured
        ? `✓ ${t("common.cli.messages.configured")}`
        : tool.installed
          ? `✗ ${t("common.cli.messages.notConfigured")}`
          : `✗ ${t("common.cli.messages.notInstalled")}`;
      console.log(`  ${tool.name.padEnd(14)} ${status}`);
      if (tool.version) console.log(`    ${t("common.cli.messages.versionLabel")} ${tool.version}`);
      console.log(`    ${t("common.cli.messages.configLabel")}  ${tool.configPath}`);
    }
  }
  return 0;
}

async function runConfigGetCommand(toolId, opts = {}) {
  if (!toolId) {
    printError(t("common.cli.messages.toolIdRequired", { usage: "omniroute config get <tool>" }));
    return 1;
  }
  const { detectTool } = await import("../../../src/lib/cli-helper/tool-detector.ts");
  const tool = await detectTool(toolId);
  if (!tool) {
    printError(t("common.cli.messages.unknownTool", { tool: toolId }));
    return 1;
  }
  if (opts.json) {
    console.log(JSON.stringify(tool, null, 2));
  } else {
    printHeading(t("common.cli.messages.configurationTitle", { name: tool.name }));
    console.log(
      `  ${t("common.cli.messages.installedLabel")}  ${tool.installed ? t("common.yes") : t("common.no")}`
    );
    console.log(
      `  ${t("common.cli.messages.configuredLabel")} ${tool.configured ? t("common.yes") : t("common.no")}`
    );
    console.log(`  ${t("common.cli.messages.configLabel")}     ${tool.configPath}`);
    if (tool.version) console.log(`  ${t("common.cli.messages.versionLabel")}    ${tool.version}`);
    if (tool.configContents) {
      console.log(`\n  ${t("common.cli.messages.contentsLabel")}`);
      console.log(tool.configContents);
    }
  }
  return 0;
}

async function runConfigSetCommand(toolId, opts = {}) {
  if (!toolId) {
    printError(
      t("common.cli.messages.toolIdRequired", { usage: "omniroute config set <tool> [options]" })
    );
    return 1;
  }

  const baseUrl = opts.baseUrl || "http://localhost:20128/v1";
  const apiKey = opts.apiKey;
  const model = opts.model;

  if (!apiKey) {
    printError(t("common.cli.messages.apiKeyRequired"));
    return 1;
  }

  const { generateConfig } = await import("../../../src/lib/cli-helper/config-generator/index.js");
  const result = await generateConfig(toolId, { baseUrl, apiKey, model });

  if (!result.success) {
    printError(result.error || t("common.cli.messages.generateConfigFailed"));
    return 1;
  }

  const nonInteractive = opts.nonInteractive || opts.yes;

  if (!nonInteractive) {
    console.log(`\n  ${t("common.cli.messages.aboutToWriteConfig", { path: result.configPath })}`);
    console.log(`  ${t("common.cli.messages.contentPreview")}\n`);
    console.log(result.content);
    console.log("");

    const readline = await import("node:readline");
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise((resolve) =>
      rl.question(t("common.cli.messages.proceed"), resolve)
    );
    rl.close();

    if (!/^y(es)?$/i.test(answer)) {
      console.log(t("common.cli.messages.aborted"));
      return 0;
    }
  }

  const dir = path.dirname(result.configPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const backupPath = ensureBackup(result.configPath);
  if (backupPath) printInfo(t("common.cli.messages.backupSaved", { path: backupPath }));

  fs.writeFileSync(result.configPath, result.content, "utf-8");
  printSuccess(t("common.cli.messages.configWritten", { path: result.configPath }));
  return 0;
}

async function runConfigValidateCommand(toolId, opts = {}) {
  if (!toolId) {
    printError(
      t("common.cli.messages.toolIdRequired", { usage: "omniroute config validate <tool>" })
    );
    return 1;
  }

  const baseUrl = opts.baseUrl || "http://localhost:20128/v1";
  const apiKey = opts.apiKey || "test-key";
  const model = opts.model;

  const { generateConfig } = await import("../../../src/lib/cli-helper/config-generator/index.js");
  const result = await generateConfig(toolId, { baseUrl, apiKey, model });

  if (!result.success) {
    printError(t("common.cli.messages.validationFailed", { error: result.error }));
    return 1;
  }

  printSuccess(t("common.cli.messages.configValid", { tool: toolId }));
  if (opts.json) {
    console.log(JSON.stringify({ valid: true, content: result.content }, null, 2));
  }
  return 0;
}

function loadI18nLocales() {
  const cfgPath = path.join(
    path.dirname(path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))))),
    "config",
    "i18n.json"
  );
  try {
    return JSON.parse(fs.readFileSync(cfgPath, "utf8")).locales || [];
  } catch {
    return [];
  }
}

function getCliEnvPath() {
  return path.join(resolveDataDir(), ".env");
}

function upsertEnvLine(envPath, key, value) {
  let content = "";
  if (fs.existsSync(envPath)) content = fs.readFileSync(envPath, "utf8");
  const lines = content.split("\n");
  const idx = lines.findIndex((l) => l.trimStart().startsWith(`${key}=`));
  const newLine = `${key}=${value}`;
  if (idx >= 0) {
    lines[idx] = newLine;
  } else {
    if (content && !content.endsWith("\n")) lines.push("");
    lines.push(newLine);
  }
  const dir = path.dirname(envPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${envPath}.tmp`;
  fs.writeFileSync(tmp, lines.join("\n"), "utf8");
  fs.renameSync(tmp, envPath);
}

export async function runConfigLangGetCommand(opts = {}) {
  const { getLocale } = await import("../i18n.mjs");
  const code = getLocale();
  const locales = loadI18nLocales();
  const entry = locales.find((l) => l.code === code);
  const name = entry ? entry.english : code;
  if (opts.output === "json" || opts.json) {
    console.log(JSON.stringify({ code, name }, null, 2));
  } else {
    console.log(t("config.lang.current", { code, name }));
  }
  return 0;
}

export async function runConfigLangSetCommand(code, opts = {}) {
  if (!code) {
    console.error(t("config.lang.noCode"));
    return 1;
  }
  const locales = loadI18nLocales();
  const entry = locales.find((l) => l.code === code);
  if (!entry) {
    console.error(t("config.lang.unknown", { code }));
    return 1;
  }
  const { getLocale, setLocale } = await import("../i18n.mjs");
  const current = getLocale();
  if (current === code && !opts.force) {
    console.log(t("config.lang.alreadySet", { code }));
    return 0;
  }
  const envPath = getCliEnvPath();
  upsertEnvLine(envPath, "OMNIROUTE_LANG", code);
  setLocale(code);
  console.log(t("config.lang.saved", { code, name: entry.english }));
  console.log(t("config.lang.envHint", { code }));
  return 0;
}

export async function runConfigLangListCommand(opts = {}) {
  const { getLocale } = await import("../i18n.mjs");
  const current = getLocale();
  const locales = loadI18nLocales();
  if (opts.output === "json" || opts.json) {
    console.log(
      JSON.stringify(
        locales.map((l) => ({ ...l, active: l.code === current })),
        null,
        2
      )
    );
    return 0;
  }
  console.log(`\n\x1b[1m\x1b[36m${t("config.lang.listTitle")}\x1b[0m\n`);
  for (const loc of locales) {
    const active = loc.code === current ? " \x1b[32m◀ active\x1b[0m" : "";
    console.log(
      `  ${loc.flag}  ${loc.code.padEnd(8)} ${loc.english.padEnd(28)} ${loc.native}${active}`
    );
  }
  console.log("");
  return 0;
}

export function registerConfig(program) {
  const config = program.command("config").description(t("common.cli.descriptions.config"));

  config
    .command("list")
    .description(t("common.cli.descriptions.configList"))
    .option("--json", t("common.jsonOpt"))
    .action(async (opts, cmd) => {
      const globalOpts = cmd.parent.optsWithGlobals();
      const exitCode = await runConfigListCommand({ ...opts, output: globalOpts.output });
      if (exitCode !== 0) process.exit(exitCode);
    });

  config
    .command("get <tool>")
    .description(t("common.cli.descriptions.configGet"))
    .option("--json", t("common.jsonOpt"))
    .action(async (tool, opts, cmd) => {
      const globalOpts = cmd.parent.optsWithGlobals();
      const exitCode = await runConfigGetCommand(tool, { ...opts, output: globalOpts.output });
      if (exitCode !== 0) process.exit(exitCode);
    });

  config
    .command("set <tool>")
    .description(t("common.cli.descriptions.configSet"))
    .option("--model <model>", t("common.cli.options.modelWhereApplicable"))
    .option("--non-interactive", t("common.cli.options.nonInteractive"))
    .option("--yes", t("common.yesOpt"))
    .action(async (tool, opts, cmd) => {
      const globalOpts = cmd.parent.optsWithGlobals();
      const exitCode = await runConfigSetCommand(tool, {
        ...opts,
        apiKey: opts.apiKey || globalOpts.apiKey || process.env.OMNIROUTE_API_KEY,
        baseUrl: opts.baseUrl || globalOpts.baseUrl || process.env.OMNIROUTE_BASE_URL,
        output: globalOpts.output,
      });
      if (exitCode !== 0) process.exit(exitCode);
    });

  config
    .command("validate <tool>")
    .description(t("common.cli.descriptions.configValidate"))
    .option("--model <model>", t("common.cli.options.modelWhereApplicable"))
    .option("--json", t("common.jsonOpt"))
    .action(async (tool, opts, cmd) => {
      const globalOpts = cmd.parent.optsWithGlobals();
      const exitCode = await runConfigValidateCommand(tool, {
        ...opts,
        apiKey: opts.apiKey || globalOpts.apiKey || process.env.OMNIROUTE_API_KEY,
        baseUrl: opts.baseUrl || globalOpts.baseUrl || process.env.OMNIROUTE_BASE_URL,
        output: globalOpts.output,
      });
      if (exitCode !== 0) process.exit(exitCode);
    });

  // Convenience alias: `config opencode` → `config set opencode`
  // Matches the documented CLI usage in docs/frameworks/OPENCODE.md.
  config
    .command("opencode")
    .description(t("common.cli.descriptions.configOpenCode"))
    .option("--model <model>", t("common.cli.options.modelIdentifier"))
    .option("--non-interactive", t("common.cli.options.nonInteractive"))
    .option("--yes", t("common.yesOpt"))
    .action(async (opts, cmd) => {
      const globalOpts = cmd.parent.optsWithGlobals();
      const exitCode = await runConfigSetCommand("opencode", {
        ...opts,
        apiKey: opts.apiKey || globalOpts.apiKey || process.env.OMNIROUTE_API_KEY,
        baseUrl: opts.baseUrl || globalOpts.baseUrl || process.env.OMNIROUTE_BASE_URL,
        output: globalOpts.output,
      });
      if (exitCode !== 0) process.exit(exitCode);
    });

  // lang subgroup
  const lang = config.command("lang").description(t("config.lang.description"));
  lang
    .command("get")
    .description(t("config.lang.getDescription"))
    .option("--json", t("common.jsonOpt"))
    .action(async (opts, cmd) => {
      const globalOpts = cmd.parent.parent.optsWithGlobals();
      const exitCode = await runConfigLangGetCommand({ ...opts, output: globalOpts.output });
      if (exitCode !== 0) process.exit(exitCode);
    });
  lang
    .command("set <code>")
    .description(t("config.lang.setDescription"))
    .option("--force", t("common.cli.options.forceActive"))
    .action(async (code, opts, cmd) => {
      const exitCode = await runConfigLangSetCommand(code, opts);
      if (exitCode !== 0) process.exit(exitCode);
    });
  lang
    .command("list")
    .description(t("config.lang.listDescription"))
    .option("--json", t("common.jsonOpt"))
    .action(async (opts, cmd) => {
      const globalOpts = cmd.parent.parent.optsWithGlobals();
      const exitCode = await runConfigLangListCommand({ ...opts, output: globalOpts.output });
      if (exitCode !== 0) process.exit(exitCode);
    });

  // Register contexts/profiles CRUD as a subgroup of config.
  registerContexts(config);
}
