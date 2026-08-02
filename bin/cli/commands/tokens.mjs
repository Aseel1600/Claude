import { apiFetch } from "../api.mjs";
import { emit } from "../output.mjs";
import { printSuccess, printError, printInfo } from "../io.mjs";
import { t } from "../i18n.mjs";

/**
 * `omniroute tokens` — manage scoped CLI access tokens on the active (usually
 * remote) server. Requires an `admin` credential — the commands hit
 * /api/cli/tokens which is admin-only. Uses the active context's auth via
 * apiFetch automatically.
 */

async function readErrorMessage(res) {
  try {
    const body = await res.json();
    return body?.error?.message || body?.error || `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

export function registerTokens(program) {
  const tokens = program.command("tokens").description(t("common.cli.descriptions.tokens"));

  tokens
    .command("create")
    .description(t("common.cli.descriptions.tokensCreate"))
    .requiredOption("--name <name>", t("common.cli.options.tokenName"))
    .option("--scope <scope>", t("common.cli.options.tokenScope"), "read")
    .option("--expires <days>", t("common.cli.options.tokenExpires"))
    .action(async (opts, cmd) => {
      const globalOpts = cmd.optsWithGlobals();
      const body = { name: opts.name, scope: opts.scope };
      if (opts.expires) {
        const days = Number(opts.expires);
        if (!Number.isFinite(days) || days <= 0) {
          printError(t("common.cli.messages.tokenExpiresPositive"));
          process.exit(2);
        }
        body.expiresInDays = days;
      }
      const res = await apiFetch("/api/cli/tokens", {
        ...globalOpts,
        method: "POST",
        body,
        acceptNotOk: true,
      });
      if (!res.ok) {
        printError(
          t("common.cli.messages.couldNotCreateToken", {
            error: await readErrorMessage(res),
          })
        );
        process.exit(res.exitCode || 1);
      }
      const b = await res.json();
      printSuccess(t("common.cli.messages.tokenCreated", { name: b.name, scope: b.scope }));
      printInfo(t("common.cli.messages.copyToken"));
      process.stdout.write(`${b.token}\n`);
    });

  tokens
    .command("list")
    .description(t("common.cli.descriptions.tokensList"))
    .action(async (opts, cmd) => {
      const globalOpts = cmd.optsWithGlobals();
      const res = await apiFetch("/api/cli/tokens", { ...globalOpts, acceptNotOk: true });
      if (!res.ok) {
        printError(
          t("common.cli.messages.couldNotListTokens", {
            error: await readErrorMessage(res),
          })
        );
        process.exit(res.exitCode || 1);
      }
      const b = await res.json();
      const rows = (b.tokens || []).map((tk) => ({
        id: tk.id,
        name: tk.name,
        scope: tk.scope,
        prefix: tk.tokenPrefix,
        created: tk.createdAt,
        lastUsed: tk.lastUsedAt || "",
        expires: tk.expiresAt || "",
        status: tk.revokedAt
          ? t("common.cli.messages.tokenRevokedStatus")
          : t("common.cli.messages.tokenActiveStatus"),
      }));
      emit(rows, globalOpts, [
        { key: "id", header: t("common.cli.messages.tokenHeaderId") },
        { key: "name", header: t("common.cli.messages.tokenHeaderName") },
        { key: "scope", header: t("common.cli.messages.tokenHeaderScope") },
        { key: "prefix", header: t("common.cli.messages.tokenHeaderPrefix") },
        { key: "status", header: t("common.cli.messages.tokenHeaderStatus") },
        { key: "lastUsed", header: t("common.cli.messages.tokenHeaderLastUsed") },
        { key: "expires", header: t("common.cli.messages.tokenHeaderExpires") },
      ]);
    });

  tokens
    .command("revoke <idOrPrefix>")
    .description(t("common.cli.descriptions.tokensRevoke"))
    .action(async (idOrPrefix, opts, cmd) => {
      const globalOpts = cmd.optsWithGlobals();
      const res = await apiFetch(`/api/cli/tokens/${encodeURIComponent(idOrPrefix)}`, {
        ...globalOpts,
        method: "DELETE",
        acceptNotOk: true,
      });
      if (!res.ok) {
        printError(
          t("common.cli.messages.couldNotRevokeToken", {
            error: await readErrorMessage(res),
          })
        );
        process.exit(res.exitCode || 1);
      }
      printSuccess(t("common.cli.messages.tokenRevoked", { id: idOrPrefix }));
    });

  tokens
    .command("scopes")
    .description(t("common.cli.descriptions.tokensExplain"))
    .action(() => {
      printInfo(t("common.cli.messages.tokenScopes"));
      process.stdout.write(`${t("common.cli.messages.readScope")}\n`);
      process.stdout.write(`${t("common.cli.messages.writeScope")}\n`);
      process.stdout.write(`${t("common.cli.messages.adminScope")}\n`);
    });
}
