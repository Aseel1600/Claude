import {
  copyFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createDecipheriv, randomBytes } from "node:crypto";
import { join, extname, basename } from "node:path";
import { Readable } from "node:stream";
import { resolveDataDir } from "../data-dir.mjs";
import { getBaseUrl, isServerUp } from "../api.mjs";
import { t } from "../i18n.mjs";
import { CLI_TOKEN_HEADER, getCliToken } from "../utils/cliToken.mjs";
import {
  createFullBackup,
  getFullBackupDir,
  getFullBackupFileNames,
} from "../../../src/lib/fullBackupService.ts";

function getBackupDir() {
  return getFullBackupDir(resolveDataDir());
}

const FILES_TO_BACKUP = getFullBackupFileNames().map((name) => ({ name }));

export function registerBackup(program) {
  const backup = program.command("backup").description(t("backup.description"));

  backup
    .command("create")
    .description(t("backup.createDescription"))
    .option("--name <name>", t("backup.nameOpt"))
    .option("--cloud", t("backup.cloudOpt"))
    .option("--encrypt", t("backup.encryptOpt"))
    .option("--key-file <path>", t("backup.keyFileOpt"))
    .option("--exclude <pattern>", t("backup.excludeOpt"), (v, prev = []) => [...prev, v], [])
    .option("--retention <n>", t("backup.retentionOpt"), parseInt)
    .action(async (opts) => {
      const exitCode = await runBackupCommand(opts);
      if (exitCode !== 0) process.exit(exitCode);
    });

  const auto = backup.command("auto").description(t("backup.auto.title"));

  auto
    .command("enable")
    .description(t("backup.auto.enableDescription"))
    .option("--cron <expr>", t("backup.auto.cronOpt"), "0 3 * * *")
    .option("--cloud", t("backup.cloudOpt"))
    .option("--encrypt", t("backup.encryptOpt"))
    .option("--retention <n>", t("backup.retentionOpt"), parseInt)
    .action(async (opts) => {
      const exitCode = await runBackupAutoEnableCommand(opts);
      if (exitCode !== 0) process.exit(exitCode);
    });

  auto
    .command("disable")
    .description(t("backup.auto.disableDescription"))
    .action(async () => {
      const exitCode = await runBackupAutoDisableCommand();
      if (exitCode !== 0) process.exit(exitCode);
    });

  auto
    .command("status")
    .description(t("backup.auto.statusDescription"))
    .action(async () => {
      const exitCode = await runBackupAutoStatusCommand();
      if (exitCode !== 0) process.exit(exitCode);
    });

  // Legacy: `omniroute backup` without a subcommand still creates a backup
  // (documented as the canonical usage in USER_GUIDE.md / CLI-TOOLS.md /
  // AGENT-SKILLS.md). No flags are declared here — declaring the same
  // option names as `create`/`auto enable` here previously shadowed them
  // (#8512), and no doc shows `omniroute backup` invoked with flags.
  backup.action(async (opts) => {
    const exitCode = await runBackupCommand(opts);
    if (exitCode !== 0) process.exit(exitCode);
  });
}

export function registerRestore(program) {
  program
    .command("restore [backupId]")
    .description(t("backup.restoreDescription"))
    .option("--list", "List available backups")
    .option("--yes", "Skip confirmation")
    .action(async (backupId, opts) => {
      const exitCode = await runRestoreCommand(backupId, opts);
      if (exitCode !== 0) process.exit(exitCode);
    });
}

async function promptPassphrase() {
  const readline = await import("node:readline");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) =>
    rl.question(t("backup.passphrasePrompt"), (ans) => {
      rl.close();
      resolve(ans.trim());
    })
  );
}

export async function runBackupCommand(opts = {}) {
  let passphrase = null;
  if (opts.encrypt) {
    if (opts.keyFile) {
      passphrase = readFileSync(opts.keyFile, "utf8").trim();
    } else {
      passphrase = await promptPassphrase();
      if (!passphrase) {
        console.error(t("backup.noPassphrase"));
        return 1;
      }
    }
  }

  return createFullBackup(opts, {
    dataDir: resolveDataDir(),
    uploadBackupToCloud: ({ backupPath, info }) => _uploadBackupToCloud(backupPath, info),
    messages: {
      creating: t("backup.creating"),
      noPassphrase: t("backup.noPassphrase"),
      noFiles: t("backup.noFiles"),
      done: (backupPath) => t("backup.done", { path: backupPath }),
      failed: (error) => t("backup.failed", { error }),
      cloudUploaded: (url) => t("backup.cloudUploaded", { url }),
      cloudFailed: t("backup.cloudFailed"),
      serverOffline: t("common.serverOffline"),
    },
  });
}

async function _uploadBackupToCloud(backupPath, info) {
  const serverUp = await isServerUp();
  if (!serverUp) {
    console.warn(t("common.serverOffline"));
    return 1;
  }
  try {
    const boundary = `omniroute-backup-${Date.now().toString(36)}-${randomBytes(8).toString("hex")}`;
    const headers = new Headers({
      accept: "application/json",
      "content-type": `multipart/form-data; boundary=${boundary}`,
    });
    const apiKey = process.env.OMNIROUTE_API_KEY;
    if (apiKey) headers.set("authorization", `Bearer ${apiKey}`);
    const cliToken = process.env.OMNIROUTE_CLI_TOKEN ?? (await getCliToken());
    if (cliToken) headers.set(CLI_TOKEN_HEADER, cliToken);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    const res = await fetch(`${getBaseUrl()}/api/db-backups/cloud`, {
      method: "POST",
      headers,
      body: Readable.from(createBackupMultipartStream(backupPath, info, boundary)),
      duplex: "half",
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));
    if (res.ok) {
      const data = await res.json();
      console.log(t("backup.cloudUploaded", { url: data.url || "(stored)" }));
      return 0;
    }
    return 1;
  } catch {
    return 1;
  }
}

async function* createBackupMultipartStream(backupPath, info, boundary) {
  const encoder = new TextEncoder();
  const encode = (value) => encoder.encode(value);
  yield encode(
    `--${boundary}\r\nContent-Disposition: form-data; name="info"\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(info)}\r\n`
  );
  for (const fname of readdirSync(backupPath)) {
    const fullPath = join(backupPath, fname);
    const stat = statSync(fullPath);
    if (!stat.isFile()) continue;
    const safeName = fname.replace(/["\r\n]/g, "_");
    yield encode(
      `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${safeName}"\r\nContent-Type: application/octet-stream\r\n\r\n`
    );
    yield* createReadStream(fullPath);
    yield encode("\r\n");
  }
  yield encode(`--${boundary}--\r\n`);
}

function getSchedulePath() {
  return join(resolveDataDir(), "backup-schedule.json");
}

export async function runBackupAutoEnableCommand(opts = {}) {
  const schedulePath = getSchedulePath();
  const schedule = {
    enabled: true,
    cron: opts.cron || "0 3 * * *",
    cloud: !!opts.cloud,
    encrypt: !!opts.encrypt,
    retention: opts.retention || null,
    updatedAt: new Date().toISOString(),
  };
  mkdirSync(dirname(schedulePath), { recursive: true });
  writeFileSync(schedulePath, JSON.stringify(schedule, null, 2), "utf8");
  console.log(t("backup.auto.enabled", { cron: schedule.cron }));
  console.log(t("backup.auto.hint"));
  return 0;
}

export async function runBackupAutoDisableCommand() {
  const schedulePath = getSchedulePath();
  if (existsSync(schedulePath)) {
    const schedule = JSON.parse(readFileSync(schedulePath, "utf8"));
    schedule.enabled = false;
    schedule.updatedAt = new Date().toISOString();
    writeFileSync(schedulePath, JSON.stringify(schedule, null, 2), "utf8");
  }
  console.log(t("backup.auto.disabled"));
  return 0;
}

export async function runBackupAutoStatusCommand() {
  const schedulePath = getSchedulePath();
  if (!existsSync(schedulePath)) {
    console.log(t("backup.auto.notConfigured"));
    return 0;
  }
  const schedule = JSON.parse(readFileSync(schedulePath, "utf8"));
  const statusLabel = schedule.enabled ? "\x1b[32m● enabled\x1b[0m" : "\x1b[31m○ disabled\x1b[0m";
  console.log(`${t("backup.auto.title")}: ${statusLabel}`);
  console.log(`  cron:      ${schedule.cron}`);
  console.log(`  cloud:     ${schedule.cloud ? "yes" : "no"}`);
  console.log(`  encrypt:   ${schedule.encrypt ? "yes" : "no"}`);
  console.log(`  retention: ${schedule.retention ?? "unlimited"}`);
  return 0;
}

export async function runRestoreCommand(backupId, opts = {}) {
  const backupDir = getBackupDir();

  if (opts.list || !backupId) {
    console.log(`\n\x1b[1m\x1b[36m${t("backup.listTitle")}\x1b[0m\n`);
    if (!existsSync(backupDir)) {
      console.log(t("backup.noBackups"));
      return 0;
    }

    try {
      const dirs = readdirSync(backupDir)
        .filter((f) => f.startsWith("omniroute-backup-"))
        .sort()
        .reverse();

      if (dirs.length === 0) {
        console.log(t("backup.noBackups"));
        return 0;
      }

      for (const dir of dirs) {
        const infoPath = join(backupDir, dir, "backup-info.json");
        if (existsSync(infoPath)) {
          const info = JSON.parse(readFileSync(infoPath, "utf8"));
          const id = dir.replace("omniroute-backup-", "");
          const dateStr = new Date(info.timestamp).toLocaleString();
          console.log(`  ${id}`);
          console.log(`\x1b[2m    ${dateStr} — ${info.files?.length || 0} files\x1b[0m`);
        } else {
          console.log(`\x1b[2m  ${dir.replace("omniroute-backup-", "")}\x1b[0m`);
        }
      }
    } catch (err) {
      console.error(
        t("common.error", { message: err instanceof Error ? err.message : String(err) })
      );
      return 1;
    }

    if (!backupId) console.log("\nUsage: omniroute restore <backup-id>");
    return 0;
  }

  const safeBackupId = String(backupId).replace(/[/\\]/g, "_");
  const backupPath = join(backupDir, `omniroute-backup-${safeBackupId}`);
  if (!existsSync(backupPath)) {
    console.error(t("backup.notFound", { name: backupId }));
    return 1;
  }

  const infoPath = join(backupPath, "backup-info.json");
  const ts = existsSync(infoPath) ? JSON.parse(readFileSync(infoPath, "utf8")).timestamp : backupId;

  if (!opts.yes) {
    const readline = await import("node:readline");
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise((resolve) =>
      rl.question(t("backup.confirmRestore", { ts }) + " [y/N] ", resolve)
    );
    rl.close();
    if (!/^y(es)?$/i.test(answer)) {
      console.log(t("common.cancelled"));
      return 0;
    }
  }

  console.log(t("backup.restoring", { path: backupPath }));

  const dataDir = resolveDataDir();
  try {
    for (const file of FILES_TO_BACKUP) {
      const sourcePath = join(backupPath, file.name);
      if (existsSync(sourcePath)) {
        copyFileSync(sourcePath, join(dataDir, file.name));
        console.log(`\x1b[2m  Restored: ${file.name}\x1b[0m`);
      }
    }
    console.log(t("backup.restored"));
    return 0;
  } catch (err) {
    console.error(t("common.error", { message: err instanceof Error ? err.message : String(err) }));
    return 1;
  }
}
