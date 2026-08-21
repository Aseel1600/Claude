---
title: Startup Security Preflight
---

# Startup Security Preflight

> **Source of truth:** `bin/cli/utils/securityPreflight.mjs`
> **Wired into:** `bin/cli/commands/serve.mjs`
> **Tests:** `tests/unit/cli-security-preflight.test.ts`
> **Audience:** Operators running `omniroute serve` on anything other than a single-user laptop.

OmniRoute's defaults are tuned for the localhost case. `resolveServerHost()` falls back to
`0.0.0.0`, `REQUIRE_API_KEY` defaults to `false`, and `STORAGE_ENCRYPTION_KEY` is empty in
`.env.example`. Each of those is documented and deliberate — together they make `npx omniroute`
work with zero configuration, which is the point.

The problem is that an **exposed** deployment and a **safe** one print exactly the same startup
banner. Nothing tells the operator that the listener they just opened on a VPS answers
`/v1/chat/completions` anonymously, or that the OAuth refresh tokens they are about to connect
will land in SQLite as cleartext.

The preflight closes that gap. It audits the configuration that was actually resolved for this
boot and prints what is in effect, before anything listens.

## What it checks

| Severity     | id                              | Condition                                                            |
| ------------ | ------------------------------- | -------------------------------------------------------------------- |
| **CRITICAL** | `anonymous-api-network-exposed` | Bind host is not loopback **and** `REQUIRE_API_KEY` is not `true`    |
| **HIGH**     | `credential-store-plaintext`    | `STORAGE_ENCRYPTION_KEY` is unset or blank                           |
| **HIGH**     | `initial-password-placeholder`  | `INITIAL_PASSWORD` is still the literal `.env.example` `CHANGEME`    |
| **MEDIUM**   | `auth-cookie-insecure`          | Bind host is not loopback **and** `AUTH_COOKIE_SECURE` is not `true` |

Two checks are deliberately conditioned on the bind host. On loopback there is no network hop to
sniff and no remote caller to authenticate, so reporting them there would be noise — and an audit
that cries wolf on the default laptop install is an audit operators learn to skip.

`0.0.0.0` and `::` are the unspecified addresses: they bind **every** interface and therefore
count as exposed. The whole `127.0.0.0/8` block counts as loopback.

### Why the anonymous API is CRITICAL

With `REQUIRE_API_KEY` off, `clientApiPolicy` (`src/server/authz/policies/clientApi.ts`) allows a
request that carries no bearer at all, and an _invalid_ bearer degrades to anonymous rather than
returning 401. There is no source-IP restriction on the `CLIENT_API` tier. So any host that can
reach the port — a LAN neighbour, a Tailscale peer, or the public internet when the port is
forwarded or published by a container — can spend the provider credentials and free-tier quota
configured on that instance.

## Modes

Set `OMNIROUTE_SECURITY_PREFLIGHT`:

| Value    | Behavior                                                                      |
| -------- | ----------------------------------------------------------------------------- |
| `warn`   | **Default.** Report findings and continue. Never changes the exit code.       |
| `strict` | Report findings, then refuse to start if any **CRITICAL** finding is present. |
| `off`    | Skip the audit entirely — print nothing, evaluate nothing.                    |

An unrecognized value falls back to `warn`. A typo in this variable can never fail a boot.

`strict` is intended for unattended deploys — a VPS provisioner or container entrypoint where a
misconfigured exposure should fail the deploy loudly instead of quietly serving traffic. It gates
on CRITICAL only: `HIGH` and `MEDIUM` findings are reported but never block, so enabling `strict`
cannot turn a working deployment into a boot loop over a cookie flag.

## Example output

```
[omniroute][security] 3 security findings for this boot:
[omniroute][security]   CRITICAL: the /v1 API accepts unauthenticated requests and is bound to 0.0.0.0
[omniroute][security]     why: Any host that can reach this port — LAN, VPN/Tailscale peer, or the public internet if the port is forwarded or published by a container — can call /v1/chat/completions and spend the provider credentials and free-tier quota configured here.
[omniroute][security]     fix: set REQUIRE_API_KEY=true, or bind loopback only with OMNIROUTE_SERVER_HOST=127.0.0.1
[omniroute][security]   HIGH: provider credentials are stored unencrypted
[omniroute][security]     why: STORAGE_ENCRYPTION_KEY is not set, so the credential store runs in passthrough mode: provider API keys, OAuth access tokens and refresh tokens are written to SQLite in cleartext. Anything that can read the data directory — a backup, a stray `tar`, a shared volume — reads the credentials.
[omniroute][security]     fix: set STORAGE_ENCRYPTION_KEY="$(openssl rand -hex 32)" before connecting accounts
[omniroute][security]   MEDIUM: dashboard session cookies are sent without the Secure flag
[omniroute][security]     why: AUTH_COOKIE_SECURE is not true and this listener is reachable over the network, so session cookies can be observed in transit by anything on the path.
[omniroute][security]     fix: set AUTH_COOKIE_SECURE=true once the deployment is served over HTTPS
[omniroute][security] Details: docs/security/STARTUP_PREFLIGHT.md · silence with OMNIROUTE_SECURITY_PREFLIGHT=off · fail the boot on CRITICAL with OMNIROUTE_SECURITY_PREFLIGHT=strict
```

A fully hardened boot prints nothing.

Findings go to `console.warn` (stderr) rather than `console.log`, so the audit survives the common
`omniroute serve > omniroute.log` redirection.

## Hardened reference configuration

```bash
REQUIRE_API_KEY=true                              # key-gate the /v1 client API
OMNIROUTE_SERVER_HOST=127.0.0.1                   # or keep 0.0.0.0 behind a reverse proxy
STORAGE_ENCRYPTION_KEY="$(openssl rand -hex 32)"  # AES-256-GCM at rest
AUTH_COOKIE_SECURE=true                           # once TLS terminates in front
INITIAL_PASSWORD=<a unique secret>
```

## Design notes

- `evaluateSecurityPreflight()` is pure: it reads only its arguments, mutates nothing and prints
  nothing. Printing is injected, which is what lets the whole matrix be unit-tested without
  touching `process.env`.
- The module is plain, dependency-light ESM. It does **not** import
  `src/server/authz/routeGuard.ts`, because that transitively pulls the Next.js server module
  graph (`runtimeSettings` → `localDb` → `ioredis`) into the CLI process. `isLoopbackBindHost()` is
  a small local helper for the same reason `src/lib/headroom/detect.ts` and
  `src/lib/proxyRelay/privateHostname.ts` carry their own copies.
- It also answers a _different_ question than `routeGuard.ts`. That module classifies the **peer**
  of an inbound request and so must handle `Host` headers, ports and `::ffff:` mappings — and must
  never trust them. This one classifies the **listen address** the CLI is about to bind, which is
  local configuration, not attacker-controlled input.
- Boolean env vars are read the same way as elsewhere in OmniRoute: only `true` (case-insensitive,
  trimmed) enables a flag, so a stray `1` or `yes` is never mistaken for an enabled setting — the
  audit must not report "safe" when the server is in fact anonymous.
