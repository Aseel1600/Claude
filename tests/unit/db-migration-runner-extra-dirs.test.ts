/**
 * tests/unit/db-migration-runner-extra-dirs.test.ts
 *
 * Extra migration directories with a namespaced version space.
 *
 * The runner reads exactly one directory (`MIGRATIONS_DIR`) and requires every
 * file to be `NNN_name.sql`, recording the bare number as the version. That makes
 * the numeric slots a single global namespace: any distribution that ships its own
 * migrations alongside the upstream set has to pick numbers out of the same range,
 * and upstream keeps appending to it. When both sides claim a number, the runner
 * records one name for it and silently treats the other as already applied — the
 * migration never runs, on every already-provisioned database.
 *
 * This suite pins a generic extension point: `OMNIROUTE_EXTRA_MIGRATIONS_DIRS`
 * maps `namespace=directory` entries (separated by `path.delimiter`), and files
 * found there are recorded as `<namespace>-<number>` so they can never collide
 * with the upstream numeric slots. Unset (the default, and always the case for a
 * plain install) the runner behaves exactly as before.
 *
 * Misconfiguration fails LOUDLY rather than silently skipping schema — a typo'd
 * namespace or a moved directory is the same class of defect this mechanism
 * exists to prevent.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import Database from "better-sqlite3";

const tempDirs: string[] = [];

function mkTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function writeMigrations(dir: string, files: Record<string, string>): void {
  for (const [name, sql] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), sql, "utf-8");
  }
}

async function importFreshRunner() {
  const modulePath = path.resolve("src/lib/db/migrationRunner.ts");
  const url = pathToFileURL(modulePath).href;
  return import(`${url}?extradirs=${Date.now()}-${Math.random().toString(16).slice(2)}`);
}

interface RunResult {
  count: number;
  rows: Array<{ version: string; name: string }>;
  tables: string[];
}

/**
 * Point the runner at a temp core dir plus the given extra dirs, run it against a
 * fresh in-memory DB and report what got applied.
 */
async function runWithDirs(
  coreFiles: Record<string, string>,
  extraSpec: string | null
): Promise<RunResult> {
  const coreDir = mkTempDir("omniroute-core-mig-");
  writeMigrations(coreDir, coreFiles);

  const prevCore = process.env.OMNIROUTE_MIGRATIONS_DIR;
  const prevExtra = process.env.OMNIROUTE_EXTRA_MIGRATIONS_DIRS;
  const prevBackup = process.env.DISABLE_SQLITE_AUTO_BACKUP;
  process.env.OMNIROUTE_MIGRATIONS_DIR = coreDir;
  process.env.DISABLE_SQLITE_AUTO_BACKUP = "true";
  if (extraSpec === null) delete process.env.OMNIROUTE_EXTRA_MIGRATIONS_DIRS;
  else process.env.OMNIROUTE_EXTRA_MIGRATIONS_DIRS = extraSpec;

  const db = new Database(":memory:");
  try {
    const { runMigrations } = await importFreshRunner();
    const count = runMigrations(db as never, { isNewDb: true });
    const rows = db
      .prepare("SELECT version, name FROM _omniroute_migrations ORDER BY rowid")
      .all() as Array<{ version: string; name: string }>;
    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as Array<{
        name: string;
      }>
    ).map((r) => r.name);
    return { count, rows, tables };
  } finally {
    db.close();
    if (prevCore === undefined) delete process.env.OMNIROUTE_MIGRATIONS_DIR;
    else process.env.OMNIROUTE_MIGRATIONS_DIR = prevCore;
    if (prevExtra === undefined) delete process.env.OMNIROUTE_EXTRA_MIGRATIONS_DIRS;
    else process.env.OMNIROUTE_EXTRA_MIGRATIONS_DIRS = prevExtra;
    if (prevBackup === undefined) delete process.env.DISABLE_SQLITE_AUTO_BACKUP;
    else process.env.DISABLE_SQLITE_AUTO_BACKUP = prevBackup;
  }
}

// Cleanup on process exit, NOT via test.after(): the root after-hook fires as soon
// as the first top-level test settles, while a later test has already registered its
// directories and is sitting on an `await` — it would delete a directory still in use.
process.on("exit", () => {
  for (const dir of tempDirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

const CORE = {
  "001_initial_schema.sql": "CREATE TABLE core_one (id INTEGER);",
  "002_core_two.sql": "CREATE TABLE core_two (id INTEGER);",
};

await test("sem a env, o runner só enxerga o diretório core (comportamento atual)", async () => {
  const r = await runWithDirs(CORE, null);
  assert.deepEqual(
    r.rows.map((x) => x.version),
    ["001", "002"]
  );
  assert.ok(r.tables.includes("core_one") && r.tables.includes("core_two"));
});

await test("migration de diretório extra é aplicada e gravada com versão namespaced", async () => {
  const eeDir = mkTempDir("mig-ee-");
  writeMigrations(eeDir, { "001_ee_lending.sql": "CREATE TABLE ee_lending (id INTEGER);" });

  const r = await runWithDirs(CORE, `ee=${eeDir}`);

  assert.ok(
    r.tables.includes("ee_lending"),
    `a migration do diretório extra deve ter rodado; count=${r.count} ` +
      `rows=${JSON.stringify(r.rows)} tabelas=${r.tables.join(", ")}`
  );
  assert.deepEqual(
    r.rows.map((x) => x.version),
    ["001", "002", "ee-001"],
    "o número do diretório extra é gravado prefixado pelo namespace e depois das core"
  );
  assert.equal(r.rows.at(-1)?.name, "ee_lending");
});

await test("o mesmo número em core e em diretório extra NÃO colide — ambas rodam", async () => {
  const eeDir = mkTempDir("omniroute-ee-collide-");
  // Mesmo prefixo numérico de uma migration core: é exatamente o caso que hoje
  // faz uma das duas ser silenciosamente considerada já aplicada.
  writeMigrations(eeDir, { "002_ee_same_slot.sql": "CREATE TABLE ee_same_slot (id INTEGER);" });

  const r = await runWithDirs(CORE, `ee=${eeDir}`);

  assert.ok(r.tables.includes("core_two"), "a core 002 deve ter rodado");
  assert.ok(r.tables.includes("ee_same_slot"), "a extra 002 deve ter rodado também");
  assert.deepEqual(
    r.rows.map((x) => x.version),
    ["001", "002", "ee-002"]
  );
});

await test("dois namespaces extras coexistem, cada um no seu espaço de versão", async () => {
  const a = mkTempDir("omniroute-nsa-");
  const b = mkTempDir("omniroute-nsb-");
  writeMigrations(a, { "001_from_a.sql": "CREATE TABLE from_a (id INTEGER);" });
  writeMigrations(b, { "001_from_b.sql": "CREATE TABLE from_b (id INTEGER);" });

  const r = await runWithDirs(CORE, `ee=${a}${path.delimiter}lab=${b}`);

  assert.ok(r.tables.includes("from_a") && r.tables.includes("from_b"));
  assert.deepEqual(
    r.rows.map((x) => x.version),
    ["001", "002", "ee-001", "lab-001"]
  );
});

await test("número duplicado DENTRO de um namespace extra é erro (não pode ser pulado em silêncio)", async () => {
  const eeDir = mkTempDir("omniroute-ee-dup-");
  writeMigrations(eeDir, {
    "003_first.sql": "CREATE TABLE ee_first (id INTEGER);",
    "003_second.sql": "CREATE TABLE ee_second (id INTEGER);",
  });

  await assert.rejects(
    () => runWithDirs(CORE, `ee=${eeDir}`),
    /collision/i,
    "duas migrations com o mesmo número no mesmo namespace têm que estourar"
  );
});

await test("spec malformada estoura em vez de ignorar o diretório", async () => {
  const eeDir = mkTempDir("omniroute-ee-malformed-");
  writeMigrations(eeDir, { "001_x.sql": "CREATE TABLE x (id INTEGER);" });

  await assert.rejects(
    () => runWithDirs(CORE, eeDir), // sem "namespace="
    /OMNIROUTE_EXTRA_MIGRATIONS_DIRS/,
    "entrada sem namespace= é configuração inválida, não um diretório a ignorar"
  );
});

await test("namespace inválido estoura (só minúsculas/dígitos, começando por letra)", async () => {
  const eeDir = mkTempDir("omniroute-ee-badns-");
  writeMigrations(eeDir, { "001_x.sql": "CREATE TABLE x (id INTEGER);" });

  await assert.rejects(
    () => runWithDirs(CORE, `EE Corp=${eeDir}`),
    /namespace/i,
    "namespace fora de [a-z][a-z0-9]* tem que estourar"
  );
});

await test("diretório configurado que não existe estoura (schema faltando em silêncio é o bug)", async () => {
  const missing = path.join(os.tmpdir(), `omniroute-nao-existe-${Date.now()}`);
  await assert.rejects(
    () => runWithDirs(CORE, `ee=${missing}`),
    /does not exist|não existe|not exist/i,
    "um diretório explicitamente configurado e ausente é erro de configuração"
  );
});

await test("arquivos que não casam NNN_nome.sql são ignorados, como no diretório core", async () => {
  const eeDir = mkTempDir("omniroute-ee-junk-");
  writeMigrations(eeDir, {
    "001_ok.sql": "CREATE TABLE ee_ok (id INTEGER);",
    "README.md": "# não é migration",
    "rascunho.sql": "CREATE TABLE nope (id INTEGER);",
  });

  const r = await runWithDirs(CORE, `ee=${eeDir}`);

  assert.ok(r.tables.includes("ee_ok"));
  assert.ok(!r.tables.includes("nope"), "arquivo .sql sem prefixo numérico não deve rodar");
  assert.deepEqual(
    r.rows.map((x) => x.version),
    ["001", "002", "ee-001"]
  );
});

await test("diretório core ausente não impede as migrations dos extras", async () => {
  // O runner devolve [] assim que MIGRATIONS_DIR não existe. Os extras são um
  // conjunto independente: um core ausente não pode fazê-los desaparecer em
  // silêncio — é a mesma falha de "schema some sem avisar" que isto previne.
  const eeDir = mkTempDir("mig-extra-only-");
  writeMigrations(eeDir, { "001_ee_solo.sql": "CREATE TABLE ee_solo (id INTEGER);" });
  const missingCore = path.join(os.tmpdir(), `mig-core-ausente-${process.pid}-${Date.now()}`);

  const prevCore = process.env.OMNIROUTE_MIGRATIONS_DIR;
  const prevExtra = process.env.OMNIROUTE_EXTRA_MIGRATIONS_DIRS;
  const prevBackup = process.env.DISABLE_SQLITE_AUTO_BACKUP;
  process.env.OMNIROUTE_MIGRATIONS_DIR = missingCore;
  process.env.OMNIROUTE_EXTRA_MIGRATIONS_DIRS = `ee=${eeDir}`;
  process.env.DISABLE_SQLITE_AUTO_BACKUP = "true";

  const db = new Database(":memory:");
  try {
    const { runMigrations } = await importFreshRunner();
    runMigrations(db as never, { isNewDb: true });
    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{
        name: string;
      }>
    ).map((r) => r.name);
    assert.ok(tables.includes("ee_solo"), `tabelas: ${tables.join(", ")}`);
  } finally {
    db.close();
    if (prevCore === undefined) delete process.env.OMNIROUTE_MIGRATIONS_DIR;
    else process.env.OMNIROUTE_MIGRATIONS_DIR = prevCore;
    if (prevExtra === undefined) delete process.env.OMNIROUTE_EXTRA_MIGRATIONS_DIRS;
    else process.env.OMNIROUTE_EXTRA_MIGRATIONS_DIRS = prevExtra;
    if (prevBackup === undefined) delete process.env.DISABLE_SQLITE_AUTO_BACKUP;
    else process.env.DISABLE_SQLITE_AUTO_BACKUP = prevBackup;
  }
});

await test("rodar duas vezes não reaplica as migrations do diretório extra", async () => {
  const eeDir = mkTempDir("omniroute-ee-idem-");
  writeMigrations(eeDir, { "001_ee_idem.sql": "CREATE TABLE ee_idem (id INTEGER);" });
  const coreDir = mkTempDir("omniroute-core-idem-");
  writeMigrations(coreDir, CORE);

  const prevCore = process.env.OMNIROUTE_MIGRATIONS_DIR;
  const prevExtra = process.env.OMNIROUTE_EXTRA_MIGRATIONS_DIRS;
  const prevBackup = process.env.DISABLE_SQLITE_AUTO_BACKUP;
  process.env.OMNIROUTE_MIGRATIONS_DIR = coreDir;
  process.env.OMNIROUTE_EXTRA_MIGRATIONS_DIRS = `ee=${eeDir}`;
  process.env.DISABLE_SQLITE_AUTO_BACKUP = "true";

  const db = new Database(":memory:");
  try {
    const { runMigrations } = await importFreshRunner();
    const first = runMigrations(db as never, { isNewDb: true });
    const second = runMigrations(db as never);
    assert.equal(first, 3, "primeira execução aplica core 001/002 + ee-001");
    assert.equal(second, 0, "segunda execução não tem nada pendente");
  } finally {
    db.close();
    if (prevCore === undefined) delete process.env.OMNIROUTE_MIGRATIONS_DIR;
    else process.env.OMNIROUTE_MIGRATIONS_DIR = prevCore;
    if (prevExtra === undefined) delete process.env.OMNIROUTE_EXTRA_MIGRATIONS_DIRS;
    else process.env.OMNIROUTE_EXTRA_MIGRATIONS_DIRS = prevExtra;
    if (prevBackup === undefined) delete process.env.DISABLE_SQLITE_AUTO_BACKUP;
    else process.env.DISABLE_SQLITE_AUTO_BACKUP = prevBackup;
  }
});
