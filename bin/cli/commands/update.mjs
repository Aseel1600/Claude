import { printHeading, printInfo, printSuccess, printError } from "../io.mjs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { t } from "../i18n.mjs";

const execFileAsync = promisify(execFile);

// This file lives at <pkgRoot>/bin/cli/commands/update.mjs — resolve package
// paths relative to the script, NOT process.cwd(). On a global npm/brew install
// the user's cwd is not the package root, so cwd-relative lookups break (#3295).
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(SCRIPT_DIR, "..", "..", "..");
const BIN_DIR = path.join(PKG_ROOT, "bin");

export async function getCurrentVersion() {
  try {
    const { readFileSync } = await import("node:fs");
    const pkg = JSON.parse(readFileSync(path.join(PKG_ROOT, "package.json"), "utf-8"));
    return pkg.version;
  } catch {
    return null;
  }
}

// `--prefer-online` forces npm to revalidate its HTTP cache against the registry.
// Without it `npm view` can return a stale cached version (e.g. report 3.8.30 as
// "latest" after 3.8.31 was published), so the updater told users on an old build
// they were already on the latest version (#4376). `execFn` is injectable for tests.
export async function getLatestVersion(execFn = execFileAsync) {
  try {
    const { stdout } = await execFn("npm", ["view", "omniroute", "version", "--prefer-online"], {
      timeout: 15000,
    });
    return stdout.trim();
  } catch {
    return null;
  }
}

function compareVersions(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
  }
  return 0;
}

export async function createBackup() {
  const binPath = BIN_DIR;
  const backupDir = path.join(homedir(), ".omniroute", "backups", `omniroute-${Date.now()}`);

  try {
    const { mkdirSync, cpSync, existsSync } = await import("node:fs");
    if (!existsSync(binPath)) return null;

    mkdirSync(backupDir, { recursive: true });
    const files = ["omniroute.mjs", "cli", "nodeRuntimeSupport.mjs", "mcp-server.mjs"];
    for (const f of files) {
      const src = path.join(binPath, f);
      if (existsSync(src)) {
        // cpSync handles both files and directories; the old copyFileSync threw
        // EISDIR on the "cli" directory, which was swallowed by the catch (#3295).
        cpSync(src, path.join(backupDir, f), { recursive: true });
      }
    }
    return backupDir;
  } catch {
    return null;
  }
}

export function registerUpdate(program) {
  program
    .command("update")
    .description(t("update.checking"))
    .option("--check", t("common.cli.options.updateCheck"))
    .option("--apply", t("common.cli.options.updateApply"))
    .option("--changelog", t("common.cli.options.updateChangelog"))
    .option("--dry-run", t("common.cli.options.updateDryRun"))
    .option("--no-backup", t("common.cli.options.updateNoBackup"))
    .option("--yes", t("common.yesOpt"))
    .action(async (opts, cmd) => {
      const globalOpts = cmd.optsWithGlobals();
      const exitCode = await runUpdateCommand({ ...opts, output: globalOpts.output });
      if (exitCode !== 0) process.exit(exitCode);
    });
}

export async function runUpdateCommand(opts = {}) {
  const checkOnly = opts.check ?? false;
  const applyNow = opts.apply ?? false;
  const showChangelog = opts.changelog ?? false;
  const dryRun = opts.dryRun ?? false;
  const skipBackup = !(opts.backup ?? true);
  const skipConfirm = opts.yes ?? applyNow;

  const current = await getCurrentVersion();
  const latest = await getLatestVersion();

  if (!current) {
    printError(t("common.cli.messages.currentVersionUnavailable"));
    return 1;
  }

  if (!latest) {
    printError(t("common.cli.messages.latestVersionUnavailable"));
    return 1;
  }

  if (showChangelog) {
    try {
      const { stdout } = await execFileAsync("npm", ["view", "omniroute", "changelog"], {
        timeout: 10000,
      });
      if (stdout.trim()) {
        console.log(stdout.trim());
      } else {
        console.log(t("common.cli.messages.changelogLink", { version: latest }));
      }
    } catch {
      console.log(t("common.cli.messages.changelogLink", { version: latest }));
    }
    return 0;
  }

  printHeading(t("common.cli.messages.updateTitle"));
  console.log(t("common.cli.messages.currentVersion", { version: current }));
  console.log(t("common.cli.messages.latestVersion", { version: latest }));

  const cmp = compareVersions(current, latest);
  if (cmp >= 0) {
    printSuccess(t("common.cli.messages.alreadyLatest"));
    return 0;
  }

  console.log(t("common.cli.messages.updateAvailableLine", { current, latest }));

  if (checkOnly) {
    console.log(t("common.cli.messages.updateApplyHint"));
    return 1; // exit 1 = outdated (useful for scripts)
  }

  if (dryRun) {
    console.log(t("common.cli.messages.updateDryRunCommand"));
    if (!skipBackup) console.log(t("common.cli.messages.updateDryRunBackup"));
    return 0;
  }

  if (!skipBackup) {
    printInfo(t("common.cli.messages.creatingBackup"));
    const backupPath = await createBackup();
    if (backupPath) {
      printSuccess(t("common.cli.messages.backupCreated", { path: backupPath }));
    } else {
      printError(t("common.cli.messages.backupCreationFailed"));
      return 1;
    }
  }

  if (!skipConfirm) {
    const readline = await import("node:readline");
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise((resolve) =>
      rl.question(t("common.cli.messages.updateConfirmPrompt", { version: latest }), resolve)
    );
    rl.close();
    if (!/^y(es)?$/i.test(answer)) {
      printInfo(t("common.cli.messages.updateAborted"));
      return 0;
    }
  }

  printInfo(t("common.cli.messages.updatingOmniRoute"));
  try {
    const { execSync } = await import("child_process");
    // --include=optional keeps the optionalDependencies (better-sqlite3, keytar,
    // tls-client, llmlingua SLM stack) on update so an omit=optional config can't drop them.
    execSync("npm install -g omniroute@latest --include=optional", { stdio: "inherit" });
    printSuccess(t("common.cli.messages.updatedToVersion", { version: latest }));
    printInfo(t("common.cli.messages.verifyVersion"));
    return 0;
  } catch (err) {
    printError(t("common.cli.messages.updateFailed", { error: err.message }));
    printInfo(t("common.cli.messages.restoreFromBackup"));
    const backupDir = path.join(homedir(), ".omniroute", "backups");
    printInfo(`  ls ${backupDir}`);
    return 1;
  }
}
