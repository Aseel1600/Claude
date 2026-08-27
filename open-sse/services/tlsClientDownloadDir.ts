import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveDataDir } from "@/lib/dataPaths";
import tlsClientNativeManifest from "../config/tlsClientNativeManifest.json";

type TlsClientNativeAsset = {
  file: string;
  sha256: string;
};

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

const TLS_CLIENT_NATIVE_ASSETS = tlsClientNativeManifest.assets as Record<
  string,
  TlsClientNativeAsset
>;

async function fileMatchesSha256(filePath: string, expectedSha256: string): Promise<boolean> {
  try {
    const bytes = await readFile(filePath);
    return createHash("sha256").update(bytes).digest("hex") === expectedSha256;
  } catch {
    return false;
  }
}

/**
 * Writable cache directory for tls-client-node's native binary.
 *
 * Without an explicit `downloadDir`, the library defaults to its own package
 * `node_modules/tls-client-node/bin`, which is root-owned on global installs
 * and fails with EACCES for normal users (#8579).
 */
export function resolveTlsClientDownloadDir(): string {
  return join(resolveDataDir(), "tls-client", "bin");
}

/**
 * Materialize only the pinned bogdanfinn/tls-client native library after its
 * GitHub-published SHA-256 has been verified. Passing the resulting path to
 * tls-client-node prevents its unchecked runtime downloader from running.
 */
export async function resolveVerifiedTlsClientNativeLibrary({
  platform = process.platform,
  arch = process.arch,
  asset,
  downloadDir = resolveTlsClientDownloadDir(),
  fetchImpl = globalThis.fetch,
}: {
  platform?: NodeJS.Platform;
  arch?: string;
  asset?: TlsClientNativeAsset;
  downloadDir?: string;
  fetchImpl?: FetchLike;
} = {}): Promise<string> {
  const expectedAsset = asset ?? TLS_CLIENT_NATIVE_ASSETS[`${platform}-${arch}`];
  if (!expectedAsset) {
    throw new Error(`Unsupported platform for tls-client native asset: ${platform}/${arch}`);
  }

  const destinationPath = join(downloadDir, expectedAsset.file);
  if (await fileMatchesSha256(destinationPath, expectedAsset.sha256)) {
    return destinationPath;
  }

  const assetUrl =
    `https://github.com/bogdanfinn/tls-client/releases/download/v${tlsClientNativeManifest.version}/` +
    expectedAsset.file;
  const response = await fetchImpl(assetUrl, {
    redirect: "follow",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(
      `Failed to download pinned tls-client v${tlsClientNativeManifest.version} native asset: ` +
        `${response.status} ${response.statusText}`
    );
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  const actualSha256 = createHash("sha256").update(bytes).digest("hex");
  if (actualSha256 !== expectedAsset.sha256) {
    throw new Error(
      `SHA-256 mismatch for tls-client v${tlsClientNativeManifest.version} native asset ` +
        `${expectedAsset.file}: ` +
        `expected ${expectedAsset.sha256}, received ${actualSha256}`
    );
  }

  await mkdir(downloadDir, { recursive: true });
  const temporaryPath = join(
    downloadDir,
    `.${expectedAsset.file}.${process.pid}.${randomUUID()}.tmp`
  );
  try {
    await writeFile(temporaryPath, bytes, { mode: 0o755 });
    if (!(await fileMatchesSha256(temporaryPath, expectedAsset.sha256))) {
      throw new Error(`SHA-256 mismatch after writing ${expectedAsset.file}`);
    }

    await rm(destinationPath, { force: true });
    try {
      await rename(temporaryPath, destinationPath);
    } catch (err) {
      // A concurrent process may have installed the same verified asset first.
      if (!(await fileMatchesSha256(destinationPath, expectedAsset.sha256))) throw err;
    }
    if (!(await fileMatchesSha256(destinationPath, expectedAsset.sha256))) {
      await rm(destinationPath, { force: true });
      throw new Error(`SHA-256 mismatch after installing ${expectedAsset.file}`);
    }
    return destinationPath;
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

export function buildNativeTlsClientOptions(nativeLibraryPath?: string): {
  runtimeMode: "native";
  version: string;
  downloadDir: string;
  nativeLibraryPath?: string;
} {
  return {
    runtimeMode: "native",
    version: tlsClientNativeManifest.version,
    downloadDir: resolveTlsClientDownloadDir(),
    ...(nativeLibraryPath ? { nativeLibraryPath } : {}),
  };
}
