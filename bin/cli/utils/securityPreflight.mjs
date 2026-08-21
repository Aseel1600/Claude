// bin/cli/utils/securityPreflight.mjs
//
// Boot-time security preflight for `omniroute serve`.
//
// OmniRoute's shipped defaults are tuned for the single-user localhost case:
// `resolveServerHost()` falls back to `0.0.0.0` (see serverHost.mjs) and
// `REQUIRE_API_KEY` defaults to false, which means the `/v1` client API answers
// anonymously (src/server/authz/policies/clientApi.ts). That combination is
// correct and frictionless on a laptop, but on a VPS / LAN / Tailscale-joined
// box it publishes an unauthenticated inference endpoint that spends the
// operator's real provider credentials and free-tier quota. The same class of
// silent-exposure applies to `STORAGE_ENCRYPTION_KEY` (unset => credentials are
// persisted in cleartext, see SECURITY.md "Encryption at Rest") and to
// `AUTH_COOKIE_SECURE` (unset => session cookies travel without the Secure flag).
//
// None of these are bugs — they are documented defaults in .env.example. The gap
// is that nothing tells the operator which of them are active for THIS boot, so
// an exposed deployment looks identical to a safe one. This module closes that
// gap by auditing the resolved runtime configuration and printing what is
// actually in effect.
//
// Design constraints, mirroring scripts/dev/tls-options.mjs:
//   - Pure and side-effect-free (the caller owns printing), so it unit-tests in
//     isolation with no process/env mutation.
//   - Dependency-light plain ESM: the CLI must not pull the Next.js server
//     module graph (src/server/authz/* transitively imports runtimeSettings ->
//     localDb -> ioredis), which is why `isLoopbackBindHost` below is a small
//     local helper rather than a re-export of `routeGuard.ts::isLoopbackHost`.
//     The codebase already carries per-entrypoint copies of this check for the
//     same reason (src/lib/headroom/detect.ts, src/lib/proxyRelay/privateHostname.ts).
//   - Default behavior is advisory only. `warn` never changes an exit code, so
//     every existing deployment boots exactly as it did before.

/** Loopback bind targets — a server on these is unreachable from the network. */
const LOOPBACK_BIND_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0:0:0:0:0:0:0:1"]);

/**
 * The `.env.example` placeholder for `INITIAL_PASSWORD`. Operators who copy the
 * example file verbatim and never change it ship a publicly-known dashboard
 * password, so it is treated as "unset" rather than "configured".
 */
const PLACEHOLDER_INITIAL_PASSWORD = "CHANGEME";

/**
 * True when `host` is a loopback bind target.
 *
 * Deliberately narrower than `routeGuard.ts::isLoopbackHost`: that function
 * classifies the *peer* of an inbound request (and so must handle `Host`
 * headers, ports and `::ffff:` mappings), whereas this one classifies the
 * *listen* address the CLI is about to hand to the server. `0.0.0.0` and `::`
 * are the unspecified addresses — they bind every interface and are therefore
 * NOT loopback, which is the whole point of the check.
 *
 * A bare `127.x.x.x` other than `127.0.0.1` still resolves to the loopback
 * device, so the whole `127.0.0.0/8` block counts.
 *
 * @param {string | undefined | null} host
 * @returns {boolean}
 */
export function isLoopbackBindHost(host) {
  if (typeof host !== "string") return false;
  let value = host.trim().toLowerCase();
  if (!value) return false;
  // Strip an IPv6 literal's brackets ("[::1]" -> "::1"); the CLI never appends
  // a port to the bind host, so there is no port to strip here.
  if (value.startsWith("[") && value.endsWith("]")) value = value.slice(1, -1);
  if (LOOPBACK_BIND_HOSTS.has(value)) return true;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(value);
}

/**
 * Read a boolean-ish env var the same way the rest of OmniRoute does: only the
 * exact string "true" enables a flag, so a stray "1"/"yes"/"TRUE " never
 * silently counts as configured.
 *
 * @param {string | undefined} value
 * @returns {boolean}
 */
function isEnabled(value) {
  return typeof value === "string" && value.trim().toLowerCase() === "true";
}

/** @returns {boolean} true when the value is a non-empty string. */
function isPresent(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Resolve the preflight mode from `OMNIROUTE_SECURITY_PREFLIGHT`.
 *
 * Defaults to "warn" — advisory, never blocking. "strict" makes the caller
 * abort the boot when a `critical` finding is present (opt-in hardening for
 * unattended VPS / container deploys, where a misconfigured exposure should
 * fail the deploy rather than quietly serve traffic). "off" silences it.
 * An unrecognized value falls back to "warn" rather than throwing, so a typo
 * can never turn the audit into a boot failure.
 *
 * @param {NodeJS.ProcessEnv} [env=process.env]
 * @returns {"off" | "warn" | "strict"}
 */
export function resolvePreflightMode(env = process.env) {
  const raw =
    typeof env?.OMNIROUTE_SECURITY_PREFLIGHT === "string"
      ? env.OMNIROUTE_SECURITY_PREFLIGHT.trim().toLowerCase()
      : "";
  if (raw === "off" || raw === "strict") return raw;
  return "warn";
}

/**
 * @typedef {object} PreflightFinding
 * @property {string} id            Stable identifier (safe to grep for in logs).
 * @property {"critical"|"high"|"medium"} severity
 * @property {string} title         One-line statement of what is exposed.
 * @property {string} detail        Why it matters for this boot.
 * @property {string} remedy        The concrete env change that resolves it.
 */

/**
 * Audit the resolved runtime configuration and return the findings that apply
 * to this boot, ordered most severe first.
 *
 * Pure: reads only its arguments, mutates nothing, prints nothing.
 *
 * @param {object} options
 * @param {string} options.host                 Resolved bind host (from `resolveServerHost()`).
 * @param {NodeJS.ProcessEnv} [options.env=process.env]
 * @param {boolean} [options.tlsEnabled=false]  True when the server terminates TLS itself
 *                                              (`resolveTlsOptions()` returned a pair).
 * @returns {PreflightFinding[]}
 */
export function evaluateSecurityPreflight({ host, env = process.env, tlsEnabled = false } = {}) {
  /** @type {PreflightFinding[]} */
  const findings = [];
  const networkExposed = !isLoopbackBindHost(host);

  // ── critical ──────────────────────────────────────────────────────────────
  // Reachable from the network AND the client API accepts anonymous callers.
  // Note this is genuinely unauthenticated rather than merely weakly
  // authenticated: with REQUIRE_API_KEY off, clientApiPolicy allows a request
  // with no bearer, and an *invalid* bearer degrades to anonymous too.
  if (networkExposed && !isEnabled(env.REQUIRE_API_KEY)) {
    findings.push({
      id: "anonymous-api-network-exposed",
      severity: "critical",
      title: `the /v1 API accepts unauthenticated requests and is bound to ${host}`,
      detail:
        "Any host that can reach this port — LAN, VPN/Tailscale peer, or the public internet " +
        "if the port is forwarded or published by a container — can call /v1/chat/completions " +
        "and spend the provider credentials and free-tier quota configured here.",
      remedy:
        "set REQUIRE_API_KEY=true, or bind loopback only with OMNIROUTE_SERVER_HOST=127.0.0.1",
    });
  }

  // ── high ──────────────────────────────────────────────────────────────────
  // Credential store running in passthrough (plaintext) mode.
  if (!isPresent(env.STORAGE_ENCRYPTION_KEY)) {
    findings.push({
      id: "credential-store-plaintext",
      severity: "high",
      title: "provider credentials are stored unencrypted",
      detail:
        "STORAGE_ENCRYPTION_KEY is not set, so the credential store runs in passthrough mode: " +
        "provider API keys, OAuth access tokens and refresh tokens are written to SQLite in " +
        "cleartext. Anything that can read the data directory — a backup, a stray `tar`, a " +
        "shared volume — reads the credentials.",
      remedy: 'set STORAGE_ENCRYPTION_KEY="$(openssl rand -hex 32)" before connecting accounts',
    });
  }

  // Dashboard still on the documented placeholder password.
  if (env.INITIAL_PASSWORD?.trim() === PLACEHOLDER_INITIAL_PASSWORD) {
    findings.push({
      id: "initial-password-placeholder",
      severity: "high",
      title: "the dashboard password is still the .env.example placeholder",
      detail:
        `INITIAL_PASSWORD is "${PLACEHOLDER_INITIAL_PASSWORD}", the literal value shipped in ` +
        ".env.example. It is public knowledge, so it grants the management surface to anyone " +
        "who can reach the dashboard.",
      remedy: "set INITIAL_PASSWORD to a unique secret, or rotate it from the dashboard",
    });
  }

  // ── medium ────────────────────────────────────────────────────────────────
  // Session cookies without the Secure flag on a network-reachable listener.
  // Only meaningful when exposed: on loopback there is no network hop to sniff.
  if (networkExposed && !isEnabled(env.AUTH_COOKIE_SECURE)) {
    findings.push({
      id: "auth-cookie-insecure",
      severity: "medium",
      title: "dashboard session cookies are sent without the Secure flag",
      detail: tlsEnabled
        ? "This listener terminates TLS, but AUTH_COOKIE_SECURE is not true, so the session " +
          "cookie is still allowed to travel over a plaintext downgrade."
        : "AUTH_COOKIE_SECURE is not true and this listener is reachable over the network, so " +
          "session cookies can be observed in transit by anything on the path.",
      remedy: "set AUTH_COOKIE_SECURE=true once the deployment is served over HTTPS",
    });
  }

  const order = { critical: 0, high: 1, medium: 2 };
  return findings.sort((a, b) => order[a.severity] - order[b.severity]);
}

/**
 * Render findings as CLI-ready lines, using the same `[omniroute][<area>]`
 * prefix convention as the TLS warnings in scripts/dev/tls-options.mjs.
 *
 * Returns an empty array for no findings so the caller can print
 * unconditionally without a length check.
 *
 * @param {PreflightFinding[]} findings
 * @param {{ mode?: "off" | "warn" | "strict" }} [options]
 * @returns {string[]}
 */
export function formatSecurityPreflight(findings, { mode = "warn" } = {}) {
  if (!Array.isArray(findings) || findings.length === 0) return [];

  const lines = [
    `[omniroute][security] ${findings.length} security ${
      findings.length === 1 ? "finding" : "findings"
    } for this boot:`,
  ];

  for (const finding of findings) {
    lines.push(`[omniroute][security]   ${finding.severity.toUpperCase()}: ${finding.title}`);
    lines.push(`[omniroute][security]     why: ${finding.detail}`);
    lines.push(`[omniroute][security]     fix: ${finding.remedy}`);
  }

  lines.push(
    "[omniroute][security] Details: docs/security/STARTUP_PREFLIGHT.md · " +
      "silence with OMNIROUTE_SECURITY_PREFLIGHT=off · " +
      "fail the boot on CRITICAL with OMNIROUTE_SECURITY_PREFLIGHT=strict"
  );

  if (mode === "strict" && findings.some((f) => f.severity === "critical")) {
    lines.push(
      "[omniroute][security] Refusing to start: OMNIROUTE_SECURITY_PREFLIGHT=strict and a " +
        "CRITICAL finding is present."
    );
  }

  return lines;
}

/**
 * Run the preflight and report it, returning whether the boot may continue.
 *
 * The single entrypoint the CLI calls. Printing is injected so the caller (and
 * the tests) control the sink; `warn` is used rather than `log` so the audit
 * survives stdout redirection into a log file.
 *
 * @param {object} options
 * @param {string} options.host
 * @param {NodeJS.ProcessEnv} [options.env=process.env]
 * @param {boolean} [options.tlsEnabled=false]
 * @param {{ warn?: (msg: string) => void }} [deps]
 * @returns {{ ok: boolean, mode: "off"|"warn"|"strict", findings: PreflightFinding[] }}
 *          `ok: false` only in `strict` mode with a `critical` finding.
 */
export function runSecurityPreflight(
  { host, env = process.env, tlsEnabled = false } = {},
  { warn = (m) => console.warn(m) } = {}
) {
  const mode = resolvePreflightMode(env);
  if (mode === "off") return { ok: true, mode, findings: [] };

  const findings = evaluateSecurityPreflight({ host, env, tlsEnabled });
  for (const line of formatSecurityPreflight(findings, { mode })) warn(line);

  const blocked = mode === "strict" && findings.some((f) => f.severity === "critical");
  return { ok: !blocked, mode, findings };
}
