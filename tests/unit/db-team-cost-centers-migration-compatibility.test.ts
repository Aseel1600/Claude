import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

const migrationsDir = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-team-compat-"));
const originalMigrationsDir = process.env.OMNIROUTE_MIGRATIONS_DIR;
process.env.OMNIROUTE_MIGRATIONS_DIR = migrationsDir;

fs.copyFileSync(
  path.resolve("src/lib/db/migrations/155_agentic_conversations.sql"),
  path.join(migrationsDir, "155_agentic_conversations.sql")
);
fs.copyFileSync(
  path.resolve("src/lib/db/migrations/161_team_cost_centers.sql"),
  path.join(migrationsDir, "161_team_cost_centers.sql")
);

const { runMigrations } = await import("../../src/lib/db/migrationRunner.ts");

test.after(() => {
  fs.rmSync(migrationsDir, { recursive: true, force: true });
  if (originalMigrationsDir === undefined) delete process.env.OMNIROUTE_MIGRATIONS_DIR;
  else process.env.OMNIROUTE_MIGRATIONS_DIR = originalMigrationsDir;
});

test("an applied Draft 155 Team row is rehomed and live 155 still executes", () => {
  const db = new Database(":memory:");
  try {
    db.exec(`
      CREATE TABLE _omniroute_migrations (
        version TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO _omniroute_migrations (version, name)
      VALUES ('155', 'team_cost_centers');
    `);

    assert.equal(runMigrations(db), 1);
    assert.deepEqual(
      db.prepare("SELECT version, name FROM _omniroute_migrations ORDER BY version").all(),
      [
        { version: "155", name: "agentic_conversations" },
        { version: "161", name: "team_cost_centers" },
      ]
    );
    assert.ok(
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'agentic_conversations'"
        )
        .get(),
      "live 155_agentic_conversations must execute after the Draft row moves to 161"
    );
  } finally {
    db.close();
  }
});
