import { existsSync } from "node:fs";
import { resolveDataDir } from "../data-dir.mjs";
import { join } from "node:path";
import { t } from "../i18n.mjs";

const ENCRYPTED_PATTERN = "enc:v1:%";
const ENCRYPTED_COLUMNS = ["api_key", "access_token", "refresh_token", "id_token"];

/**
 * Direct SQLite implementation for reset-encrypted-columns.
 * Uses better-sqlite3 directly to avoid TypeScript source dependencies in production builds.
 */
export async function runResetEncryptedColumns(argv) {
  const dataDir = resolveDataDir();
  const dbPath = join(dataDir, "storage.sqlite");

  if (!existsSync(dbPath)) {
    console.log(`\x1b[33m${t("common.cli.messages.databaseNotFound", { path: dbPath })}\x1b[0m`);
    return 0;
  }

  const force = Array.isArray(argv) ? argv.includes("--force") : argv?.force === true;

  if (!force) {
    console.log(
      `\x1b[1m\x1b[33m${t("common.cli.messages.resetWarning", {
        columns: ENCRYPTED_COLUMNS.join("\n    • "),
        path: dbPath,
        command: "omniroute reset-encrypted-columns --force",
      })}\x1b[0m`
    );
    return 0;
  }

  let db;
  try {
    // Use createRequire to load better-sqlite3 (works in both dev and production)
    const { createRequire } = await import("node:module");
    const require = createRequire(import.meta.url);
    const Database = require("better-sqlite3");

    db = new Database(dbPath);

    // Build WHERE clause for encrypted values
    const whereClause = ENCRYPTED_COLUMNS.map((col) => `${col} LIKE '${ENCRYPTED_PATTERN}'`).join(
      " OR "
    );

    // Count affected rows
    const countResult = db
      .prepare(`SELECT COUNT(*) AS cnt FROM provider_connections WHERE ${whereClause}`)
      .get();
    const count = countResult?.cnt ?? 0;

    if (count === 0) {
      console.log(`\x1b[32m${t("common.cli.messages.noEncryptedCredentials")}\x1b[0m`);
      return 0;
    }

    // Reset columns
    const nullCols = ENCRYPTED_COLUMNS.map((col) => `${col} = NULL`).join(", ");
    db.prepare(`UPDATE provider_connections SET ${nullCols} WHERE ${whereClause}`).run();

    console.log(`\x1b[32m${t("common.cli.messages.resetSuccess", { count })}\x1b[0m`);
    return 0;
  } catch (err) {
    console.error(
      `\x1b[31m${t("common.cli.messages.resetFailed", {
        error: err instanceof Error ? err.message : String(err),
      })}\x1b[0m`
    );
    return 1;
  } finally {
    if (db) {
      db.close();
    }
  }
}
