import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Guard dos defaults de compressao deste fork.
//
// Duas garantias distintas:
//
// 1. `enabled` DEVE permanecer `false`. Este e o master switch: em
//    open-sse/handlers/chatCore.ts o `promptCompressionEnabled` vem direto de
//    `settings.enabled`, entao com ele desligado nenhum payload e mutado. Os
//    demais defaults so passam a valer depois que o operador liga a compressao.
//    Ligar por padrao mutaria trafego legitimo sem consentimento — mesma razao
//    da Hard Rule #20 para PII.
//
// 2. Os defaults ajustados do fork (`lite` / `stacked` / 32000) estao escritos a
//    mao em DOIS lugares — a constante e o seed da migration 034. Copias
//    manuais divergem silenciosamente: a constante governa instalacoes novas em
//    memoria, o seed governa o que vai pro banco. Se divergirem, o operador ve
//    um valor na UI e outro em efeito. Este teste falha na divergencia.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const MIGRATION_PATH = path.join(REPO_ROOT, "src/lib/db/migrations/034_compression_settings.sql");

const { DEFAULT_COMPRESSION_CONFIG } =
  await import("../../../open-sse/services/compression/types.ts");

/** Le o seed da migration 034 como um mapa chave -> valor ja desserializado. */
function readMigrationSeed(): Record<string, unknown> {
  const sql = fs.readFileSync(MIGRATION_PATH, "utf-8");
  const seed: Record<string, unknown> = {};
  const re = /VALUES\s*\('compression',\s*'([^']+)',\s*'(.*)'\);/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) {
    seed[m[1]] = JSON.parse(m[2]);
  }
  return seed;
}

test("defaults de compressao do fork", async (t) => {
  await t.test("compressao permanece DESLIGADA por padrao", () => {
    assert.strictEqual(
      DEFAULT_COMPRESSION_CONFIG.enabled,
      false,
      "compressao deve ser opt-in: `enabled` gateia toda a mutacao de payload " +
        "(chatCore.ts -> promptCompressionEnabled). Ligar por padrao mutaria " +
        "trafego legitimo sem o operador pedir."
    );
  });

  await t.test("seed da migration 034 tambem nasce desligado", () => {
    const seed = readMigrationSeed();
    assert.strictEqual(
      seed.enabled,
      false,
      "o seed da migration nao pode ligar a compressao em instalacoes novas"
    );
  });

  await t.test("defaults ajustados do fork estao fixados", () => {
    assert.strictEqual(DEFAULT_COMPRESSION_CONFIG.defaultMode, "lite");
    assert.strictEqual(DEFAULT_COMPRESSION_CONFIG.autoTriggerMode, "stacked");
    assert.strictEqual(DEFAULT_COMPRESSION_CONFIG.autoTriggerTokens, 32000);
  });

  await t.test("constante e seed da migration nao divergem", () => {
    const seed = readMigrationSeed();
    assert.ok(
      Object.keys(seed).length > 0,
      `nenhum INSERT lido de ${MIGRATION_PATH} — o formato do seed mudou e este guard ficou cego`
    );

    for (const [key, seedValue] of Object.entries(seed)) {
      assert.deepStrictEqual(
        seedValue,
        DEFAULT_COMPRESSION_CONFIG[key as keyof typeof DEFAULT_COMPRESSION_CONFIG],
        `'${key}' divergiu entre a migration 034 e DEFAULT_COMPRESSION_CONFIG — ` +
          `os dois sao escritos a mao e precisam andar juntos`
      );
    }
  });
});
