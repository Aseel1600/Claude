/**
 * Stamps the serving instance's own address into the extension package.
 *
 * The VSIX is downloaded FROM an OmniRoute instance, so shipping it with
 * `http://localhost:20128` as the default meant every operator had to discover
 * and retype the address they had just downloaded from. The only thing that
 * genuinely cannot be pre-filled is the API key.
 *
 * Rewriting happens at download time because the packaged extension is a
 * prebuilt artifact: there is no build step here to bake a value into.
 */

import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";

/** Path of the manifest inside a VSIX archive. */
export const VSIX_MANIFEST_PATH = "extension/package.json";

/** Setting holding the OmniRoute base address. */
export const OMNIROUTE_URL_SETTING = "iaone.omniroute.url";

/** Setting holding the OpenAI-compatible endpoint used outside the integration. */
export const BASE_URL_SETTING = "iaone.baseUrl";

type ConfigurationBlock = {
  properties?: Record<string, { default?: unknown }>;
};

type VsixManifest = {
  contributes?: {
    configuration?: ConfigurationBlock | ConfigurationBlock[];
  };
};

/**
 * The address a client should use to reach this instance.
 *
 * Behind the reverse proxy the request URL carries the container's internal
 * host, so the forwarded headers win when present — otherwise the download
 * would hand out an address only reachable from inside Docker.
 */
export function resolveInstanceOrigin(request: Request): string {
  const headers = request.headers;
  const forwardedHost = headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || headers.get("host")?.trim();

  if (!host) return new URL(request.url).origin;

  const forwardedProto = headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const proto = forwardedProto || new URL(request.url).protocol.replace(":", "") || "http";
  return `${proto}://${host}`;
}

/** Every configuration block a manifest declares, whether it used an array or not. */
function configurationBlocks(manifest: VsixManifest): ConfigurationBlock[] {
  const configuration = manifest.contributes?.configuration;
  if (!configuration) return [];
  return Array.isArray(configuration) ? configuration : [configuration];
}

/**
 * Rewrites the manifest defaults so the extension points back at `origin`.
 *
 * Only defaults are touched: a setting the operator has already written into
 * their own `settings.json` always wins over a package default, so reinstalling
 * cannot silently move a working configuration.
 */
export function personalizeManifest(manifestJson: string, origin: string): string {
  const manifest = JSON.parse(manifestJson) as VsixManifest;
  const trimmedOrigin = origin.replace(/\/+$/, "");

  for (const block of configurationBlocks(manifest)) {
    const properties = block.properties;
    if (!properties) continue;
    if (properties[OMNIROUTE_URL_SETTING]) {
      properties[OMNIROUTE_URL_SETTING].default = trimmedOrigin;
    }
    if (properties[BASE_URL_SETTING]) {
      properties[BASE_URL_SETTING].default = `${trimmedOrigin}/v1`;
    }
  }

  return JSON.stringify(manifest, null, 2);
}

/**
 * Returns the VSIX with its manifest defaults pointing at `origin`.
 *
 * Never throws: an archive this code cannot read is served untouched, because
 * a download that works with one manual setting beats a download that 500s.
 */
export function personalizeVsix(archive: Uint8Array, origin: string): Uint8Array {
  try {
    const entries = unzipSync(archive);
    const manifest = entries[VSIX_MANIFEST_PATH];
    if (!manifest) return archive;

    entries[VSIX_MANIFEST_PATH] = strToU8(personalizeManifest(strFromU8(manifest), origin));
    return zipSync(entries);
  } catch {
    return archive;
  }
}
