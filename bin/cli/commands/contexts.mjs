import { t } from "../i18n.mjs";
import { emit } from "../output.mjs";
import { loadContexts, saveContexts, resolveActiveContext } from "../contexts.mjs";

/** Auth label for a context: prefers the scoped accessToken over the legacy apiKey. */
function authLabel(c) {
  if (c?.accessToken) return "token";
  if (c?.apiKey) return "key";
  return "✗";
}

export async function confirm(msg) {
  // Non-interactive stdin (pipe, CI, EOF) cannot answer a [y/N] prompt. Asking
  // anyway leaves the readline question pending forever — Node then warns about an
  // "unsettled top-level await" at exit. Decline cleanly instead and point at the
  // non-interactive escape hatch so scripted callers fail safe rather than hang.
  if (!process.stdin.isTTY) {
    process.stderr.write(
      `${msg}${t("common.cli.messages.confirmYesNoPromptSuffix")}(${t("common.cli.messages.nonInteractiveDeclined")})\n`
    );
    return false;
  }
  const readline = await import("node:readline");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((r) =>
    rl.question(`${msg}${t("common.cli.messages.confirmYesNoPromptSuffix")}`, r)
  );
  rl.close();
  return /^y(es)?$/i.test(answer);
}

function maskKey(k) {
  if (!k) return null;
  if (k.length <= 8) return "***";
  return `${k.slice(0, 6)}***${k.slice(-4)}`;
}

export function registerContexts(program) {
  const ctx = program
    .command("contexts")
    .alias("context") // singular alias — docs/connect output historically said `context current`
    .description(t("common.cli.descriptions.contexts"));

  ctx
    .command("list")
    .description(t("common.cli.descriptions.contextsList"))
    .action(async (opts, cmd) => {
      const globalOpts = cmd.optsWithGlobals();
      const cfg = loadContexts();
      const rows = Object.entries(cfg.contexts || {}).map(([name, c]) => ({
        active: name === (cfg.currentContext || "default") ? "●" : "",
        name,
        baseUrl: c.baseUrl || "",
        auth: authLabel(c),
        scope: c.scope || "",
        description: c.description || "",
      }));
      emit(rows, globalOpts, [
        { key: "active", header: "" },
        { key: "name", header: t("common.cli.messages.nameHeader") },
        { key: "baseUrl", header: t("common.cli.messages.baseUrlHeader") },
        { key: "auth", header: t("common.cli.messages.authHeader") },
        { key: "scope", header: t("common.cli.messages.scopeHeader") },
        { key: "description", header: t("common.cli.messages.descriptionHeader") },
      ]);
    });

  ctx
    .command("add <name>")
    .description(t("common.cli.descriptions.contextsAdd"))
    .requiredOption("--url <u>", t("common.cli.options.baseUrl"))
    .option("--api-key <k>", t("common.cli.options.legacyApiKey"))
    .option("--api-key-stdin", t("common.cli.options.readApiKeyStdin"))
    .option("--access-token <t>", t("common.cli.options.accessToken"))
    .option("--access-token-stdin", t("common.cli.options.readAccessTokenStdin"))
    .option("--scope <s>", t("common.cli.options.scopeHint"))
    .option("--description <d>", t("common.cli.options.contextDescription"))
    .action(async (name, opts) => {
      const cfg = loadContexts();
      if (cfg.contexts?.[name]) {
        process.stderr.write(`${t("common.cli.messages.contextExists", { name })}\n`);
        process.exit(2);
      }
      let apiKey = opts.apiKey || null;
      let accessToken = opts.accessToken || null;
      if (opts.apiKeyStdin || opts.accessTokenStdin) {
        const chunks = [];
        for await (const c of process.stdin) chunks.push(c);
        const value = chunks.join("").trim() || null;
        if (opts.accessTokenStdin) accessToken = value;
        else apiKey = value;
      }
      cfg.contexts = cfg.contexts || {};
      cfg.contexts[name] = {
        baseUrl: opts.url,
        accessToken: accessToken || undefined,
        apiKey,
        scope: opts.scope || undefined,
        description: opts.description || undefined,
      };
      saveContexts(cfg);
      process.stdout.write(`${t("common.cli.messages.contextAdded", { name })}\n`);
    });

  ctx
    .command("use <name>")
    .description(t("common.cli.descriptions.contextsSwitch"))
    .action((name) => {
      const cfg = loadContexts();
      if (!cfg.contexts?.[name]) {
        process.stderr.write(`${t("common.cli.messages.contextMissing", { name })}\n`);
        process.exit(2);
      }
      cfg.currentContext = name;
      saveContexts(cfg);
      process.stdout.write(`${t("common.cli.messages.activeContext", { name })}\n`);
    });

  ctx
    .command("current")
    .description(t("common.cli.descriptions.contextsActive"))
    .option("--name-only", t("common.cli.options.nameOnly"))
    .action((opts, cmd) => {
      const globalOpts = cmd.optsWithGlobals();
      const cfg = loadContexts();
      const name = cfg.currentContext || cfg.activeProfile || "default";
      if (opts.nameOnly) {
        process.stdout.write(`${name}\n`);
        return;
      }
      const c = resolveActiveContext(name);
      emit(
        {
          name,
          baseUrl: c.baseUrl || "",
          auth: authLabel(c),
          scope: c.scope || "",
          description: c.description || "",
        },
        globalOpts
      );
    });

  ctx
    .command("show <name>")
    .description(t("common.cli.descriptions.contextsShow"))
    .action((name, opts, cmd) => {
      const globalOpts = cmd.optsWithGlobals();
      const cfg = loadContexts();
      const c = cfg.contexts?.[name];
      if (!c) {
        process.stderr.write(`${t("common.cli.messages.contextMissing", { name })}\n`);
        process.exit(2);
      }
      const display = {
        name,
        baseUrl: c.baseUrl,
        accessToken: maskKey(c.accessToken),
        apiKey: maskKey(c.apiKey),
        scope: c.scope,
        description: c.description,
      };
      emit(display, globalOpts);
    });

  ctx
    .command("remove <name>")
    .description(t("common.cli.descriptions.contextsRemove"))
    .option("--yes", t("common.yesOpt"))
    .action(async (name, opts) => {
      if (!opts.yes) {
        const ok = await confirm(`Remove context '${name}'?`);
        if (!ok) {
          process.stdout.write(`${t("common.cancelled")}\n`);
          return;
        }
      }
      const cfg = loadContexts();
      if (!cfg.contexts?.[name]) {
        process.stderr.write(`${t("common.cli.messages.contextMissing", { name })}\n`);
        process.exit(2);
      }
      if (name === "default") {
        process.stderr.write(`${t("common.cli.messages.defaultContextCannotRemove")}\n`);
        process.exit(2);
      }
      delete cfg.contexts[name];
      if (cfg.currentContext === name) cfg.currentContext = "default";
      saveContexts(cfg);
      process.stdout.write(`${t("common.cli.messages.contextRemoved", { name })}\n`);
    });

  ctx
    .command("rename <old> <new>")
    .description(t("common.cli.descriptions.contextsRename"))
    .action((oldName, newName) => {
      const cfg = loadContexts();
      if (!cfg.contexts?.[oldName]) {
        process.stderr.write(`${t("common.cli.messages.contextMissing", { name: oldName })}\n`);
        process.exit(2);
      }
      if (cfg.contexts[newName]) {
        process.stderr.write(`${t("common.cli.messages.contextNameExists", { name: newName })}\n`);
        process.exit(2);
      }
      cfg.contexts[newName] = cfg.contexts[oldName];
      delete cfg.contexts[oldName];
      if (cfg.currentContext === oldName) cfg.currentContext = newName;
      saveContexts(cfg);
      process.stdout.write(`${t("common.cli.messages.contextRenamed", { oldName, newName })}\n`);
    });

  ctx
    .command("export")
    .description(t("common.cli.descriptions.contextsExport"))
    .option("--out <path>", t("common.cli.options.outputPath"))
    .option("--no-secrets", t("common.cli.options.noSecrets"))
    .action(async (opts, cmd) => {
      const cfg = loadContexts();
      const out = JSON.parse(JSON.stringify(cfg));
      if (opts.noSecrets) {
        for (const c of Object.values(out.contexts || {})) {
          c.apiKey = null;
          delete c.accessToken;
        }
      }
      const json = JSON.stringify(out, null, 2);
      if (opts.out) {
        const { writeFileSync } = await import("node:fs");
        writeFileSync(opts.out, json);
        process.stdout.write(`${t("common.cli.messages.exportedTo", { path: opts.out })}\n`);
      } else {
        process.stdout.write(json + "\n");
      }
    });

  ctx
    .command("import <file>")
    .description(t("common.cli.descriptions.contextsImport"))
    .option("--merge", t("common.cli.options.mergeContexts"))
    .action(async (file, opts) => {
      const { readFileSync } = await import("node:fs");
      let imported;
      try {
        imported = JSON.parse(readFileSync(file, "utf8"));
      } catch (e) {
        process.stderr.write(
          `${t("common.cli.messages.cannotReadFile", { path: file, error: e instanceof Error ? e.message : String(e) })}\n`
        );
        process.exit(1);
      }
      const cfg = opts.merge
        ? loadContexts()
        : { version: 1, currentContext: "default", contexts: {} };
      const incoming = imported.contexts || {};
      let count = 0;
      for (const [name, raw] of Object.entries(incoming)) {
        if (typeof name !== "string" || !name) continue;
        const c = raw && typeof raw === "object" ? /** @type {Record<string,unknown>} */ (raw) : {};
        cfg.contexts[name] = {
          baseUrl: typeof c.baseUrl === "string" ? c.baseUrl : "http://localhost:20128",
          accessToken: typeof c.accessToken === "string" ? c.accessToken : undefined,
          apiKey: typeof c.apiKey === "string" ? c.apiKey : null,
          scope: typeof c.scope === "string" ? c.scope : undefined,
          description: typeof c.description === "string" ? c.description : undefined,
        };
        count++;
      }
      if (!opts.merge && typeof imported.currentContext === "string") {
        cfg.currentContext = imported.currentContext;
      }
      saveContexts(cfg);
      process.stdout.write(`${t("common.cli.messages.contextsImported", { count })}\n`);
    });
}
