import { apiFetch } from "../api.mjs";
import { loadContexts, saveContexts } from "../contexts.mjs";
import { createPrompt, printSuccess, printError, printInfo } from "../io.mjs";
import { t } from "../i18n.mjs";

/**
 * `omniroute connect <host>` — remote mode.
 *
 * Logs into a remote OmniRoute server and saves the result as the active context
 * so every subsequent command targets that server. Two flows:
 *   - password: prompts for the management password → POST /api/cli/connect →
 *     server mints a scoped access token (default scope: admin).
 *   - token:    `--key <oma_...>` validates via GET /api/cli/whoami and saves it.
 */

/** Normalize a host/URL into a server root baseUrl (no trailing path). */
export function normalizeBaseUrl(host, port) {
  let value = String(host || "").trim();
  if (!value) return "";
  const hadScheme = /^https?:\/\//i.test(value);
  if (!hadScheme) value = `http://${value}`;
  try {
    const u = new URL(value);
    // Only apply the default port to a bare host; a full URL is taken as-is.
    if (!hadScheme && !u.port && port) u.port = String(port);
    return u.origin;
  } catch {
    return value;
  }
}

/** Derive a clean context name from a host (strip scheme/port). */
export function hostLabel(host) {
  let value = String(host || "")
    .trim()
    .replace(/^https?:\/\//i, "");
  value = value.split("/")[0].split(":")[0];
  return value || "remote";
}

async function readErrorMessage(res) {
  try {
    const body = await res.json();
    return (
      body?.error?.message || body?.error || t("common.cli.messages.http", { status: res.status })
    );
  } catch {
    return t("common.cli.messages.http", { status: res.status });
  }
}

export async function runConnectCommand(host, opts = {}) {
  const baseUrl = normalizeBaseUrl(host, opts.port || "20128");
  if (!baseUrl) {
    printError(t("common.cli.messages.hostRequired"));
    return 2;
  }
  const name = opts.name || hostLabel(host);

  let accessToken;
  let scope;

  if (opts.key) {
    // Validate the pasted token against the remote.
    const res = await apiFetch("/api/cli/whoami", {
      baseUrl,
      apiKey: opts.key,
      acceptNotOk: true,
    });
    if (!res.ok) {
      printError(
        t("common.cli.messages.tokenRejected", { baseUrl, error: await readErrorMessage(res) })
      );
      return res.exitCode || 1;
    }
    const body = await res.json();
    accessToken = opts.key;
    scope = body.scope || "unknown";
  } else {
    const prompt = createPrompt();
    let password;
    try {
      password = await prompt.askSecret(
        t("common.cli.messages.managementPasswordPrompt", { baseUrl })
      );
    } finally {
      prompt.close();
    }
    if (!password) {
      printError(t("common.cli.messages.managementPasswordRequired"));
      return 2;
    }
    const res = await apiFetch("/api/cli/connect", {
      baseUrl,
      method: "POST",
      body: { password, name, scope: opts.scope },
      acceptNotOk: true,
      retry: false,
    });
    if (!res.ok) {
      printError(
        t("common.cli.messages.connectFailed", {
          status: res.status,
          error: await readErrorMessage(res),
        })
      );
      return res.exitCode || 1;
    }
    const body = await res.json();
    accessToken = body.token;
    scope = body.scope;
  }

  const cfg = loadContexts();
  cfg.contexts = cfg.contexts || {};
  cfg.contexts[name] = {
    baseUrl,
    accessToken,
    scope,
    description: `Remote OmniRoute (${host})`,
  };
  cfg.currentContext = name;
  saveContexts(cfg);

  printSuccess(t("common.cli.messages.connectedContext", { baseUrl, name, scope }));
  printInfo(t("common.cli.messages.remoteModeActive"));
  printInfo(t("common.cli.messages.switchToLocal"));
  return 0;
}

export function registerConnect(program) {
  program
    .command("connect <host>")
    .description(t("common.cli.descriptions.connect"))
    .option("--port <port>", t("common.cli.options.serverPort"), "20128")
    .option("--key <token>", t("common.cli.options.scopedToken"))
    .option("--name <name>", t("common.cli.options.contextName"))
    .option("--scope <scope>", t("common.cli.options.requestedScope"))
    .action(async (host, opts) => {
      const code = await runConnectCommand(host, opts);
      if (code !== 0) process.exit(code);
    });
}
