import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { syncStandaloneExtraModules } from "../../../scripts/build/assembleStandalone.mjs";
import { PACK_ARTIFACT_REQUIRED_PATHS } from "../../../scripts/build/pack-artifact-policy.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const PRIMARY_SOURCE_HASHES = {
  "tls-client-node@0.2.0 LICENSE":
    "086c687026ff693ad76589dda1af12304a3ff33fc5f15030035ed62ef6a6d6eb",
  "tls-client-node@0.2.0 NOTICE":
    "80e5a526273788f2ace0164ec131daac697c54084add90855afdd03f5fadd3d3",
  "bogdanfinn/tls-client@v1.15.1 LICENSE":
    "7dab9a4dd66987fbe576d53c1ee047c193725df6f4fac67de315a127417fd151",
} as const;

function extractVerbatimBlock(document: string, label: keyof typeof PRIMARY_SOURCE_HASHES): string {
  const beginMarker = `<!-- BEGIN VERBATIM: ${label} -->`;
  const endMarker = `<!-- END VERBATIM: ${label} -->`;
  const markerStart = document.indexOf(beginMarker);
  assert.notEqual(markerStart, -1, `missing begin marker for ${label}`);
  const fenceStart = document.indexOf("```text\n", markerStart + beginMarker.length);
  assert.notEqual(fenceStart, -1, `missing text fence for ${label}`);
  const contentStart = fenceStart + "```text\n".length;
  const finish = document.indexOf("\n```", contentStart);
  assert.notEqual(finish, -1, `missing closing fence for ${label}`);
  assert.notEqual(document.indexOf(endMarker, finish), -1, `missing end marker for ${label}`);
  return document.slice(contentStart, finish);
}

test("distributed tls-client notices reproduce every primary license and NOTICE verbatim", () => {
  const notices = readFileSync(join(ROOT, "THIRD_PARTY_NOTICES.md"), "utf8");

  for (const [label, expectedHash] of Object.entries(PRIMARY_SOURCE_HASHES)) {
    const text = extractVerbatimBlock(notices, label as keyof typeof PRIMARY_SOURCE_HASHES);
    assert.equal(
      createHash("sha256").update(text).digest("hex"),
      expectedHash,
      `${label} must remain byte-for-byte identical to its tagged primary source`
    );
  }
});

test("the distributed wrapper is pinned to the exact audited tls-client-node release", () => {
  const packageJson = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const packageLock = JSON.parse(readFileSync(join(ROOT, "package-lock.json"), "utf8"));

  assert.equal(packageJson.optionalDependencies["tls-client-node"], "0.2.0");
  assert.equal(packageLock.packages[""].optionalDependencies["tls-client-node"], "0.2.0");
  assert.equal(packageLock.packages["node_modules/tls-client-node"].version, "0.2.0");
});

test("npm pack, standalone, and Docker all transport THIRD_PARTY_NOTICES.md", async () => {
  const packageJson = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  assert.ok(packageJson.files.includes("THIRD_PARTY_NOTICES.md"));
  assert.ok(
    PACK_ARTIFACT_REQUIRED_PATHS.includes("THIRD_PARTY_NOTICES.md"),
    "check:pack-artifact must fail when the distributed notices are absent"
  );

  const projectRoot = mkdtempSync(join(tmpdir(), "tls-client-notices-project-"));
  const outDir = mkdtempSync(join(tmpdir(), "tls-client-notices-standalone-"));
  try {
    const expected = "legal-notice-sentinel\n";
    writeFileSync(join(projectRoot, "THIRD_PARTY_NOTICES.md"), expected);
    await syncStandaloneExtraModules(projectRoot, undefined, { log() {} }, outDir);
    assert.equal(readFileSync(join(outDir, "THIRD_PARTY_NOTICES.md"), "utf8"), expected);
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
    rmSync(outDir, { recursive: true, force: true });
  }

  const dockerfile = readFileSync(join(ROOT, "Dockerfile"), "utf8");
  assert.match(
    dockerfile,
    /COPY --from=builder \/app\/\.build\/next\/standalone \.\//,
    "Docker runner must consume the standalone tree that carries THIRD_PARTY_NOTICES.md"
  );
});
