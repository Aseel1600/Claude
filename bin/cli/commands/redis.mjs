import { spawn } from "node:child_process";
import { promisify } from "node:util";
import { execFile as execFileCb } from "node:child_process";

import { t } from "../i18n.mjs";

const execFile = promisify(execFileCb);

const DEFAULT_IMAGE = "docker.io/redis:7-alpine";
const DEFAULT_NAME = "omniroute-redis";
const DEFAULT_PORT = "6379";
const DEFAULT_VOLUME = "omniroute-redis-data";

const RUNTIME_PREFERENCE = ["podman", "docker"];

async function detectRuntime() {
  for (const candidate of RUNTIME_PREFERENCE) {
    try {
      await execFile(candidate, ["--version"], { timeout: 3000 });
      return candidate;
    } catch {
      // try next candidate
    }
  }
  return null;
}

async function containerExists(runtime, name) {
  try {
    const { stdout } = await execFile(runtime, [
      "ps",
      "-a",
      "--filter",
      `name=^${name}$`,
      "--format",
      "{{.Names}}",
    ]);
    return stdout.trim() === name;
  } catch {
    return false;
  }
}

async function containerRunning(runtime, name) {
  try {
    const { stdout } = await execFile(runtime, [
      "ps",
      "--filter",
      `name=^${name}$`,
      "--format",
      "{{.Names}}",
    ]);
    return stdout.trim() === name;
  } catch {
    return false;
  }
}

async function pingRedis(port) {
  // Minimal TCP probe via /dev/tcp — works in bash/zsh but Node has no
  // native equivalent, so spawn a short-lived `redis-cli` if available,
  // otherwise fall back to a raw socket connect.
  return new Promise((resolve) => {
    import("node:net").then(({ createConnection }) => {
      const socket = createConnection({ port: Number(port), host: "127.0.0.1" });
      const timeout = setTimeout(() => {
        socket.destroy();
        resolve(false);
      }, 1500);
      socket.once("connect", () => {
        clearTimeout(timeout);
        socket.end();
        resolve(true);
      });
      socket.once("error", () => {
        clearTimeout(timeout);
        resolve(false);
      });
    });
  });
}

function colorize(text, code) {
  if (process.stdout.isTTY === false) return text;
  return `\x1b[${code}m${text}\x1b[0m`;
}

function info(msg) {
  console.log(colorize("•", "36") + " " + msg);
}

function success(msg) {
  console.log(colorize("✓", "32") + " " + msg);
}

function warn(msg) {
  console.error(colorize("!", "33") + " " + msg);
}

function fail(msg) {
  console.error(colorize("✗", "31") + " " + msg);
}

export function registerRedis(program) {
  const redis = program.command("redis").description(t("redis.description"));

  redis
    .command("up")
    .description(t("common.cli.descriptions.redisStart"))
    .option("-p, --port <port>", t("common.cli.options.redisPortExpose"), DEFAULT_PORT)
    .option("-n, --name <name>", t("common.cli.options.containerName"), DEFAULT_NAME)
    .option("-i, --image <image>", t("common.cli.options.containerImage"), DEFAULT_IMAGE)
    .option("--no-pull", t("common.cli.options.redisNoPull"))
    .option("--runtime <runtime>", t("common.cli.options.redisRuntime"))
    .option("--password <password>", t("common.cli.options.redisPassword"))
    .action(async (opts, cmd) => {
      const globalOpts = cmd.parent.optsWithGlobals();
      const exitCode = await runRedisUpCommand({ ...opts, output: globalOpts.output });
      if (exitCode !== 0) process.exit(exitCode);
    });

  redis
    .command("down")
    .description(t("common.cli.descriptions.redisStop"))
    .option("-n, --name <name>", t("common.cli.options.containerName"), DEFAULT_NAME)
    .option("--keep-data", t("common.cli.options.redisKeepData"))
    .option("--runtime <runtime>", t("common.cli.options.redisRuntime"))
    .action(async (opts, cmd) => {
      const globalOpts = cmd.parent.optsWithGlobals();
      const exitCode = await runRedisDownCommand({ ...opts, output: globalOpts.output });
      if (exitCode !== 0) process.exit(exitCode);
    });

  redis
    .command("status")
    .description(t("common.cli.descriptions.redisStatus"))
    .option("-n, --name <name>", t("common.cli.options.containerName"), DEFAULT_NAME)
    .option("-p, --port <port>", t("common.cli.options.hostPort"), DEFAULT_PORT)
    .option("--runtime <runtime>", t("common.cli.options.redisRuntime"))
    .action(async (opts, cmd) => {
      const globalOpts = cmd.parent.optsWithGlobals();
      const exitCode = await runRedisStatusCommand({ ...opts, output: globalOpts.output });
      if (exitCode !== 0) process.exit(exitCode);
    });
}

async function pickRuntime(forced) {
  if (forced) {
    try {
      await execFile(forced, ["--version"], { timeout: 3000 });
      return forced;
    } catch (err) {
      fail(
        t("common.cli.messages.forcedRuntimeUnavailable", { runtime: forced, error: err.message })
      );
      return null;
    }
  }
  const detected = await detectRuntime();
  if (!detected) {
    fail(t("common.cli.messages.runtimesMissing"));
    return null;
  }
  return detected;
}

export async function runRedisUpCommand(opts = {}) {
  const runtime = await pickRuntime(opts.runtime);
  if (!runtime) return 1;

  const name = opts.name || DEFAULT_NAME;
  const port = opts.port || DEFAULT_PORT;
  const image = opts.image || DEFAULT_IMAGE;

  const exists = await containerExists(runtime, name);
  const running = exists && (await containerRunning(runtime, name));

  if (running) {
    success(t("common.cli.messages.containerAlreadyRunning", { name, port }));
    return 0;
  }

  if (exists && !opts.pull) {
    info(t("common.cli.messages.startingContainer", { name }));
    try {
      await execFile(runtime, ["start", name]);
      success(t("common.cli.messages.containerStarted", { name, port }));
      return 0;
    } catch (err) {
      fail(t("common.cli.messages.startContainerFailed", { error: err.message }));
      return 1;
    }
  }

  if (!opts.pull) {
    info(t("common.cli.messages.checkingImage", { image }));
    let present = false;
    try {
      const { stdout } = await execFile(runtime, [
        "images",
        "--format",
        "{{.Repository}}:{{.Tag}}",
      ]);
      present = stdout.split("\n").some((line) => line.trim() === image);
    } catch {
      // ignore — fall through to pull
    }
    if (!present) {
      info(t("common.cli.messages.pullingImage", { image }));
      try {
        await execFile(runtime, ["pull", image]);
      } catch (err) {
        fail(t("common.cli.messages.pullImageFailed", { error: err.message }));
        return 1;
      }
    }
  }

  const args = [
    "run",
    "-d",
    "--name",
    name,
    "--restart",
    "unless-stopped",
    "-p",
    `${port}:6379`,
    "-v",
    `${DEFAULT_VOLUME}:/data`,
  ];
  if (opts.password) {
    args.push("-e", `REDIS_PASSWORD=${opts.password}`);
  }
  args.push(image, "redis-server", "--appendonly", "yes");
  if (opts.password) args.push("--requirepass", opts.password);

  info(
    t("common.cli.messages.launchingContainer", { command: `${runtime} run ${args.join(" ")}` })
  );
  try {
    await execFile(runtime, args);
    success(t("common.cli.messages.containerRunning", { name, port }));
    info(t("common.cli.messages.redisEnvHint", { port }));
    return 0;
  } catch (err) {
    fail(t("common.cli.messages.launchContainerFailed", { error: err.message }));
    return 1;
  }
}

export async function runRedisDownCommand(opts = {}) {
  const runtime = await pickRuntime(opts.runtime);
  if (!runtime) return 1;

  const name = opts.name || DEFAULT_NAME;

  if (!(await containerExists(runtime, name))) {
    info(t("common.cli.messages.containerMissing", { name }));
    return 0;
  }

  try {
    await execFile(runtime, ["rm", "-f", name]);
    success(t("common.cli.messages.containerRemoved", { name }));
  } catch (err) {
    fail(t("common.cli.messages.removeContainerFailed", { error: err.message }));
    return 1;
  }

  if (!opts.keepData) {
    try {
      await execFile(runtime, ["volume", "rm", DEFAULT_VOLUME]);
      success(t("common.cli.messages.volumeRemoved", { volume: DEFAULT_VOLUME }));
    } catch (err) {
      warn(
        t("common.cli.messages.volumeRemoveFailed", { volume: DEFAULT_VOLUME, error: err.message })
      );
    }
  }
  return 0;
}

export async function runRedisStatusCommand(opts = {}) {
  const runtime = await pickRuntime(opts.runtime);
  if (!runtime) return 1;

  const name = opts.name || DEFAULT_NAME;
  const port = opts.port || DEFAULT_PORT;

  const exists = await containerExists(runtime, name);
  if (!exists) {
    console.log(
      JSON.stringify(
        { runtime, name, port, exists: false, running: false, reachable: false },
        null,
        2
      )
    );
    return 0;
  }

  const running = await containerRunning(runtime, name);
  const reachable = running ? await pingRedis(port) : false;

  if (opts.json || opts.output === "json") {
    console.log(JSON.stringify({ runtime, name, port, exists, running, reachable }, null, 2));
    return 0;
  }

  console.log(`\n\x1b[1m\x1b[36m${t("common.cli.messages.redisTitle", { runtime })}\x1b[0m\n`);
  console.log(`  ${t("common.cli.messages.redisContainerLabel")}   ${name}`);
  console.log(
    `  ${t("common.cli.messages.redisExistsLabel")}      ${exists ? t("common.cli.messages.yes") : t("common.cli.messages.no")}`
  );
  console.log(
    `  ${t("common.cli.messages.redisRunningLabel")}     ${running ? t("common.cli.messages.yes") : t("common.cli.messages.no")}`
  );
  console.log(
    `  ${t("common.cli.messages.redisReachableLabel")}   ${reachable ? t("common.cli.messages.yes") : t("common.cli.messages.no")} (port ${port})`
  );
  if (running && !reachable) {
    warn(t("common.cli.messages.redisUnreachable"));
  }
  if (!running) {
    info(t("common.cli.messages.redisRunHint"));
  }
  return 0;
}
