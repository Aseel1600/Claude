import { printHeading, printInfo, printSuccess, printError } from "../io.mjs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { t } from "../i18n.mjs";

const execFileAsync = promisify(execFile);

// This file lives at <pkgRoot>/bin/cli/commands/update.mjs — resolve package
// paths relative to the script, NOT process.cwd(). On a global npm/brew install
// the user's cwd is not the package root, so cwd-relative lookups break (#3295).
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(SCRIPT_DIR, "..", "..", "..");
const BIN_DIR = path.join(PKG_ROOT, "bin");

/**
 * True when the running install is a git source checkout (the custom fork) rather
 * than a stock npm global package. In that case `npm install -g omniroute` would
 * clobber the link/fork, so update must go through git + pnpm instead.
 */
export function isSourceInstall(root = PKG_ROOT) {
  return existsSync(path.join(root, ".git"));
}

/** Parse AUTO_UPDATE_PATCH_COMMITS (space/comma-separated SHAs) — the custom fix patch. */
export function getPatchCommits(env = process.env) {
  return (env.AUTO_UPDATE_PATCH_COMMITS || "")
    .split(/[\s,]+/)
    .map((v) => v.trim())
    .filter(Boolean);
}

/** Shell-quote a value for embedding in a POSIX script. */
function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

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
    .option("--check", "Check for available update — exit 0 if up-to-date, exit 1 if outdated")
    .option("--apply", "Install latest version automatically (npm install -g)")
    .option("--changelog", "Show changelog for the latest release")
    .option("--dry-run", "Show what would be updated without applying")
    .option("--no-backup", "Skip backup creation")
    .option("--yes", "Skip confirmation prompt")
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
    printError("Could not determine current version");
    return 1;
  }

  if (!latest) {
    printError("Could not check latest version. Is npm available?");
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
        console.log(`Changelog: https://github.com/your-org/omniroute/releases/tag/v${latest}`);
      }
    } catch {
      console.log(`Changelog: https://github.com/your-org/omniroute/releases/tag/v${latest}`);
    }
    return 0;
  }

  printHeading("OmniRoute Update");
  console.log(`  Current version: ${current}`);
  console.log(`  Latest version:  ${latest}`);

  const cmp = compareVersions(current, latest);
  if (cmp >= 0) {
    printSuccess("You are running the latest version!");
    return 0;
  }

  console.log(`\n  Update available: ${current} → ${latest}`);

  if (checkOnly) {
    console.log("\n  Run `omniroute update --apply` to install automatically.");
    return 1; // exit 1 = outdated (useful for scripts)
  }

  if (dryRun) {
    if (isSourceInstall()) {
      console.log(
        "\n  [DRY RUN] Source install — would run: git fetch --tags && git checkout <tag> && pnpm install && pnpm build"
      );
      console.log(
        "  [DRY RUN] Would then re-apply custom patch commits (AUTO_UPDATE_PATCH_COMMITS) via Hermes"
      );
      console.log("  [DRY RUN] Would restart via: pm2 restart omniroute --update-env");
    } else {
      console.log("\n  [DRY RUN] Would run: npm install -g omniroute@latest --include=optional");
    }
    if (!skipBackup) console.log("  [DRY RUN] Would create backup in ~/.omniroute/backups/");
    return 0;
  }

  if (!skipBackup) {
    printInfo("Creating backup...");
    const backupPath = await createBackup();
    if (backupPath) {
      printSuccess(`Backup created: ${backupPath}`);
    } else {
      printError("Failed to create backup. Aborting update.");
      return 1;
    }
  }

  if (!skipConfirm) {
    const readline = await import("node:readline");
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise((resolve) =>
      rl.question(`Proceed with update to ${latest}? [y/N] `, resolve)
    );
    rl.close();
    if (!/^y(es)?$/i.test(answer)) {
      printInfo("Update aborted.");
      return 0;
    }
  }

  printInfo("Updating OmniRoute...");
  try {
    const { execSync } = await import("child_process");
    if (isSourceInstall()) {
      // Custom fork / linked install: NEVER `npm install -g omniroute` — that
      // clobbers the link with the stock npm package. Pull the latest release
      // tag from git, then hand off the custom fix patch to Hermes (manual
      // step, see DOCUMENTATION.md), then build with pnpm and restart via PM2.
      const gitRemote = process.env.AUTO_UPDATE_GIT_REMOTE || "origin";
      const targetTag = latest.startsWith("v") ? latest : `v${latest}`;
      const script = [
        "set -eu",
        "git stash --include-untracked 2>/dev/null || true",
        `git fetch --tags ${shellQuote(gitRemote)}`,
        `if ! git rev-parse -q --verify "refs/tags/${targetTag}" >/dev/null 2>&1; then`,
        `  echo "[AutoUpdate] Tag ${targetTag} not found." >&2`,
        "  exit 1",
        "fi",
        'backup_branch="pre-update/$(git rev-parse --short HEAD)-$(date +%Y%m%d-%H%M%S)"',
        'git branch "$backup_branch" 2>/dev/null || true',
        `git checkout -B "autoupdate/${targetTag.replace(/^v/, "")}" "${targetTag}"`,
        "pnpm install --prefer-offline",
        "pnpm run build",
        "if command -v pm2 >/dev/null 2>&1; then",
        "  pm2 restart omniroute --update-env || true",
        "fi",
      ].join("\n");
      execSync(script, { stdio: "inherit", cwd: PKG_ROOT });
      printSuccess(`Updated to version ${latest} (source install, git + pnpm)`);
      const patchCommits = getPatchCommits();
      if (patchCommits.length > 0) {
        printInfo(
          `Custom patch commits (${patchCommits.join(", ")}) must be re-applied by Hermes — see DOCUMENTATION.md.`
        );
      } else {
        printInfo(
          "No custom patch commits configured (AUTO_UPDATE_PATCH_COMMITS empty) — pure upstream + pnpm."
        );
      }
      return 0;
    }

    // Genuine npm global install: keep the upstream behavior.
    // --include=optional keeps the optionalDependencies (better-sqlite3, keytar,
    // tls-client, llmlingua SLM stack) on update so an omit=optional config can't drop them.
    execSync("npm install -g omniroute@latest --include=optional", { stdio: "inherit" });
    // Trust-but-verify: `npm install -g` exits 0 even when a shadowing local install
    // (e.g. ~/node_modules/omniroute ahead of the global prefix on PATH) means the
    // binary the user actually runs was not touched. Re-read the running binary's
    // version and warn instead of lying about success (#9475).
    const afterVersion = await getCurrentVersion();
    if (afterVersion && compareVersions(afterVersion, latest) < 0) {
      printError(
        `Global install updated to ${latest}, but the running binary still reports ${afterVersion}.`
      );
      console.log(
        "  A local `node_modules/omniroute` is likely shadowing the global install on PATH."
      );
      console.log("  Diagnose with:");
      console.log("    which -a omniroute");
      console.log("    command -v omniroute");
      console.log("    npm prefix -g");
      console.log(
        "  Then remove the shadowing local copy (e.g. `npm uninstall omniroute` from its directory)"
      );
      console.log("  or reorder PATH so the global bin comes first.");
      return 1;
    }
    printSuccess(`Updated to version ${latest}`);
    printInfo("Run `omniroute --version` to verify.");
    return 0;
  } catch (err) {
    printError(`Update failed: ${err.message}`);
    printInfo("Restore from backup:");
    const backupDir = path.join(homedir(), ".omniroute", "backups");
    printInfo(`  ls ${backupDir}`);
    return 1;
  }
}
