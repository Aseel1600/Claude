import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateSecurityPreflight,
  formatSecurityPreflight,
  isLoopbackBindHost,
  resolvePreflightMode,
  runSecurityPreflight,
} from "../../bin/cli/utils/securityPreflight.mjs";

/** Env that produces zero findings — the fully-hardened baseline. */
const SAFE_ENV = {
  REQUIRE_API_KEY: "true",
  STORAGE_ENCRYPTION_KEY: "a".repeat(64),
  AUTH_COOKIE_SECURE: "true",
};

function ids(findings: { id: string }[]): string[] {
  return findings.map((f) => f.id);
}

// ── isLoopbackBindHost ──────────────────────────────────────────────────────

test("security preflight: loopback bind hosts are recognized", () => {
  for (const host of ["127.0.0.1", "localhost", "::1", "[::1]", "LOCALHOST", " 127.0.0.1 "]) {
    assert.equal(isLoopbackBindHost(host), true, `${host} should be loopback`);
  }
});

test("security preflight: the whole 127.0.0.0/8 block is loopback", () => {
  assert.equal(isLoopbackBindHost("127.0.0.2"), true);
  assert.equal(isLoopbackBindHost("127.1.2.3"), true);
});

test("security preflight: unspecified addresses are NOT loopback", () => {
  // This is the crux of the check — 0.0.0.0 / :: bind every interface, which is
  // exactly the exposure the preflight exists to report.
  assert.equal(isLoopbackBindHost("0.0.0.0"), false);
  assert.equal(isLoopbackBindHost("::"), false);
});

test("security preflight: LAN / public / hostname binds are NOT loopback", () => {
  for (const host of ["192.168.1.50", "10.0.0.7", "100.101.102.103", "203.0.113.9", "omni.local"]) {
    assert.equal(isLoopbackBindHost(host), false, `${host} should not be loopback`);
  }
});

test("security preflight: malformed / empty bind hosts are not treated as loopback", () => {
  // Fail closed: an unparseable bind host must not silently suppress the audit.
  assert.equal(isLoopbackBindHost(""), false);
  assert.equal(isLoopbackBindHost("   "), false);
  assert.equal(isLoopbackBindHost(undefined), false);
  assert.equal(isLoopbackBindHost(null), false);
  assert.equal(isLoopbackBindHost(127 as unknown as string), false);
  assert.equal(isLoopbackBindHost("127.0.0.1.1"), false);
  assert.equal(isLoopbackBindHost("127.0.0.999"), true); // regex-shaped; still the loopback device
});

// ── evaluateSecurityPreflight ───────────────────────────────────────────────

test("security preflight: hardened loopback deployment reports nothing", () => {
  const findings = evaluateSecurityPreflight({ host: "127.0.0.1", env: SAFE_ENV });
  assert.deepEqual(findings, []);
});

test("security preflight: hardened 0.0.0.0 deployment reports nothing", () => {
  // Binding every interface is fine when the API is key-gated and cookies are
  // Secure — the preflight must not nag a correctly-configured VPS.
  const findings = evaluateSecurityPreflight({ host: "0.0.0.0", env: SAFE_ENV });
  assert.deepEqual(findings, []);
});

test("security preflight: default 0.0.0.0 + REQUIRE_API_KEY unset is CRITICAL", () => {
  const findings = evaluateSecurityPreflight({ host: "0.0.0.0", env: {} });
  const critical = findings.filter((f) => f.severity === "critical");
  assert.equal(critical.length, 1);
  assert.equal(critical[0].id, "anonymous-api-network-exposed");
  // The bind host is echoed so the operator can tell which interface is meant.
  assert.match(critical[0].title, /0\.0\.0\.0/);
});

test("security preflight: anonymous API on loopback is NOT reported", () => {
  // The shipped single-user laptop default must stay silent, or the audit
  // becomes noise that operators learn to ignore.
  const findings = evaluateSecurityPreflight({
    host: "127.0.0.1",
    env: { STORAGE_ENCRYPTION_KEY: "k", AUTH_COOKIE_SECURE: "false" },
  });
  assert.deepEqual(findings, []);
});

test("security preflight: REQUIRE_API_KEY only counts when exactly 'true'", () => {
  // Mirrors how the rest of OmniRoute reads boolean env vars — "1"/"yes" must
  // not be mistaken for an enabled flag, or the audit would report safe when
  // the server is in fact anonymous.
  for (const value of ["1", "yes", "on", "TRUE", "True", ""]) {
    const findings = evaluateSecurityPreflight({
      host: "0.0.0.0",
      env: { ...SAFE_ENV, REQUIRE_API_KEY: value },
    });
    const reported = ids(findings).includes("anonymous-api-network-exposed");
    if (value === "TRUE" || value === "True") {
      assert.equal(reported, false, `${value} is case-insensitively true`);
    } else {
      assert.equal(reported, true, `${value} must not count as enabled`);
    }
  }
});

test("security preflight: missing STORAGE_ENCRYPTION_KEY is HIGH on any bind host", () => {
  for (const host of ["127.0.0.1", "0.0.0.0"]) {
    const findings = evaluateSecurityPreflight({
      host,
      env: { REQUIRE_API_KEY: "true", AUTH_COOKIE_SECURE: "true" },
    });
    assert.deepEqual(ids(findings), ["credential-store-plaintext"]);
    assert.equal(findings[0].severity, "high");
  }
});

test("security preflight: whitespace-only STORAGE_ENCRYPTION_KEY counts as unset", () => {
  const findings = evaluateSecurityPreflight({
    host: "127.0.0.1",
    env: { ...SAFE_ENV, STORAGE_ENCRYPTION_KEY: "   " },
  });
  assert.deepEqual(ids(findings), ["credential-store-plaintext"]);
});

test("security preflight: the .env.example INITIAL_PASSWORD placeholder is HIGH", () => {
  const findings = evaluateSecurityPreflight({
    host: "127.0.0.1",
    env: { ...SAFE_ENV, INITIAL_PASSWORD: "CHANGEME" },
  });
  assert.deepEqual(ids(findings), ["initial-password-placeholder"]);
});

test("security preflight: a real INITIAL_PASSWORD is not reported", () => {
  const findings = evaluateSecurityPreflight({
    host: "127.0.0.1",
    env: { ...SAFE_ENV, INITIAL_PASSWORD: "a-real-unique-secret" },
  });
  assert.deepEqual(findings, []);
});

test("security preflight: non-Secure cookies are MEDIUM only when network-exposed", () => {
  const exposed = evaluateSecurityPreflight({
    host: "0.0.0.0",
    env: { ...SAFE_ENV, AUTH_COOKIE_SECURE: "false" },
  });
  assert.deepEqual(ids(exposed), ["auth-cookie-insecure"]);
  assert.equal(exposed[0].severity, "medium");

  const loopback = evaluateSecurityPreflight({
    host: "127.0.0.1",
    env: { ...SAFE_ENV, AUTH_COOKIE_SECURE: "false" },
  });
  assert.deepEqual(loopback, []);
});

test("security preflight: cookie detail distinguishes TLS-terminating listeners", () => {
  const withTls = evaluateSecurityPreflight({
    host: "0.0.0.0",
    env: { ...SAFE_ENV, AUTH_COOKIE_SECURE: "false" },
    tlsEnabled: true,
  });
  assert.match(withTls[0].detail, /terminates TLS/);

  const withoutTls = evaluateSecurityPreflight({
    host: "0.0.0.0",
    env: { ...SAFE_ENV, AUTH_COOKIE_SECURE: "false" },
    tlsEnabled: false,
  });
  assert.match(withoutTls[0].detail, /reachable over the network/);
});

test("security preflight: findings are ordered most severe first", () => {
  const findings = evaluateSecurityPreflight({
    host: "0.0.0.0",
    env: { INITIAL_PASSWORD: "CHANGEME" },
  });
  assert.deepEqual(ids(findings), [
    "anonymous-api-network-exposed",
    "credential-store-plaintext",
    "initial-password-placeholder",
    "auth-cookie-insecure",
  ]);
  assert.deepEqual(
    findings.map((f) => f.severity),
    ["critical", "high", "high", "medium"]
  );
});

test("security preflight: every finding carries a title, detail and remedy", () => {
  const findings = evaluateSecurityPreflight({
    host: "0.0.0.0",
    env: { INITIAL_PASSWORD: "CHANGEME" },
  });
  assert.equal(findings.length, 4);
  for (const finding of findings) {
    assert.ok(finding.id.length > 0, "id");
    assert.ok(finding.title.length > 0, `title for ${finding.id}`);
    assert.ok(finding.detail.length > 0, `detail for ${finding.id}`);
    assert.ok(finding.remedy.length > 0, `remedy for ${finding.id}`);
  }
});

test("security preflight: evaluate() does not mutate the env it is handed", () => {
  const env = { INITIAL_PASSWORD: "CHANGEME" };
  const snapshot = JSON.stringify(env);
  evaluateSecurityPreflight({ host: "0.0.0.0", env });
  assert.equal(JSON.stringify(env), snapshot);
});

test("security preflight: evaluate() tolerates being called with no arguments", () => {
  // Defensive: a caller that forgets the host must not crash the boot.
  assert.doesNotThrow(() => evaluateSecurityPreflight());
});

// ── resolvePreflightMode ────────────────────────────────────────────────────

test("security preflight: mode defaults to warn", () => {
  assert.equal(resolvePreflightMode({}), "warn");
  assert.equal(resolvePreflightMode({ OMNIROUTE_SECURITY_PREFLIGHT: "" }), "warn");
});

test("security preflight: mode accepts off/warn/strict case-insensitively", () => {
  assert.equal(resolvePreflightMode({ OMNIROUTE_SECURITY_PREFLIGHT: "off" }), "off");
  assert.equal(resolvePreflightMode({ OMNIROUTE_SECURITY_PREFLIGHT: " STRICT " }), "strict");
  assert.equal(resolvePreflightMode({ OMNIROUTE_SECURITY_PREFLIGHT: "Warn" }), "warn");
});

test("security preflight: an unrecognized mode falls back to warn, never throws", () => {
  // A typo in an env var must not be able to fail a boot.
  assert.equal(resolvePreflightMode({ OMNIROUTE_SECURITY_PREFLIGHT: "stirct" }), "warn");
  assert.equal(resolvePreflightMode({ OMNIROUTE_SECURITY_PREFLIGHT: "true" }), "warn");
});

// ── formatSecurityPreflight ─────────────────────────────────────────────────

test("security preflight: no findings formats to no output", () => {
  assert.deepEqual(formatSecurityPreflight([]), []);
  assert.deepEqual(formatSecurityPreflight(undefined as never), []);
});

test("security preflight: every emitted line carries the [omniroute][security] prefix", () => {
  const findings = evaluateSecurityPreflight({ host: "0.0.0.0", env: {} });
  const lines = formatSecurityPreflight(findings);
  assert.ok(lines.length > 0);
  for (const line of lines) {
    assert.ok(line.startsWith("[omniroute][security]"), line);
  }
});

test("security preflight: output names the severity, the fix and the escape hatches", () => {
  const lines = formatSecurityPreflight(
    evaluateSecurityPreflight({ host: "0.0.0.0", env: {} })
  ).join("\n");
  assert.match(lines, /CRITICAL/);
  assert.match(lines, /REQUIRE_API_KEY=true/);
  assert.match(lines, /OMNIROUTE_SECURITY_PREFLIGHT=off/);
  assert.match(lines, /OMNIROUTE_SECURITY_PREFLIGHT=strict/);
});

test("security preflight: singular/plural finding count", () => {
  const one = formatSecurityPreflight(
    evaluateSecurityPreflight({ host: "127.0.0.1", env: { REQUIRE_API_KEY: "true" } })
  );
  assert.match(one[0], /1 security finding for this boot/);

  const many = formatSecurityPreflight(evaluateSecurityPreflight({ host: "0.0.0.0", env: {} }));
  assert.match(many[0], /3 security findings for this boot/);
});

test("security preflight: strict mode announces the refusal in the output", () => {
  const findings = evaluateSecurityPreflight({ host: "0.0.0.0", env: {} });
  assert.match(
    formatSecurityPreflight(findings, { mode: "strict" }).join("\n"),
    /Refusing to start/
  );
  assert.doesNotMatch(formatSecurityPreflight(findings, { mode: "warn" }).join("\n"), /Refusing/);
});

// ── runSecurityPreflight ────────────────────────────────────────────────────

test("security preflight: warn mode reports but always allows the boot", () => {
  const warnings: string[] = [];
  const result = runSecurityPreflight(
    { host: "0.0.0.0", env: {} },
    { warn: (m) => warnings.push(m) }
  );
  assert.equal(result.ok, true);
  assert.equal(result.mode, "warn");
  assert.ok(result.findings.length > 0);
  assert.ok(warnings.length > 0);
});

test("security preflight: off mode prints nothing and evaluates nothing", () => {
  const warnings: string[] = [];
  const result = runSecurityPreflight(
    { host: "0.0.0.0", env: { OMNIROUTE_SECURITY_PREFLIGHT: "off" } },
    { warn: (m) => warnings.push(m) }
  );
  assert.equal(result.ok, true);
  assert.equal(result.mode, "off");
  assert.deepEqual(result.findings, []);
  assert.deepEqual(warnings, []);
});

test("security preflight: strict mode blocks the boot on a CRITICAL finding", () => {
  const warnings: string[] = [];
  const result = runSecurityPreflight(
    { host: "0.0.0.0", env: { OMNIROUTE_SECURITY_PREFLIGHT: "strict" } },
    { warn: (m) => warnings.push(m) }
  );
  assert.equal(result.ok, false);
  assert.equal(result.mode, "strict");
  assert.match(warnings.join("\n"), /Refusing to start/);
});

test("security preflight: strict mode allows the boot when nothing is CRITICAL", () => {
  // HIGH/MEDIUM findings are reported but must not fail a deploy — only a
  // network-exposed anonymous API is severe enough to block.
  const warnings: string[] = [];
  const result = runSecurityPreflight(
    {
      host: "0.0.0.0",
      env: {
        ...SAFE_ENV,
        STORAGE_ENCRYPTION_KEY: "",
        OMNIROUTE_SECURITY_PREFLIGHT: "strict",
      },
    },
    { warn: (m) => warnings.push(m) }
  );
  assert.equal(result.ok, true);
  assert.deepEqual(ids(result.findings), ["credential-store-plaintext"]);
  assert.doesNotMatch(warnings.join("\n"), /Refusing to start/);
});

test("security preflight: a fully hardened boot prints nothing at all", () => {
  const warnings: string[] = [];
  const result = runSecurityPreflight(
    { host: "0.0.0.0", env: SAFE_ENV },
    { warn: (m) => warnings.push(m) }
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.findings, []);
  assert.deepEqual(warnings, []);
});
