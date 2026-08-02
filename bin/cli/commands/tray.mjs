import { t } from "../i18n.mjs";

export function registerTray(program) {
  const cmd = program.command("tray").description(t("common.cli.descriptions.tray"));

  cmd
    .command("show")
    .description(t("common.cli.descriptions.trayShow"))
    .action(() => {
      process.stderr.write(`${t("common.cli.messages.trayShowHint")}\n`);
    });

  cmd
    .command("hide")
    .description(t("common.cli.descriptions.trayHide"))
    .action(() => {
      process.stderr.write(`${t("common.cli.messages.trayHideHint")}\n`);
    });

  cmd
    .command("quit")
    .description(t("common.cli.descriptions.trayQuit"))
    .action(async () => {
      const { default: pidUtils } = await import("../utils/pid.mjs").catch(() => ({
        default: null,
      }));
      process.stderr.write(`${t("common.cli.messages.useStopCommand")}\n`);
      process.exit(0);
    });
}
