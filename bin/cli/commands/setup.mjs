import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createPrompt, printHeading, printInfo, printSuccess } from "../io.mjs";
import { openOmniRouteDb } from "../sqlite.mjs";
import { getSettings, hashManagementPassword, updateSettings } from "../settings-store.mjs";
import { testProviderApiKey } from "../provider-test.mjs";
import { updateProviderTestResult, upsertApiKeyProviderConnection } from "../provider-store.mjs";
import {
  formatProviderChoices,
  getProviderDisplayName,
  resolveProviderChoice,
} from "../provider-catalog.mjs";
import { registerSetupOpenCode } from "./setup-open-code.mjs";
import { t } from "../i18n.mjs";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

async function getListCliTools() {
  const { listCliTools } = await import(`${PROJECT_ROOT}/src/shared/constants/cliTools.ts`);
  return listCliTools;
}

function wantsProviderSetup(opts) {
  return opts.addProvider || Boolean(opts.provider) || Boolean(opts.apiKey);
}

async function resolvePassword(opts, prompt, nonInteractive) {
  if (opts.password) return opts.password;
  if (process.env.INITIAL_PASSWORD) return process.env.INITIAL_PASSWORD;
  if (nonInteractive) return "";

  const answer = await prompt.ask(t("common.cli.messages.setupPasswordPrompt"), "N");
  if (!/^y(es)?$/i.test(answer)) return "";

  const password = await prompt.askSecret(t("common.cli.messages.adminPasswordPrompt"));
  const confirm = await prompt.askSecret(t("common.cli.messages.confirmPasswordPrompt"));
  if (password !== confirm) {
    throw new Error(t("common.cli.messages.passwordsDoNotMatch"));
  }
  return password;
}

async function setupPassword(db, opts, prompt, nonInteractive) {
  const password = await resolvePassword(opts, prompt, nonInteractive);
  if (!password) {
    const settings = getSettings(db);
    if (!settings.password) {
      updateSettings(db, { requireLogin: false });
    }
    if (!nonInteractive) {
      printInfo(t("common.cli.messages.passwordSetupSkipped"));
    }
    return false;
  }

  if (password.length < 8) {
    throw new Error(t("common.cli.messages.passwordMinLength"));
  }

  const hashedPassword = await hashManagementPassword(password);
  updateSettings(db, {
    password: hashedPassword,
    requireLogin: true,
  });
  printSuccess(t("common.cli.messages.adminPasswordConfigured"));
  return true;
}

async function resolveProviderInput(opts, prompt, nonInteractive) {
  let provider = opts.provider;
  let apiKey = opts.apiKey;
  let name = opts.providerName;
  const defaultModel = opts.defaultModel;
  const baseUrl = opts.providerBaseUrl;

  if (!provider && !nonInteractive) {
    console.log(t("common.cli.messages.chooseProvider"));
    console.log(formatProviderChoices());
    provider = resolveProviderChoice(
      await prompt.ask(t("common.cli.messages.providerPrompt"), "1")
    );
  }

  provider = provider || "openai";
  if (!apiKey && !nonInteractive) {
    apiKey = await prompt.ask(
      t("common.cli.messages.providerApiKeyPrompt", { provider: getProviderDisplayName(provider) })
    );
  }

  if (!apiKey) {
    throw new Error(t("common.cli.messages.providerApiKeyRequired"));
  }

  if (!name) {
    name = getProviderDisplayName(provider);
  }

  return {
    provider,
    apiKey,
    name,
    defaultModel: defaultModel || null,
    providerSpecificData: baseUrl ? { baseUrl } : null,
  };
}

async function setupProvider(db, opts, prompt, nonInteractive) {
  if (!wantsProviderSetup(opts) && nonInteractive) return null;

  if (!wantsProviderSetup(opts)) {
    const answer = await prompt.ask(t("common.cli.messages.addFirstProviderPrompt"), "Y");
    if (/^n(o)?$/i.test(answer)) return null;
  }

  const input = await resolveProviderInput(opts, prompt, nonInteractive);
  const connection = upsertApiKeyProviderConnection(db, input);
  printSuccess(t("common.cli.messages.providerConfigured", { name: connection.name }));

  if (opts.testProvider) {
    printInfo(t("common.cli.messages.testingProvider", { provider: connection.provider }));
    const result = await testProviderApiKey({
      provider: input.provider,
      apiKey: input.apiKey,
      defaultModel: input.defaultModel,
      baseUrl: input.providerSpecificData?.baseUrl || null,
    });
    updateProviderTestResult(db, connection.id, result);

    if (result.valid) {
      printSuccess(t("common.cli.messages.providerTestPassedLine"));
    } else {
      printInfo(
        t("common.cli.messages.providerTestFailedLine", {
          error: result.error || t("common.cli.messages.unknownError"),
        })
      );
    }
  }

  return connection;
}

export function registerSetup(program) {
  program
    .command("setup")
    .description(t("setup.title"))
    .option("--password <value>", t("common.cli.options.setupPassword"))
    .option("--add-provider", t("common.cli.options.setupAddProvider"))
    .option("--provider <id>", t("common.cli.options.setupProvider"))
    .option("--provider-name <name>", t("common.cli.options.setupProviderName"))
    .option("--api-key <value>", t("common.cli.options.setupApiKey"))
    .option("--default-model <model>", t("common.cli.options.setupDefaultModel"))
    .option("--provider-base-url <url>", t("common.cli.options.setupProviderBaseUrlOverride"))
    .option("--test-provider", t("common.cli.options.setupTestProvider"))
    .option("--non-interactive", t("common.cli.options.setupNonInteractive"))
    .option("--list", t("common.cli.options.setupListTools"))
    .action(async (opts, cmd) => {
      const globalOpts = cmd.optsWithGlobals();
      const exitCode = await runSetupCommand({ ...opts, output: globalOpts.output });
      if (exitCode !== 0) process.exit(exitCode);
    });

  // Wire up `omniroute setup opencode` subcommand. Kept inside registerSetup
  // so it always travels with the parent command (avoids a separate register
  // call in the registry that would silently break if the parent renames).
  registerSetupOpenCode(program.commands.find((c) => c.name() === "setup"));
}

export async function runSetupCommand(opts = {}) {
  if (opts.list) {
    const listCliTools = await getListCliTools();
    const tools = listCliTools();
    if (opts.json || opts.output === "json") {
      console.log(JSON.stringify(tools, null, 2));
    } else {
      printHeading(t("common.cli.messages.supportedCliToolsTitle"));
      for (const tool of tools) {
        const cmd = tool.defaultCommand || tool.defaultCommands?.[0] || "";
        const cmdStr = cmd ? `  \x1b[2m(${cmd})\x1b[0m` : "";
        console.log(`  • ${tool.name}${cmdStr}`);
      }
    }
    return 0;
  }

  const nonInteractive = opts.nonInteractive ?? false;
  const prompt = createPrompt();

  try {
    printHeading(t("common.cli.messages.setupTitle"));
    const { db, dbPath } = await openOmniRouteDb();
    printInfo(t("common.cli.messages.databasePath", { path: dbPath }));

    const before = getSettings(db);
    const passwordChanged = await setupPassword(db, opts, prompt, nonInteractive);
    const providerConnection = await setupProvider(db, opts, prompt, nonInteractive);

    updateSettings(db, { setupComplete: true });
    const after = getSettings(db);
    db.close();

    console.log("");
    printSuccess(t("common.cli.messages.setupComplete"));
    printInfo(
      after.requireLogin === true
        ? passwordChanged
          ? t("common.cli.messages.loginEnabledUpdated")
          : t("common.cli.messages.loginEnabled")
        : t("common.cli.messages.loginDisabled")
    );
    if (providerConnection) {
      printInfo(
        t("common.cli.messages.providerInfoLine", {
          provider: providerConnection.provider,
          name: providerConnection.name,
        })
      );
    } else if (!before.setupComplete) {
      printInfo(t("common.cli.messages.providerSkipped"));
    }

    return 0;
  } finally {
    prompt.close();
  }
}
