import { t } from "../i18n.mjs";

export function registerProvider(program) {
  program
    .command("provider [subcommand]")
    .description(t("common.cli.descriptions.provider"))
    .allowUnknownOption()
    .allowExcessArguments()
    .action(() => {
      console.log(`\n  ${t("common.cli.messages.providerHelp")}\n`);
    });
}
