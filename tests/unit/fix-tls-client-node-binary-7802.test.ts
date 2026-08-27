import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fixTlsClientNodeBinary } from "../../scripts/build/fixTlsClientNodeBinary.mjs";

const ROOT = join(import.meta.dirname, "..", "..");

test("native manifest pins v1.15.1 to GitHub's official digests on every supported platform", () => {
  const manifest = JSON.parse(
    readFileSync(join(ROOT, "open-sse", "config", "tlsClientNativeManifest.json"), "utf8")
  );

  assert.equal(manifest.version, "1.15.1");
  assert.equal(manifest.source, "https://github.com/bogdanfinn/tls-client/releases/tag/v1.15.1");
  assert.deepEqual(manifest.assets, {
    "darwin-arm64": {
      file: "tls-client-darwin-arm64-1.15.1.dylib",
      sha256: "b36167372a93337195b84a8b8e7ed2e63ba654b7bbe3e35cd4f96ad3196458e6",
    },
    "darwin-x64": {
      file: "tls-client-darwin-amd64-1.15.1.dylib",
      sha256: "7cb2c6833dc2b7e4b59bf46798f0e214bac746143e36bf9cd5ec92fde6ec8465",
    },
    "linux-arm64": {
      file: "tls-client-linux-arm64-1.15.1.so",
      sha256: "048b75c4fb0898a306228198d545eece39a7d5348200487f0395fbdc4168fe39",
    },
    "linux-x64": {
      file: "tls-client-linux-ubuntu-amd64-1.15.1.so",
      sha256: "e393e866060e238bc36509f853293cebf5af8286aede59814462693efb603b1e",
    },
    "win32-ia32": {
      file: "tls-client-windows-32-1.15.1.dll",
      sha256: "46f44779f41c74918a6d1d0ecadc090aa8bd5303e07ca8dd3a0b999467b76a42",
    },
    "win32-x64": {
      file: "tls-client-windows-64-1.15.1.dll",
      sha256: "414b5e5c60f9200948a46afd023865ad00c7d37403056a7e74ceee27ce2b0287",
    },
  });
});

function makeRoot() {
  return mkdtempSync(join(tmpdir(), "fix-tls-client-node-binary-7802-"));
}

function collectLogs() {
  const logs: string[] = [];
  return { logs, log: (m: string) => logs.push(m) };
}

test("replaces a tampered binary with the pinned version and copies only verified bytes", async () => {
  const rootDir = makeRoot();
  try {
    const goodBytes = "verified-native-binary";
    const asset = {
      file: "tls-client-linux-ubuntu-amd64-1.15.1.so",
      sha256: createHash("sha256").update(goodBytes).digest("hex"),
    };
    const tlsClientDir = join(rootDir, "node_modules", "tls-client-node");
    const rootBin = join(tlsClientDir, "bin");
    const scriptsDir = join(tlsClientDir, "scripts");
    mkdirSync(rootBin, { recursive: true });
    mkdirSync(scriptsDir, { recursive: true });
    writeFileSync(join(rootBin, asset.file), "tampered");
    writeFileSync(
      join(scriptsDir, "postinstall.js"),
      `const fs = require("fs");
       const path = require("path");
       if (process.env.TLS_CLIENT_VERSION !== "1.15.1") process.exit(9);
       fs.writeFileSync(path.join(__dirname, "..", ".observed-version"), process.env.TLS_CLIENT_VERSION);
       fs.writeFileSync(path.join(__dirname, "..", "bin", ${JSON.stringify(asset.file)}), ${JSON.stringify(goodBytes)});`
    );
    mkdirSync(join(rootDir, "dist", "node_modules", "tls-client-node"), { recursive: true });

    await fixTlsClientNodeBinary({
      rootDir,
      asset,
      strict: true,
      retryDelaysMs: [],
      log() {},
    });

    assert.equal(readFileSync(join(tlsClientDir, ".observed-version"), "utf8"), "1.15.1");
    assert.equal(
      readFileSync(
        join(rootDir, "dist", "node_modules", "tls-client-node", "bin", asset.file),
        "utf8"
      ),
      goodBytes
    );
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("no-ops when node_modules/tls-client-node is absent (module not installed)", async () => {
  const rootDir = makeRoot();
  try {
    const { logs, log } = collectLogs();
    await fixTlsClientNodeBinary({ rootDir, log });
    assert.deepEqual(logs, []);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("copies an already-populated root bin/ into the standalone dist bundle (#7802 item 2)", async () => {
  const rootDir = makeRoot();
  try {
    const binary = "fake-binary";
    const asset = {
      file: "tls-client-linux-ubuntu-amd64-1.15.1.so",
      sha256: createHash("sha256").update(binary).digest("hex"),
    };
    const rootBin = join(rootDir, "node_modules", "tls-client-node", "bin");
    mkdirSync(rootBin, { recursive: true });
    writeFileSync(join(rootBin, asset.file), binary);

    const distTlsClientDir = join(rootDir, "dist", "node_modules", "tls-client-node");
    mkdirSync(distTlsClientDir, { recursive: true });

    const { log } = collectLogs();
    await fixTlsClientNodeBinary({ rootDir, asset, log });

    const distBin = join(distTlsClientDir, "bin");
    assert.ok(existsSync(distBin), "dist bin/ should have been created");
    assert.deepEqual(readdirSync(distBin), [asset.file]);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("retries the download when root bin/ is empty, and stops once a file appears (#7802 item 3)", async () => {
  const rootDir = makeRoot();
  try {
    const binary = "ok";
    const asset = {
      file: "tls-client-linux-ubuntu-amd64-1.15.1.so",
      sha256: createHash("sha256").update(binary).digest("hex"),
    };
    const tlsClientDir = join(rootDir, "node_modules", "tls-client-node");
    const rootBin = join(tlsClientDir, "bin");
    mkdirSync(rootBin, { recursive: true });

    const scriptsDir = join(tlsClientDir, "scripts");
    mkdirSync(scriptsDir, { recursive: true });
    // A postinstall.js stand-in that drops a file into bin/ on its 2nd invocation —
    // simulating a first attempt eaten by a GitHub rate-limit and a 2nd that recovers.
    writeFileSync(
      join(scriptsDir, "postinstall.js"),
      `const fs = require("fs");
       const path = require("path");
       const marker = path.join(__dirname, "..", ".attempts");
       const attempts = fs.existsSync(marker) ? Number(fs.readFileSync(marker, "utf8")) : 0;
       fs.writeFileSync(marker, String(attempts + 1));
       if (attempts + 1 >= 2) {
         fs.writeFileSync(path.join(__dirname, "..", "bin", ${JSON.stringify(asset.file)}), ${JSON.stringify(binary)});
       }`
    );

    const { logs, log } = collectLogs();
    await fixTlsClientNodeBinary({ rootDir, asset, log, retryDelaysMs: [1, 1, 1] });

    assert.ok(existsSync(join(rootBin, asset.file)));
    assert.ok(
      logs.some((m) => m.includes("fetched successfully")),
      "expected a success log once the retry recovered"
    );
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("warns without throwing when every retry leaves bin/ empty (still rate-limited)", async () => {
  const rootDir = makeRoot();
  try {
    const tlsClientDir = join(rootDir, "node_modules", "tls-client-node");
    mkdirSync(join(tlsClientDir, "bin"), { recursive: true });
    const scriptsDir = join(tlsClientDir, "scripts");
    mkdirSync(scriptsDir, { recursive: true });
    // A postinstall.js stand-in that always fails to produce a binary (persistent rate-limit).
    writeFileSync(join(scriptsDir, "postinstall.js"), `process.exitCode = 0;`);

    const originalWarn = console.warn;
    const warnings: string[] = [];
    console.warn = (m: string) => warnings.push(m);
    try {
      const { log } = collectLogs();
      await assert.doesNotReject(fixTlsClientNodeBinary({ rootDir, log, retryDelaysMs: [1, 1] }));
    } finally {
      console.warn = originalWarn;
    }

    assert.ok(
      warnings.some((m) => m.includes("Could not fetch tls-client-node")),
      "expected a clear warning pointing at the manual fix, not a silent no-op"
    );
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("strict mode rejects an unverified download instead of shipping it", async () => {
  const rootDir = makeRoot();
  try {
    const asset = {
      file: "tls-client-linux-ubuntu-amd64-1.15.1.so",
      sha256: createHash("sha256").update("expected").digest("hex"),
    };
    const tlsClientDir = join(rootDir, "node_modules", "tls-client-node");
    const scriptsDir = join(tlsClientDir, "scripts");
    mkdirSync(join(tlsClientDir, "bin"), { recursive: true });
    mkdirSync(scriptsDir, { recursive: true });
    writeFileSync(
      join(scriptsDir, "postinstall.js"),
      `require("fs").writeFileSync(require("path").join(__dirname, "..", "bin", ${JSON.stringify(asset.file)}), "tampered");`
    );

    await assert.rejects(
      fixTlsClientNodeBinary({
        rootDir,
        asset,
        strict: true,
        retryDelaysMs: [],
        log() {},
      }),
      /Could not fetch tls-client-node v1\.15\.1 verified native binary/
    );
    assert.equal(existsSync(join(tlsClientDir, "bin", asset.file)), false);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});
