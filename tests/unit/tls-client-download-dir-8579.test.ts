import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");

const TLS_CLIENT_WRAPPERS = [
  "open-sse/services/chatgptTlsClient.ts",
  "open-sse/services/claudeTlsClient.ts",
  "open-sse/services/grokTlsClient.ts",
  "open-sse/services/perplexityTlsClient.ts",
  "open-sse/services/lmarenaTlsClient.ts",
  "open-sse/services/notionTlsClient.ts",
] as const;

const originalDataDir = process.env.DATA_DIR;

afterEach(() => {
  if (originalDataDir === undefined) {
    delete process.env.DATA_DIR;
  } else {
    process.env.DATA_DIR = originalDataDir;
  }
});

test("resolveTlsClientDownloadDir caches native binary under DATA_DIR/tls-client/bin (#8579)", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "omniroute-tls-client-8579-"));
  process.env.DATA_DIR = dataDir;

  const { resolveTlsClientDownloadDir } =
    await import("../../open-sse/services/tlsClientDownloadDir.ts");

  assert.equal(resolveTlsClientDownloadDir(), join(dataDir, "tls-client", "bin"));
});

test("buildNativeTlsClientOptions pins v1.15.1 and passes downloadDir to tls-client-node", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "omniroute-tls-client-opts-8579-"));
  process.env.DATA_DIR = dataDir;

  const { buildNativeTlsClientOptions } =
    await import("../../open-sse/services/tlsClientDownloadDir.ts");

  const options = buildNativeTlsClientOptions();

  assert.equal(options.runtimeMode, "native");
  assert.equal(options.version, "1.15.1");
  assert.equal(options.downloadDir, join(dataDir, "tls-client", "bin"));
});

test("runtime downloader verifies v1.15.1 before exposing nativeLibraryPath", async () => {
  const downloadDir = mkdtempSync(join(tmpdir(), "omniroute-tls-client-verified-"));
  try {
    const bytes = Buffer.from("verified-runtime-binary");
    const asset = {
      file: "tls-client-linux-ubuntu-amd64-1.15.1.so",
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
    const requestedUrls: string[] = [];
    const { resolveVerifiedTlsClientNativeLibrary } =
      await import("../../open-sse/services/tlsClientDownloadDir.ts");

    const libraryPath = await resolveVerifiedTlsClientNativeLibrary({
      asset,
      downloadDir,
      fetchImpl: async (url: string | URL) => {
        requestedUrls.push(String(url));
        return new Response(bytes, { status: 200 });
      },
    });

    assert.deepEqual(requestedUrls, [
      `https://github.com/bogdanfinn/tls-client/releases/download/v1.15.1/${asset.file}`,
    ]);
    assert.equal(libraryPath, join(downloadDir, asset.file));
    assert.deepEqual(readFileSync(libraryPath), bytes);
  } finally {
    rmSync(downloadDir, { recursive: true, force: true });
  }
});

test("runtime downloader rejects bytes that do not match the official digest", async () => {
  const downloadDir = mkdtempSync(join(tmpdir(), "omniroute-tls-client-rejected-"));
  try {
    const asset = {
      file: "tls-client-linux-ubuntu-amd64-1.15.1.so",
      sha256: createHash("sha256").update("expected").digest("hex"),
    };
    const { resolveVerifiedTlsClientNativeLibrary } =
      await import("../../open-sse/services/tlsClientDownloadDir.ts");

    await assert.rejects(
      resolveVerifiedTlsClientNativeLibrary({
        asset,
        downloadDir,
        fetchImpl: async () => new Response("tampered", { status: 200 }),
      }),
      /SHA-256 mismatch for tls-client v1\.15\.1/
    );
    assert.equal(existsSync(join(downloadDir, asset.file)), false);
  } finally {
    rmSync(downloadDir, { recursive: true, force: true });
  }
});

test("all web-provider tls clients wire downloadDir through buildNativeTlsClientOptions (#8579)", () => {
  const base = readFileSync(join(ROOT, "open-sse/services/tlsClientBase.ts"), "utf8");
  assert.match(
    base,
    /resolveVerifiedTlsClientNativeLibrary\(\)/,
    "tlsClientBase.ts must verify the pinned native library before TLSClient loads it"
  );
  assert.match(
    base,
    /buildNativeTlsClientOptions\(nativeLibraryPath\)/,
    "tlsClientBase.ts must pass the verified nativeLibraryPath to TLSClient"
  );
  assert.doesNotMatch(
    base,
    /new TLSClient\(\{\s*runtimeMode:\s*"native"\s*\}\)/,
    "tlsClientBase.ts must not construct TLSClient without downloadDir"
  );

  for (const relPath of TLS_CLIENT_WRAPPERS) {
    const source = readFileSync(join(ROOT, relPath), "utf8");
    assert.match(
      source,
      /createTlsClientModule\(/,
      `${relPath} must go through createTlsClientModule so downloadDir is inherited`
    );
    assert.doesNotMatch(
      source,
      /new TLSClient\(\{\s*runtimeMode:\s*"native"\s*\}\)/,
      `${relPath} must not construct TLSClient without downloadDir`
    );
  }
});
