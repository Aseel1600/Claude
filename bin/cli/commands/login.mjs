import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { t } from "../i18n.mjs";

/**
 * `omniroute login antigravity` — local OAuth helper for remote installs.
 *
 * Why this exists: Google's `firstparty/nativeapp` consent for the embedded
 * Antigravity desktop client only releases the authorization code when the
 * loopback redirect (127.0.0.1:<port>) is REACHABLE. On a remote VPS install the
 * loopback is unreachable, so the consent hangs forever and never emits a code —
 * the dashboard's "paste the callback URL" fallback has nothing to paste. (The
 * same flow works locally and over an SSH tunnel, where the loopback IS reachable.)
 *
 * This command runs the OAuth on the user's OWN machine — where 127.0.0.1 works —
 * captures the code on a local loopback server, exchanges it for tokens, and
 * prints a single-line credential blob. The user pastes that blob into the remote
 * dashboard (Antigravity → "Paste credentials"), which decodes it, finalizes the
 * onboarding server-side, and persists the connection.
 *
 * It talks ONLY to Google (no OmniRoute server needed locally), so it works even
 * if the remote VPS is firewalled from the user's machine.
 */

const PROVIDER = "antigravity";

/** Open the system browser; no-op if the optional `open` dependency is missing. */
async function defaultOpenBrowser(url) {
  try {
    const { default: open } = await import("open");
    await open(url);
  } catch {
    // `open` not available — the caller already printed the URL to paste manually.
  }
}

/**
 * Start a loopback HTTP server bound to 127.0.0.1 (NOT 0.0.0.0 — we never want to
 * expose the callback to the LAN). Resolves to { port, waitForCallback, close }.
 */
function defaultStartServer(preferredPort) {
  return new Promise((resolve, reject) => {
    let resolveCallback;
    const callbackPromise = new Promise((r) => {
      resolveCallback = r;
    });

    const server = createServer((req, res) => {
      const url = new URL(req.url, "http://127.0.0.1");
      if (url.pathname !== "/callback" && url.pathname !== "/auth/callback") {
        res.writeHead(404).end();
        return;
      }
      const params = Object.fromEntries(url.searchParams.entries());
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(
        "<!doctype html><meta charset=utf-8><title>OmniRoute</title>" +
          '<body style="font-family:system-ui;padding:2rem">' +
          `<h2>✅ ${t("common.cli.messages.authReceived")}</h2>` +
          `<p>${t("common.cli.messages.returnTerminal")}</p></body>`
      );
      resolveCallback(params);
    });

    server.on("error", reject);
    server.listen(preferredPort || 0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        port,
        waitForCallback: () => callbackPromise,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

/** Lazy-load the antigravity provider + blob codec (TS source via tsx). */
async function loadDeps() {
  const { antigravity } = await import("../../../src/lib/oauth/providers/antigravity.ts");
  const { encodeCredentialBlob } = await import("../../../src/lib/oauth/credentialBlob.ts");
  return { antigravity, encodeCredentialBlob };
}

/**
 * Build the Google authorization request for a given loopback port. Uses a plain
 * authorization_code grant (NO PKCE code_challenge) — matching the working flow:
 * a code_challenge here would force the exchange to require a code_verifier.
 */
export async function buildAntigravityAuthRequest(port, makeState = randomUUID) {
  const { antigravity } = await loadDeps();
  const redirectUri = `http://127.0.0.1:${port}/callback`;
  const state = makeState();
  const authUrl = antigravity.buildAuthUrl(antigravity.config, redirectUri, state);
  return { redirectUri, state, authUrl };
}

/** Exchange the captured code for raw Google tokens (no code_verifier — no PKCE). */
export async function exchangeAntigravityCode(code, redirectUri) {
  const { antigravity } = await loadDeps();
  return antigravity.exchangeToken(antigravity.config, code, redirectUri);
}

/**
 * Orchestrate the local login. Dependencies are injectable for testing; the real
 * path uses a 127.0.0.1 loopback server, the system browser, and a live token
 * exchange against Google. Returns the credential blob string.
 */
export async function runAntigravityLogin(opts = {}, deps = {}) {
  const startServer = deps.startServer ?? defaultStartServer;
  const openBrowser = deps.openBrowser ?? defaultOpenBrowser;
  const exchange = deps.exchange ?? exchangeAntigravityCode;
  const makeState = deps.makeState ?? randomUUID;
  const print = deps.print ?? ((s) => process.stdout.write(s));
  const log = deps.log ?? ((s) => process.stderr.write(s));
  const { encodeCredentialBlob } = await loadDeps();

  const server = await startServer(opts.port);
  const { redirectUri, state, authUrl } = await buildAntigravityAuthRequest(server.port, makeState);

  log(`\n${t("common.cli.messages.loginUrl")}\n\n  ${authUrl}\n\n`);
  if (opts.browser !== false) await openBrowser(authUrl);
  log(`${t("common.cli.messages.loginWait")}\n`);

  const timeoutMs = opts.timeout ?? 300000;
  let timer;
  let params;
  try {
    params = await Promise.race([
      server.waitForCallback(),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(t("common.cli.messages.oauthCallbackTimeout"))),
          timeoutMs
        );
        // Don't keep the event loop alive solely for this timer.
        if (typeof timer.unref === "function") timer.unref();
      }),
    ]);
  } finally {
    clearTimeout(timer);
    await server.close();
  }

  if (params.error) {
    throw new Error(
      t("common.cli.messages.authorizationFailed", {
        error: params.error_description || params.error,
      })
    );
  }
  if (params.state !== state) {
    throw new Error(t("common.cli.messages.stateMismatch"));
  }
  if (!params.code) {
    throw new Error(t("common.cli.messages.noAuthCode"));
  }

  const tokens = await exchange(params.code, redirectUri);
  const blob = encodeCredentialBlob({ provider: PROVIDER, tokens });

  print("\n" + t("common.cli.messages.loginCredential") + "\n\n" + blob + "\n\n");
  return blob;
}

async function runLoginAntigravity(opts) {
  try {
    await runAntigravityLogin({
      browser: opts.browser,
      timeout: opts.timeout,
      port: opts.port,
    });
  } catch (err) {
    process.stderr.write(
      `\n${t("common.cli.messages.loginFailed", { error: err?.message || err })}\n`
    );
    process.exit(1);
  }
}

export function registerLogin(program) {
  const login = program.command("login").description(t("common.cli.descriptions.login"));

  login
    .command("antigravity")
    .description(t("common.cli.descriptions.loginAntigravity"))
    .option("--no-browser", t("common.cli.options.noBrowser"))
    .option("--port <n>", t("common.cli.options.loginPort"), (v) => parseInt(v, 10))
    .option("--timeout <ms>", t("common.cli.options.loginTimeout"), (v) => parseInt(v, 10), 300000)
    .action(runLoginAntigravity);
}
