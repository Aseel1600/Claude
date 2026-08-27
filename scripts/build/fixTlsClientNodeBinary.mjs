#!/usr/bin/env node

/**
 * tls-client-node postinstall repair (#7802).
 *
 * tls-client-node's own postinstall.js fetches a platform-specific native
 * binary (.so/.dylib/.dll) from the bogdanfinn/tls-client GitHub Releases
 * API. That script is blocked by `npm ci --ignore-scripts` (the Dockerfile
 * builder stage runs with scripts disabled for supply-chain hygiene) and,
 * even when it does run, silently no-ops on a rate-limited/failed GitHub API
 * call instead of raising — so `node_modules/tls-client-node/bin/` can end
 * up empty with no visible signal until the first live request throws
 * TlsClientUnavailableError (chatgpt-web/claude-web/perplexity-web/grok-web/
 * notion-web/lmarena all share this transport).
 *
 * This module:
 *   1. Accepts only bogdanfinn/tls-client v1.15.1 assets whose SHA-256 matches
 *      the digest published by GitHub for the tagged release.
 *   2. Copies the verified root asset into the standalone
 *      `dist/node_modules/tls-client-node/bin/` bundle (same pattern as
 *      fixWreqJsBinary), so the published npm package works even though its
 *      own `files` allowlist never ships the binary.
 *   3. When that verified asset is absent, invokes the module's postinstall
 *      with TLS_CLIENT_VERSION pinned and retries with exponential backoff.
 *
 * Normal npm postinstall remains best-effort and warns on failure. Docker and
 * release callers use --strict, which fails closed instead of shipping an
 * absent or unverified binary.
 */

import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_RETRY_DELAYS_MS = [1_000, 3_000, 8_000];
const NATIVE_MANIFEST = JSON.parse(
  readFileSync(
    new URL("../../open-sse/config/tlsClientNativeManifest.json", import.meta.url),
    "utf8"
  )
);

export const TLS_CLIENT_NATIVE_VERSION = NATIVE_MANIFEST.version;
export const TLS_CLIENT_NATIVE_ASSETS = NATIVE_MANIFEST.assets;

/** @typedef {{ file: string; sha256: string }} NativeAsset */

/**
 * Resolve the exact native asset supported by tls-client-node@0.2.0.
 *
 * @param {NodeJS.Platform} [platform]
 * @param {string} [arch]
 * @returns {NativeAsset}
 */
export function resolveTlsClientNativeAsset(platform = process.platform, arch = process.arch) {
  const asset = TLS_CLIENT_NATIVE_ASSETS[`${platform}-${arch}`];
  if (!asset) {
    throw new Error(`Unsupported platform for tls-client-node native asset: ${platform}/${arch}`);
  }
  return asset;
}

function sha256File(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

/** @param {string} filePath @param {NativeAsset} asset */
function isVerifiedBinary(filePath, asset) {
  if (!existsSync(filePath)) return false;
  try {
    return sha256File(filePath) === asset.sha256;
  } catch {
    return false;
  }
}

function removeIfPresent(filePath) {
  if (existsSync(filePath)) unlinkSync(filePath);
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Re-run tls-client-node's own postinstall.js in-process, retrying with
 * backoff when the attempt leaves `bin/` empty (covers transient GitHub API
 * rate-limiting — the upstream script itself never throws on failure, it
 * only warns, so "still empty after running it" is the only failure signal
 * available).
 */
async function downloadWithRetry(rootTlsClientDir, asset, version, retryDelaysMs, log) {
  const postinstallScript = join(rootTlsClientDir, "scripts", "postinstall.js");
  const binDir = join(rootTlsClientDir, "bin");
  const binaryPath = join(binDir, asset.file);
  if (!existsSync(postinstallScript)) return false;

  if (existsSync(binaryPath) && !isVerifiedBinary(binaryPath, asset)) {
    removeIfPresent(binaryPath);
    log(`  ⚠️  Removed tls-client-node binary with an invalid SHA-256: ${asset.file}`);
  }

  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt++) {
    if (attempt > 0) {
      log(
        `  ⏳ tls-client-node native binary still missing — retrying download ` +
          `(attempt ${attempt + 1}/${retryDelaysMs.length + 1}) after rate-limit/backoff...`
      );
      await sleep(retryDelaysMs[attempt - 1]);
    }

    try {
      const { execFileSync } = await import("node:child_process");
      execFileSync(process.execPath, [postinstallScript], {
        cwd: rootTlsClientDir,
        env: {
          ...process.env,
          TLS_CLIENT_SKIP_DOWNLOAD: "0",
          TLS_CLIENT_VERSION: version,
        },
        stdio: "pipe",
        timeout: 30_000,
      });
    } catch (err) {
      log(`  ⚠️  tls-client-node postinstall attempt failed: ${err.message.split("\n")[0]}`);
    }

    if (isVerifiedBinary(binaryPath, asset)) return true;
    if (existsSync(binaryPath)) {
      removeIfPresent(binaryPath);
      log(`  ⚠️  Rejected tls-client-node binary with an invalid SHA-256: ${asset.file}`);
    }
  }

  return false;
}

/**
 * @param {object} opts
 * @param {string} opts.rootDir - repo root
 * @param {(msg: string) => void} [opts.log]
 * @param {number[]} [opts.retryDelaysMs] - override for tests (avoid real sleeps)
 * @param {NativeAsset} [opts.asset] - injected only for deterministic tests
 * @param {boolean} [opts.strict] - fail instead of warning (Docker/release builds)
 */
export async function fixTlsClientNodeBinary({
  rootDir,
  log = (m) => console.log(m),
  retryDelaysMs = DEFAULT_RETRY_DELAYS_MS,
  asset,
  strict = false,
} = {}) {
  const version = TLS_CLIENT_NATIVE_VERSION;
  const rootTlsClientDir = join(rootDir, "node_modules", "tls-client-node");
  const rootBinDir = join(rootTlsClientDir, "bin");
  const distTlsClientDir = join(rootDir, "dist", "node_modules", "tls-client-node");

  if (!existsSync(rootTlsClientDir)) {
    if (strict) throw new Error("tls-client-node is not installed; cannot verify native binary");
    return;
  }

  let expectedAsset = asset;
  try {
    expectedAsset ??= resolveTlsClientNativeAsset();
  } catch (err) {
    if (strict) throw err;
    console.warn(`  ⚠️  ${err.message}`);
    return;
  }

  const rootBinaryPath = join(rootBinDir, expectedAsset.file);

  if (!isVerifiedBinary(rootBinaryPath, expectedAsset)) {
    log(
      `\n  🔧 tls-client-node native binary missing or unverified — fetching pinned ` +
        `v${version} and checking SHA-256...\n`
    );
    const recovered = await downloadWithRetry(
      rootTlsClientDir,
      expectedAsset,
      version,
      retryDelaysMs,
      log
    );
    if (!recovered) {
      const message =
        `Could not fetch tls-client-node v${version} verified native binary ` +
        `(${expectedAsset.file}) after retries.`;
      if (strict) throw new Error(message);
      console.warn(`\n  ⚠️  ${message} GitHub may be rate-limited or unreachable.`);
      console.warn(
        "     chatgpt-web/claude-web/perplexity-web/grok-web/notion-web/lmarena will " +
          "raise a clear TlsClientUnavailableError on first use until this is resolved."
      );
      console.warn(
        `     Verified repair: node ${join(rootDir, "scripts", "build", "fixTlsClientNodeBinary.mjs")} --strict\n`
      );
      return;
    }
    log("  ✅ tls-client-node native binary fetched successfully!\n");
  }

  if (!existsSync(distTlsClientDir) || !isVerifiedBinary(rootBinaryPath, expectedAsset)) return;

  const distBinDir = join(distTlsClientDir, "bin");
  const distBinaryPath = join(distBinDir, expectedAsset.file);
  if (isVerifiedBinary(distBinaryPath, expectedAsset)) return;

  try {
    removeIfPresent(distBinaryPath);
    mkdirSync(distBinDir, { recursive: true });
    copyFileSync(rootBinaryPath, distBinaryPath);
    if (!isVerifiedBinary(distBinaryPath, expectedAsset)) {
      removeIfPresent(distBinaryPath);
      throw new Error(`SHA-256 mismatch after copying ${expectedAsset.file}`);
    }
    log(
      `  ✅ Verified tls-client-node v${version} native binary copied to standalone ` +
        "dist/node_modules.\n"
    );
  } catch (err) {
    if (strict) throw err;
    console.warn(`  ⚠️  Could not copy tls-client-node binary into dist/: ${err.message}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await fixTlsClientNodeBinary({
      rootDir: process.cwd(),
      strict: process.argv.includes("--strict"),
    });
  } catch (err) {
    console.error(`  ❌ ${err.message}`);
    process.exitCode = 1;
  }
}
