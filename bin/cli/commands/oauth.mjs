import { setTimeout as sleep } from "node:timers/promises";
import { apiFetch } from "../api.mjs";
import { emit } from "../output.mjs";
import { t } from "../i18n.mjs";

const PROVIDERS_WITH_OAUTH = [
  { id: "gemini", name: "Google Gemini", flow: "browser" },
  { id: "antigravity", name: "Antigravity", flow: "browser" },
  { id: "windsurf", name: "Windsurf", flow: "browser" },
  { id: "cursor", name: "Cursor", flow: "import" },
  { id: "zed", name: "Zed", flow: "import" },
  { id: "kiro", name: "Amazon Kiro", flow: "social" },
  { id: "claude-code", name: "Claude Code (OAuth)", flow: "device" },
  { id: "codex", name: "OpenAI Codex (OAuth)", flow: "device" },
  { id: "copilot", name: "GitHub Copilot", flow: "device" },
];

const oauthProviderSchema = [
  { key: "id", header: "Provider ID", width: 16 },
  { key: "name", header: "Name", width: 28 },
  { key: "flow", header: "Flow", width: 10 },
];

const connectionSchema = [
  { key: "id", header: "Connection ID", width: 22 },
  { key: "provider", header: "Provider", width: 16 },
  { key: "name", header: "Name", width: 24 },
  { key: "isActive", header: "Active", formatter: (v) => (v ? "✓" : "✗") },
  { key: "testStatus", header: "Status", width: 12 },
];

async function openBrowser(url) {
  try {
    const { default: open } = await import("open");
    await open(url);
  } catch {
    // open package not available, ignore silently
  }
}

async function pollStatus(endpoint, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(2000);
    const res = await apiFetch(endpoint);
    if (!res.ok) continue;
    const data = await res.json();
    if (data.status === "complete" || data.status === "completed") return data;
    if (data.status === "error" || data.status === "failed") {
      process.stderr.write(
        `${t("common.cli.messages.oauthFailed", { error: data.error ?? data.message ?? t("common.cli.messages.unknownError") })}\n`
      );
      process.exit(1);
    }
  }
  process.stderr.write(`${t("common.cli.messages.oauthCallbackTimeout")}\n`);
  process.exit(124);
}

async function runBrowserFlow(def, opts) {
  const startRes = await apiFetch(`/api/oauth/${def.id}/start`, { method: "POST" });
  if (!startRes.ok) {
    process.stderr.write(
      `${t("common.cli.messages.oauthStartFailed", { provider: def.id, status: startRes.status })}\n`
    );
    process.exit(1);
  }
  const start = await startRes.json();
  const url = start.authorizeUrl ?? start.url;

  if (process.stdout.isTTY && opts.browser !== false) {
    const { startOAuthTui } = await import("../tui/OAuthFlow.jsx");
    await openBrowser(url);
    const tuiResult = await startOAuthTui({ provider: def.name ?? def.id, url });
    if (tuiResult.status === "cancelled") return;
  } else {
    process.stdout.write(t("common.cli.messages.openAuthorizeUrl", { url }));
    if (opts.browser !== false) await openBrowser(url);
    process.stderr.write(`${t("common.cli.messages.waitingAuthorization")}\n`);
  }

  const result = await pollStatus(
    `/api/oauth/${def.id}/status?state=${encodeURIComponent(start.state ?? "")}`,
    opts.timeout ?? 300000
  );
  process.stdout.write(
    `${t("common.cli.messages.authorized", {
      account: result.email ?? result.userId ?? result.account ?? "connected",
    })}\n`
  );
}

async function runImportFlow(def, opts) {
  const endpoint = opts.importFromSystem
    ? `/api/oauth/${def.id}/auto-import`
    : `/api/oauth/${def.id}/import`;
  const res = await apiFetch(endpoint, { method: "POST" });
  if (!res.ok) {
    process.stderr.write(`${t("common.cli.messages.importFailed", { status: res.status })}\n`);
    process.exit(1);
  }
  const data = await res.json();
  process.stdout.write(
    `${t("common.cli.messages.importedConnections", { count: data.count ?? 0, provider: def.name })}\n`
  );
}

async function runSocialFlow(def, opts) {
  let social = opts.social;
  if (!social) {
    process.stderr.write(`${t("common.cli.messages.socialRequired")}\n`);
    process.exit(2);
  }
  const startRes = await apiFetch(`/api/oauth/${def.id}/social-authorize`, {
    method: "POST",
    body: { social },
  });
  if (!startRes.ok) {
    process.stderr.write(
      `${t("common.cli.messages.socialStartFailed", { status: startRes.status })}\n`
    );
    process.exit(1);
  }
  const start = await startRes.json();
  const url = start.authorizeUrl ?? start.url;
  process.stdout.write(t("common.cli.messages.openSocialUrl", { url }));
  if (opts.browser !== false) await openBrowser(url);
  process.stderr.write(`${t("common.cli.messages.waitingSocial")}\n`);
  const result = await pollStatus(
    `/api/oauth/${def.id}/social-exchange?state=${encodeURIComponent(start.state ?? "")}`,
    opts.timeout ?? 300000
  );
  process.stdout.write(
    `${t("common.cli.messages.authorized", {
      account: result.email ?? result.userId ?? "connected",
    })}\n`
  );
}

async function runDeviceFlow(def, opts) {
  const providerKey = def.id === "claude-code" ? "command-code" : def.id;
  const startRes = await apiFetch(`/api/providers/${providerKey}/auth/start`, { method: "POST" });
  if (!startRes.ok) {
    process.stderr.write(
      `${t("common.cli.messages.oauthStartFailed", { provider: def.id, status: startRes.status })}\n`
    );
    process.exit(1);
  }
  const start = await startRes.json();
  process.stdout.write(
    t("common.cli.messages.deviceCode", {
      code: start.userCode ?? start.user_code ?? "",
      url: start.verificationUri ?? start.verification_uri,
    })
  );
  if (opts.browser !== false)
    await openBrowser(start.verificationUri ?? start.verification_uri ?? "");
  process.stderr.write(`${t("common.cli.messages.waitingDevice")}\n`);
  const deadline = Date.now() + (opts.timeout ?? 300000);
  const intervalMs = (start.intervalMs ?? start.interval ?? 5) * 1000;
  while (Date.now() < deadline) {
    await sleep(intervalMs);
    const statusRes = await apiFetch(
      `/api/providers/${providerKey}/auth/status?state=${encodeURIComponent(start.state ?? "")}`
    );
    if (!statusRes.ok) continue;
    const status = await statusRes.json();
    if (status.status === "complete" || status.status === "authorized") {
      await apiFetch(`/api/providers/${providerKey}/auth/apply`, {
        method: "POST",
        body: { state: start.state },
      });
      process.stdout.write(
        `${t("common.cli.messages.authorized", {
          account: status.account ?? status.email ?? "connected",
        })}\n`
      );
      return;
    }
    if (status.status === "error") {
      process.stderr.write(
        `${t("common.cli.messages.deviceAuthFailed", { error: status.error })}\n`
      );
      process.exit(1);
    }
  }
  process.stderr.write(`${t("common.cli.messages.oauthCallbackTimeout")}\n`);
  process.exit(124);
}

export async function runOAuthStart(opts, cmd) {
  const def = PROVIDERS_WITH_OAUTH.find((p) => p.id === opts.provider);
  if (!def) {
    process.stderr.write(
      `${t("common.cli.messages.unknownOAuthProvider", { provider: opts.provider })}\n`
    );
    process.exit(2);
  }
  switch (def.flow) {
    case "browser":
      return runBrowserFlow(def, opts);
    case "import":
      return runImportFlow(def, opts);
    case "social":
      return runSocialFlow(def, opts);
    case "device":
      return runDeviceFlow(def, opts);
  }
}

export async function runOAuthStatus(opts, cmd) {
  const globalOpts = cmd.optsWithGlobals();
  const params = new URLSearchParams();
  if (opts.provider) params.set("provider", opts.provider);
  const res = await apiFetch(`/api/providers?${params}`);
  if (!res.ok) {
    process.stderr.write(`${t("common.error", { message: res.status })}\n`);
    process.exit(1);
  }
  const data = await res.json();
  const connections = (data.providers ?? data.items ?? data).filter(
    (c) => c.authType === "oauth" || c.authType === "oauth2"
  );
  emit(connections, globalOpts, connectionSchema);
}

export async function runOAuthRevoke(opts, cmd) {
  if (!opts.yes) {
    process.stdout.write(
      `${t("common.cli.messages.revokeOAuthPrompt", { provider: opts.provider, id: opts.connectionId ? ` (${opts.connectionId})` : "" })}${t("common.cli.messages.confirmYesNoSuffix")}`
    );
    const answer = await new Promise((resolve) => {
      process.stdin.setEncoding("utf8");
      process.stdin.once("data", (c) => resolve(c.toString().trim().toLowerCase()));
    });
    if (!answer.startsWith("y")) process.exit(0);
  }
  const id = opts.connectionId;
  const res = id
    ? await apiFetch(`/api/providers/${id}`, { method: "DELETE" })
    : await apiFetch(`/api/oauth/${opts.provider}/revoke`, { method: "POST" });
  if (!res.ok) {
    process.stderr.write(`${t("common.error", { message: res.status })}\n`);
    process.exit(1);
  }
  process.stdout.write(`${t("common.cli.messages.revokedLine")}\n`);
}

export function registerOAuth(program) {
  const oauth = program.command("oauth").description(t("oauth.description"));

  oauth
    .command("providers")
    .description(t("oauth.providers.description"))
    .action(async (opts, cmd) => {
      emit(PROVIDERS_WITH_OAUTH, cmd.optsWithGlobals(), oauthProviderSchema);
    });

  oauth
    .command("start")
    .description(t("oauth.start.description"))
    .requiredOption("--provider <id>", t("oauth.start.provider"))
    .option("--no-browser", t("oauth.start.no_browser"))
    .option("--import-from-system", t("oauth.start.import_system"))
    .option("--social <s>", t("oauth.start.social"))
    .option("--timeout <ms>", t("oauth.start.timeout"), parseInt, 300000)
    .action(runOAuthStart);

  oauth
    .command("status")
    .description(t("oauth.status.description"))
    .option("--provider <id>", t("oauth.status.provider"))
    .action(runOAuthStatus);

  oauth
    .command("revoke")
    .description(t("oauth.revoke.description"))
    .requiredOption("--provider <id>", t("oauth.revoke.provider"))
    .option("--connection-id <id>", t("oauth.revoke.connection_id"))
    .option("--yes", t("oauth.revoke.yes"))
    .action(runOAuthRevoke);
}
