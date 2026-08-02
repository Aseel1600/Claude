import { t } from "../i18n.mjs";

const OMNIROUTE_ENV_VARS = [
  "PORT",
  "API_PORT",
  "DASHBOARD_PORT",
  "DATA_DIR",
  "REQUIRE_API_KEY",
  "LOG_LEVEL",
  "NODE_ENV",
  "REQUEST_TIMEOUT_MS",
  "ENABLE_SOCKS5_PROXY",
  "OMNIROUTE_API_KEY",
  "OMNIROUTE_BASE_URL",
  "OMNIROUTE_HTTP_TIMEOUT_MS",
];

const ENV_DEFAULTS = {
  PORT: "20128",
  DASHBOARD_PORT: "20128",
  DATA_DIR: "~/.omniroute",
  NODE_ENV: "production",
};

export function registerEnv(program) {
  const env = program.command("env").description(t("common.cli.descriptions.env"));

  env
    .command("show")
    .alias("list")
    .description(t("common.cli.descriptions.envList"))
    .option("--json", t("common.jsonOpt"))
    .action(async (opts, cmd) => {
      const globalOpts = cmd.parent.optsWithGlobals();
      await runEnvShowCommand({ ...opts, output: globalOpts.output });
    });

  env
    .command("get <key>")
    .description(t("common.cli.descriptions.envGet"))
    .action(async (key) => {
      await runEnvGetCommand(key);
    });

  env
    .command("set <key> <value>")
    .description(t("common.cli.descriptions.envSet"))
    .action(async (key, value) => {
      await runEnvSetCommand(key, value);
    });
}

export async function runEnvShowCommand(opts = {}) {
  const current = {};
  for (const key of OMNIROUTE_ENV_VARS) {
    if (process.env[key] !== undefined) current[key] = process.env[key];
  }

  if (opts.json || opts.output === "json") {
    console.log(JSON.stringify({ current, defaults: ENV_DEFAULTS }, null, 2));
    return 0;
  }

  console.log(`\n\x1b[1m\x1b[36m${t("common.cli.messages.environmentTitle")}\x1b[0m\n`);
  console.log(`  ${t("common.cli.messages.currentLabel")}`);
  if (Object.keys(current).length === 0) {
    console.log(`\x1b[2m  ${t("common.cli.messages.noneSet")}\x1b[0m`);
  } else {
    for (const [key, value] of Object.entries(current)) {
      const display = key.includes("KEY") || key.includes("SECRET") ? "***" : value;
      console.log(`\x1b[2m    ${key.padEnd(28)} ${display}\x1b[0m`);
    }
  }

  console.log(`\n  ${t("common.cli.messages.defaultsLabel")}`);
  for (const [key, value] of Object.entries(ENV_DEFAULTS)) {
    console.log(`    ${key.padEnd(28)} ${value}`);
  }

  return 0;
}

export async function runEnvGetCommand(key) {
  if (!key) {
    console.error(t("common.cli.messages.keyRequired"));
    return 1;
  }
  console.log(process.env[key] || "");
  return 0;
}

export async function runEnvSetCommand(key, value) {
  if (!key || value === undefined) {
    console.error(t("common.cli.messages.envSetUsage"));
    return 1;
  }
  process.env[key] = String(value);
  console.log(`\x1b[33m  ${key}=${value} (${t("common.cli.messages.temporary")})\x1b[0m`);
  return 0;
}
