import { rmSync } from "node:fs";
import { t } from "../i18n.mjs";
import { emit } from "../output.mjs";
import { withSpinner } from "../spinner.mjs";
import {
  getRuntimeNodeModules,
  hasModule,
  isBetterSqliteBinaryValid,
  ensureBetterSqliteRuntime,
} from "../runtime/nativeDeps.mjs";

async function confirm(msg) {
  const readline = await import("node:readline");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((r) =>
    rl.question(`${msg}${t("common.cli.messages.confirmYesNoPromptSuffix")}`, r)
  );
  rl.close();
  return /^y(es)?$/i.test(answer);
}

/**
 * Shared repair action used by both `omniroute runtime repair` and the
 * top-level `omniroute repair` alias. Reinstalls better-sqlite3 into the
 * user-writable runtime directory via the existing engine — no hand-rolled
 * npm-rebuild spawn. Exits with code 1 on failure.
 */
async function runRepairAction(opts, cmd) {
  const globalOpts = cmd.optsWithGlobals();
  await withSpinner(
    t("common.cli.messages.repairingNativeDeps"),
    async () => ensureBetterSqliteRuntime({ silent: true, force: opts.force }),
    globalOpts
  );
  const ok = hasModule("better-sqlite3") && isBetterSqliteBinaryValid();
  if (ok) {
    process.stdout.write(`${t("common.cli.messages.repairOk")}\n`);
  } else {
    process.stderr.write(`${t("common.cli.messages.repairFailed")}\n`);
    process.exit(1);
  }
}

export function registerRuntime(program) {
  const runtime = program.command("runtime").description(t("common.cli.descriptions.runtime"));

  runtime
    .command("check")
    .description(t("common.cli.descriptions.runtimeCheck"))
    .action(async (opts, cmd) => {
      const globalOpts = cmd.optsWithGlobals();
      const status = {
        runtimeDir: getRuntimeNodeModules(),
        betterSqlite3: {
          installed: hasModule("better-sqlite3"),
          valid: isBetterSqliteBinaryValid(),
        },
      };
      emit(status, globalOpts);
    });

  runtime
    .command("repair")
    .description(t("common.cli.descriptions.runtimeRepair"))
    .option("--force", t("common.cli.options.forceActive"))
    .action(runRepairAction);

  // Top-level discoverability alias: `omniroute repair` invokes the SAME action
  // as `omniroute runtime repair` (no duplicated logic). Surfaced in the
  // native-error / startup hints so users with a broken better-sqlite3 binding
  // have a single self-heal command that works without a C++ toolchain.
  program
    .command("repair")
    .description(t("common.cli.descriptions.runtimeRepairAlias"))
    .option("--force", t("common.cli.options.forceActive"))
    .action(runRepairAction);

  runtime
    .command("clean")
    .description(t("common.cli.descriptions.runtimeClean"))
    .option("--yes", t("common.yesOpt"))
    .action(async (opts) => {
      if (!opts.yes) {
        const ok = await confirm(
          t("common.cli.messages.removeRuntimePrompt", { path: getRuntimeNodeModules() })
        );
        if (!ok) {
          process.stdout.write(`${t("common.cancelled")}\n`);
          return;
        }
      }
      try {
        rmSync(getRuntimeNodeModules(), { recursive: true, force: true });
        process.stdout.write(`${t("common.cli.messages.runtimeCleaned")}\n`);
      } catch (e) {
        process.stderr.write(
          `${t("common.cli.messages.runtimeFailed", { error: e instanceof Error ? e.message : String(e) })}\n`
        );
        process.exit(1);
      }
    });
}
