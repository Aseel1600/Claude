/**
 * tests/unit/ops-scripts.test.ts
 *
 * Contract tests for the self-hoster incident-recovery / cold-start ops scripts
 * under bin/:
 *   rollback.sh · snapshot-data.sh · restore-data.sh · restore-policies.sh ·
 *   cold-start-bench.sh
 *
 * These scripts touch deploys and the SQLite store, so the suite pins down the
 * safety contract rather than full ops behavior: every script is executable
 * bash with strict mode, prints usage on --help, the restore commands refuse to
 * run without a snapshot id, and a snapshot→restore round-trip works while the
 * non-interactive TTY guard blocks an unattended destructive restore.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const BIN = path.join(ROOT, "bin");
const REPLAY_GATE = path.join(ROOT, "scripts", "ops", "bluegreen-replay-gate.sh");
const SCRIPTS = [
  "rollback.sh",
  "snapshot-data.sh",
  "restore-data.sh",
  "restore-policies.sh",
  "cold-start-bench.sh",
];

const hasSqlite3 = spawnSync("sqlite3", ["--version"], { stdio: "ignore" }).status === 0;

/** Run a bin/ script with a NON-tty stdin (so the TTY guard engages). */
function runScript(script: string, args: string[], env: Record<string, string> = {}) {
  return spawnSync("bash", [path.join(BIN, script), ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...env },
  });
}

async function runReplayGate(
  responder: (
    request: Record<string, unknown>,
    requestNumber: number
  ) => {
    status?: number;
    body: string;
    contentType?: string;
  }
) {
  const requests: Array<Record<string, unknown>> = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const parsed = JSON.parse(body) as Record<string, unknown>;
      requests.push(parsed);
      const reply = responder(parsed, requests.length);
      res.writeHead(reply.status ?? 200, {
        "content-type": reply.contentType ?? "application/json",
      });
      res.end(reply.body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const child = spawn("bash", [REPLAY_GATE, `http://127.0.0.1:${address.port}`], {
    env: {
      ...process.env,
      OMNIROUTE_API_KEY: "sentinel-secret-key",
      REPLAY_TIMEOUT: "5",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
  child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
  const status = await new Promise<number | null>((resolve) => child.on("close", resolve));
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
  return { status, stdout, stderr, requests };
}

describe("blue-green replay gate", () => {
  it("is executable strict bash and passes syntax check", () => {
    assert.ok(fs.statSync(REPLAY_GATE).mode & 0o111);
    const body = fs.readFileSync(REPLAY_GATE, "utf8");
    assert.ok(body.startsWith("#!/usr/bin/env bash"));
    assert.ok(body.includes("set -euo pipefail"));
    assert.equal(spawnSync("bash", ["-n", REPLAY_GATE]).status, 0);
  });

  it("requires five complete text/image raw/combo suites without leaking the key", async () => {
    const result = await runReplayGate((_request, number) => ({
      body:
        number % 2 === 0
          ? 'data: {"choices":[{"delta":{"content":"ready"}}]}\n\ndata: [DONE]\n'
          : '{"choices":[{"message":{"content":"ready"}}]}',
      contentType: number % 2 === 0 ? "text/event-stream" : "application/json",
    }));
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(result.requests.length, 20);
    assert.deepEqual(
      result.requests.slice(0, 4).map((request) => request.model),
      [
        "antigravity/gemini-2.5-flash-lite",
        "antigravity/claude-sonnet-4-6",
        "pool-sonnet",
        "antigravity-sonnet-vision",
      ]
    );
    const firstMessages = result.requests.slice(0, 4).map((request) => {
      const messages = request.messages as Array<{ content: unknown }>;
      return messages[0].content;
    });
    assert.equal(typeof firstMessages[0], "string");
    assert.ok(Array.isArray(firstMessages[1]));
    assert.equal(typeof firstMessages[2], "string");
    assert.ok(Array.isArray(firstMessages[3]));
    assert.match(result.stdout, /streak=5\/5/);
    assert.doesNotMatch(result.stdout + result.stderr, /sentinel-secret-key/);
  });

  it("fails and resets qualification on any invalid case", async () => {
    const failures = [
      { status: 502, body: '{"error":{"message":"bad gateway"}}' },
      { body: '{"error":{"message":"upstream failed"}}' },
      { body: "event: error\ndata: {}\n", contentType: "text/event-stream" },
      { body: "not-json" },
      { body: '{"choices":[{"message":{"content":""}}]}' },
    ];
    for (const failure of failures) {
      const result = await runReplayGate((_request, number) =>
        number === 4 ? failure : { body: '{"choices":[{"message":{"content":"ready"}}]}' }
      );
      assert.notEqual(result.status, 0, result.stdout);
      assert.equal(result.requests.length, 4);
      assert.match(result.stdout, /streak=0\/5 FAIL/);
      assert.doesNotMatch(result.stdout + result.stderr, /sentinel-secret-key/);
    }
  });
});

describe("ops runbook scripts (bin/*.sh)", () => {
  it("every script exists, is executable, and uses bash + strict mode", () => {
    for (const s of SCRIPTS) {
      const p = path.join(BIN, s);
      assert.ok(fs.existsSync(p), `${s} is missing`);
      assert.ok(fs.statSync(p).mode & 0o111, `${s} is not executable (chmod +x)`);
      const body = fs.readFileSync(p, "utf8");
      assert.ok(body.startsWith("#!/usr/bin/env bash"), `${s} missing bash shebang`);
      assert.ok(body.includes("set -euo pipefail"), `${s} missing 'set -euo pipefail'`);
    }
  });

  it("the shared helper and every script pass `bash -n` (syntax check)", () => {
    for (const s of [...SCRIPTS, "_ops-common.sh"]) {
      const r = spawnSync("bash", ["-n", path.join(BIN, s)], { encoding: "utf8" });
      assert.equal(r.status, 0, `${s} has a syntax error: ${r.stderr}`);
    }
  });

  it("--help exits 0 with a usage banner for every script", () => {
    for (const s of SCRIPTS) {
      const r = runScript(s, ["--help"]);
      assert.equal(r.status, 0, `${s} --help exited ${r.status}: ${r.stderr}`);
      assert.match(r.stdout, /Usage:/, `${s} --help printed no usage banner`);
    }
  });

  it("restore scripts refuse to run without a snapshot id", () => {
    for (const s of ["restore-data.sh", "restore-policies.sh"]) {
      const r = runScript(s, []);
      assert.notEqual(r.status, 0, `${s} should fail without an id`);
      assert.match(r.stderr, /snapshot id required/, `${s} wrong error: ${r.stderr}`);
    }
  });

  it("snapshot → restore-data round-trips, and the TTY guard blocks unattended restores", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "omni-ops-"));
    try {
      const Database = (await import("better-sqlite3")).default;
      const dbPath = path.join(dataDir, "storage.sqlite");
      let db = new Database(dbPath);
      db.exec(
        "CREATE TABLE api_keys (id TEXT PRIMARY KEY, name TEXT);" +
          "INSERT INTO api_keys VALUES ('k1','orig');"
      );
      db.close();

      const env = { DATA_DIR: dataDir };
      const snap = runScript("snapshot-data.sh", ["--label", "test"], env);
      assert.equal(snap.status, 0, `snapshot failed: ${snap.stderr}`);
      const id = snap.stdout.trim();
      assert.ok(id, "snapshot id not printed on stdout");
      assert.ok(
        fs.existsSync(path.join(dataDir, "db_backups", `snapshot_${id}`, "storage.sqlite")),
        "snapshot dir not created"
      );

      // Mutate the live DB so a successful restore is observable.
      db = new Database(dbPath);
      db.exec("UPDATE api_keys SET name='changed' WHERE id='k1';");
      db.close();

      // Guard: non-interactive restore WITHOUT --yes must refuse (nothing destroyed).
      const blocked = runScript("restore-data.sh", [id], env);
      assert.notEqual(blocked.status, 0, "restore without --yes should be blocked");
      assert.match(blocked.stderr, /TTY/, `expected TTY guard, got: ${blocked.stderr}`);
      db = new Database(dbPath);
      assert.equal(
        (db.prepare("SELECT name FROM api_keys WHERE id='k1'").get() as { name: string }).name,
        "changed",
        "blocked restore must not have changed the DB"
      );
      db.close();

      // With --yes it reverts to the snapshot.
      const ok = runScript("restore-data.sh", [id, "--yes"], env);
      assert.equal(ok.status, 0, `restore failed: ${ok.stderr}`);
      db = new Database(dbPath);
      assert.equal(
        (db.prepare("SELECT name FROM api_keys WHERE id='k1'").get() as { name: string }).name,
        "orig",
        "restore did not revert the row"
      );
      db.close();
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it(
    "restore-policies replaces only api_key* tables, preserving other tables",
    { skip: hasSqlite3 ? false : "sqlite3 CLI not installed" },
    async () => {
      const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "omni-pol-"));
      try {
        const Database = (await import("better-sqlite3")).default;
        const dbPath = path.join(dataDir, "storage.sqlite");
        let db = new Database(dbPath);
        db.exec(
          "CREATE TABLE api_keys (id TEXT PRIMARY KEY, name TEXT);" +
            "INSERT INTO api_keys VALUES ('k1','orig');" +
            "CREATE TABLE sessions (id TEXT PRIMARY KEY);" +
            "INSERT INTO sessions VALUES ('s-old');"
        );
        db.close();

        const env = { DATA_DIR: dataDir };
        const id = runScript("snapshot-data.sh", [], env).stdout.trim();
        assert.ok(id, "snapshot id not printed");

        // Change BOTH a policy table and a non-policy table after the snapshot.
        db = new Database(dbPath);
        db.exec(
          "UPDATE api_keys SET name='changed' WHERE id='k1';" +
            "INSERT INTO sessions VALUES ('s-new');"
        );
        db.close();

        const r = runScript("restore-policies.sh", [id, "--yes"], env);
        assert.equal(r.status, 0, `restore-policies failed: ${r.stderr}`);

        db = new Database(dbPath);
        // Policy table reverted…
        assert.equal(
          (db.prepare("SELECT name FROM api_keys WHERE id='k1'").get() as { name: string }).name,
          "orig",
          "api_keys policy was not restored"
        );
        // …non-policy table left intact (live usage not rewound).
        assert.equal(
          (db.prepare("SELECT COUNT(*) c FROM sessions").get() as { c: number }).c,
          2,
          "non-policy table must not be touched by restore-policies"
        );
        db.close();
      } finally {
        fs.rmSync(dataDir, { recursive: true, force: true });
      }
    }
  );
});
