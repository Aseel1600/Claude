/**
 * Test-only workaround for the inherited base-red "Migration version collision
 * detected: version=134" (`134_ccr_blocks.sql` + `134_proxy_logs_egress_ip.sql`
 * both exist on release/v3.8.50). Any test that exercises a code path opening
 * the DB (e.g. `VisionBridgeGuardrail.preCall` → `getResolvedModelCapabilities`
 * → `getDbInstance`) dies at migration-file scan time, BEFORE the code under
 * test runs — making TDD on those paths impossible until the base is fixed.
 *
 * This helper copies the real migrations into a temp dir, renumbering any file
 * whose numeric prefix duplicates an earlier one to a fresh (max+1) version,
 * and points `OMNIROUTE_MIGRATIONS_DIR` (supported operator env var — see
 * `src/lib/db/migrationRunner.ts::resolveMigrationsDir`) at the copy. On the
 * FRESH per-process test DATA_DIR (tests/_setup/isolateDataDir.ts) the
 * numbering is irrelevant: the schema content applied is byte-identical.
 * Once the collision is fixed on the base branch, the copy contains no
 * duplicates and this degrades to a plain pass-through copy.
 *
 * MUST be called before the first `getDbInstance()` in the process (i.e. at
 * test-file top level, before any `preCall`). An explicitly configured
 * `OMNIROUTE_MIGRATIONS_DIR` always wins.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function useDecollidedMigrationsDir(): void {
  if (process.env.OMNIROUTE_MIGRATIONS_DIR) return;

  const realDir = path.resolve("src/lib/db/migrations");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-test-migrations-"));

  const files = fs
    .readdirSync(realDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();

  let maxVersion = 0;
  for (const file of files) {
    const match = file.match(/^(\d+)_/);
    if (match) maxVersion = Math.max(maxVersion, Number.parseInt(match[1], 10));
  }

  const seenVersions = new Set<number>();
  for (const file of files) {
    const match = file.match(/^(\d+)_(.*)$/);
    let target = file;
    if (match) {
      const version = Number.parseInt(match[1], 10);
      if (seenVersions.has(version)) {
        // Collision: move the later duplicate to a fresh version slot.
        maxVersion += 1;
        target = `${maxVersion}_${match[2]}`;
      } else {
        seenVersions.add(version);
      }
    }
    fs.copyFileSync(path.join(realDir, file), path.join(tmp, target));
  }

  process.env.OMNIROUTE_MIGRATIONS_DIR = tmp;

  process.on("exit", () => {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup — the OS reaps its temp dir eventually.
    }
  });
}
