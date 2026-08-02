import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { t } from "../i18n.mjs";
import { emit } from "../output.mjs";
import { discoverPlugins } from "../plugins.mjs";

// Run npm with an explicit argument array and no shell. Passing args this way
// (instead of string-interpolating into `execSync`) prevents a malicious plugin
// name like `foo; rm -rf ~` or `` foo`id` `` from being interpreted by the shell.
function runNpm(args) {
  const res = spawnSync("npm", args, { stdio: "inherit", shell: false });
  if (res.error) throw res.error;
  if (typeof res.status === "number" && res.status !== 0) {
    throw new Error(`npm exited with code ${res.status}`);
  }
}

const TEMPLATE_INDEX = `export const meta = {
  name: "PLUGIN_NAME",
  version: "0.1.0",
  description: "OmniRoute plugin",
  omnirouteApi: ">=4.0.0",
};

export function register(program, ctx) {
  program
    .command("PLUGIN_NAME")
    .description(meta.description)
    .action(async (opts, cmd) => {
      const gOpts = cmd.optsWithGlobals();
      // ctx provides: ctx.apiFetch, ctx.emit, ctx.t, ctx.withSpinner, ctx.baseUrl, ctx.apiKey
      const res = await ctx.apiFetch("/api/health", { baseUrl: gOpts.baseUrl, apiKey: gOpts.apiKey });
      const data = await res.json();
      ctx.emit(data, gOpts);
    });
}
`;

export function registerPlugin(program) {
  const plugin = program.command("plugin").description(t("common.cli.descriptions.plugin"));

  plugin
    .command("list")
    .description(t("common.cli.descriptions.pluginList"))
    .action(async (opts, cmd) => {
      const plugins = await discoverPlugins();
      emit(
        plugins.map((p) => ({ name: p.name, version: p.version, description: p.description })),
        cmd.optsWithGlobals()
      );
      if (plugins.length === 0) {
        process.stdout.write(`${t("common.cli.messages.noPluginsInstalled")}\n`);
        process.stdout.write(t("common.cli.messages.pluginInstallHint"));
      }
    });

  plugin
    .command("install <name>")
    .description(t("common.cli.descriptions.pluginInstall"))
    .option("-y, --yes", t("common.yesOpt"))
    .action(async (name, opts) => {
      const isLocal = name.startsWith("./") || name.startsWith("/") || name.startsWith("../");
      const pkgName = isLocal ? name : `omniroute-cmd-${name}`;

      if (!opts.yes) {
        process.stderr.write(t("common.cli.messages.pluginTrustWarning", { package: pkgName }));
        // In non-interactive mode, require explicit --yes
        if (!process.stdin.isTTY) {
          process.stderr.write(`${t("common.cli.messages.pluginConfirmRequired")}\n`);
          process.exit(1);
        }
      }

      try {
        runNpm(["install", "-g", pkgName]);
        process.stdout.write(
          `\n${t("common.cli.messages.pluginInstalled", { package: pkgName })}\n`
        );
      } catch {
        process.stderr.write(
          `${t("common.cli.messages.pluginInstallFailed", { package: pkgName })}\n`
        );
        process.exit(1);
      }
    });

  plugin
    .command("remove <name>")
    .alias("uninstall")
    .description(t("common.cli.descriptions.pluginRemove"))
    .option("-y, --yes", t("common.yesOpt"))
    .action(async (name, opts) => {
      const pkgName = name.startsWith("omniroute-cmd-") ? name : `omniroute-cmd-${name}`;
      if (!opts.yes) {
        process.stderr.write(`${t("common.cli.messages.pluginRemoving", { package: pkgName })}\n`);
        if (!process.stdin.isTTY) {
          process.exit(1);
        }
      }
      try {
        runNpm(["uninstall", "-g", pkgName]);
        process.stdout.write(`${t("common.cli.messages.pluginRemoved", { package: pkgName })}\n`);
      } catch {
        process.stderr.write(
          `${t("common.cli.messages.pluginRemoveFailed", { package: pkgName })}\n`
        );
        process.exit(1);
      }
    });

  plugin
    .command("info <name>")
    .description(t("common.cli.descriptions.pluginInfo"))
    .action(async (name, opts, cmd) => {
      const plugins = await discoverPlugins();
      const p = plugins.find((x) => x.name === name || x.name === `omniroute-cmd-${name}`);
      if (!p) {
        process.stderr.write(`${t("common.cli.messages.pluginNotFound", { name })}\n`);
        process.exit(1);
      }
      emit(p.pkg, cmd.optsWithGlobals());
    });

  plugin
    .command("search [query]")
    .description(t("common.cli.descriptions.pluginSearch"))
    .action(async (query) => {
      const q = query ? `omniroute-cmd-${query}` : "omniroute-cmd";
      const url = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(q)}&size=50`;
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`npm registry returned ${res.status}`);
        const data = await res.json();
        const rows = (data.objects || []).map((o) => ({
          name: o.package.name,
          version: o.package.version,
          description: o.package.description,
        }));
        if (rows.length === 0) {
          process.stdout.write(
            `${t("common.cli.messages.pluginsNoSearchResults", { query: query || "omniroute-cmd" })}\n`
          );
        } else {
          rows.forEach((r) =>
            process.stdout.write(`  ${r.name}@${r.version}  ${r.description || ""}\n`)
          );
        }
      } catch (err) {
        process.stderr.write(
          `${t("common.cli.messages.pluginSearchFailed", { error: err.message })}\n`
        );
        process.exit(1);
      }
    });

  plugin
    .command("update [name]")
    .description(t("common.cli.descriptions.pluginUpdate"))
    .action(async (name) => {
      try {
        if (name) {
          const pkg = `omniroute-cmd-${name}`;
          runNpm(["update", "-g", pkg]);
          process.stdout.write(`${t("common.cli.messages.pluginUpdated", { packages: pkg })}\n`);
          return;
        }
        // No name → update every installed plugin. Enumerate them explicitly
        // instead of relying on a shell glob (`omniroute-cmd-*`), which never
        // expands without a shell and would otherwise update nothing.
        const plugins = await discoverPlugins();
        const names = plugins
          .map((p) => p.name)
          .filter((n) => typeof n === "string" && n.startsWith("omniroute-cmd-"));
        if (names.length === 0) {
          process.stdout.write(`${t("common.cli.messages.pluginsNoneToUpdate")}\n`);
          return;
        }
        runNpm(["update", "-g", ...names]);
        process.stdout.write(
          `${t("common.cli.messages.pluginUpdated", { packages: names.join(", ") })}\n`
        );
      } catch {
        process.stderr.write(`${t("common.cli.messages.pluginUpdateFailed")}\n`);
        process.exit(1);
      }
    });

  plugin
    .command("scaffold <name>")
    .description(t("common.cli.descriptions.pluginScaffold"))
    .action(async (name) => {
      const safeName = name.replace(/[^a-z0-9-]/g, "-");
      const dir = join(process.cwd(), `omniroute-cmd-${safeName}`);
      if (existsSync(dir)) {
        process.stderr.write(`${t("common.cli.messages.directoryExists", { path: dir })}\n`);
        process.exit(1);
      }
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify(
          {
            name: `omniroute-cmd-${safeName}`,
            version: "0.1.0",
            type: "module",
            main: "index.mjs",
            description: `OmniRoute CLI plugin: ${safeName}`,
            engines: { omniroute: ">=4.0.0" },
            keywords: ["omniroute-plugin", "omniroute-cmd"],
          },
          null,
          2
        ) + "\n"
      );
      writeFileSync(join(dir, "index.mjs"), TEMPLATE_INDEX.replace(/PLUGIN_NAME/g, safeName));
      writeFileSync(
        join(dir, "README.md"),
        `# omniroute-cmd-${safeName}\n\nAn OmniRoute CLI plugin.\n\n## Install\n\n\`\`\`bash\nomniroute plugin install ${safeName}\n\`\`\`\n`
      );
      process.stdout.write(`${t("common.cli.messages.pluginScaffolded", { path: dir })}\n`);
      process.stdout.write(`${t("common.cli.messages.pluginRun", { path: dir })}\n`);
    });
}
