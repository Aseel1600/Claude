// Browser-safe replacement for node:net's `isIP`. Returns 4 for a valid IPv4
// literal, 6 for a valid IPv6 literal, and 0 otherwise — matching node's
// contract exactly. This module is imported (via providerRegistry.ts ->
// providerModels.ts -> src/shared/constants/models.ts) by client entrypoints
// such as ProviderDetailPageClient.tsx, so it must not pull in `node:net`,
// which does not exist in a browser bundle (esbuild "Could not resolve
// node:net"). Keeping a local pure-JS implementation lets the same guard run
// unchanged on the server AND survive client bundling.
function isIP(host: string): 0 | 4 | 6 {
  if (isIPv4(host)) return 4;
  if (isIPv6(host)) return 6;
  return 0;
}

function isIPv4(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4) return false;
  for (const part of parts) {
    // No empty segments, digits only, no leading '+'/'-'/whitespace, <= 255,
    // and (matching node) no leading zeros like "01".
    if (!/^\d{1,3}$/.test(part)) return false;
    if (part.length > 1 && part[0] === "0") return false;
    if (Number(part) > 255) return false;
  }
  return true;
}

function isIPv6(host: string): boolean {
  // Reject anything with characters outside the IPv6 alphabet up front.
  if (!/^[0-9a-fA-F:.]+$/.test(host)) return false;

  // Split off an optional embedded IPv4 tail (e.g. "::ffff:192.168.0.1"). The
  // tail must be a full valid dotted-quad and occupies two 16-bit groups. We
  // replace the dotted-quad with a single synthetic hextet ("0") so the colon
  // structure (including a "::" immediately before the tail, as in
  // "::1.2.3.4") stays intact for the compression logic below, and account for
  // the SECOND group it represents via v4Extra.
  let head = host;
  let v4Extra = 0;
  if (host.includes(".")) {
    const lastColon = host.lastIndexOf(":");
    if (lastColon < 0) return false;
    const tail = host.slice(lastColon + 1);
    if (!isIPv4(tail)) return false;
    head = host.slice(0, lastColon + 1) + "0"; // keep the separator, one synthetic group
    v4Extra = 1; // the dotted-quad is two groups; the synthetic "0" counts as one, this is the other
  }

  const isHextet = (s: string): boolean => /^[0-9a-fA-F]{1,4}$/.test(s);

  // At most one "::" compression marker. Split the address into the part before
  // and after it. Each part is a (possibly empty) colon-separated hextet list
  // that must NOT itself contain any empty token (which would mean a stray
  // ":::" or a lone boundary ":").
  const parts = head.split("::");
  if (parts.length > 2) return false;

  const parseSide = (side: string): number | null => {
    if (side.length === 0) return 0; // empty side of a "::" contributes no groups
    const groups = side.split(":");
    for (const g of groups) {
      if (!isHextet(g)) return null; // empty or malformed token -> invalid
    }
    return groups.length;
  };

  if (parts.length === 2) {
    // Compressed form "<left>::<right>".
    const left = parseSide(parts[0]);
    const right = parseSide(parts[1]);
    if (left === null || right === null) return false;
    // "::" must stand for at least one zero group, so the explicit groups
    // (both sides plus the extra embedded-IPv4 group) must total at most 7.
    return left + right + v4Extra <= 7;
  }

  // Uncompressed form: exactly 8 groups (the embedded IPv4 adds one extra
  // group beyond its synthetic hextet).
  const only = parseSide(head);
  if (only === null) return false;
  return only + v4Extra === 8;
}

export const PROVIDER_URL_BLOCKED_MESSAGE = "Blocked private or local provider URL";
export const CLOUD_METADATA_BLOCKED_MESSAGE = "Blocked cloud-metadata endpoint";

// "block-metadata": allow private/LAN hosts but still reject cloud-metadata / link-local
// endpoints (the SSRF→IAM-credential pivot). Used by the provider-validation path under the
// local-first default; never relaxes the metadata block.
export type OutboundUrlGuardMode = "none" | "public-only" | "block-metadata";
export type OutboundUrlGuardErrorCode = "OUTBOUND_URL_GUARD_BLOCKED" | "OUTBOUND_URL_INVALID";

type OutboundUrlGuardErrorInit = {
  code: OutboundUrlGuardErrorCode;
  url: string;
  hostname?: string | null;
};

export class OutboundUrlGuardError extends Error {
  code: OutboundUrlGuardErrorCode;
  url: string;
  hostname?: string | null;

  constructor(message: string, init: OutboundUrlGuardErrorInit) {
    super(message);
    this.name = "OutboundUrlGuardError";
    this.code = init.code;
    this.url = init.url;
    this.hostname = init.hostname ?? null;
  }
}

function normalizeHost(hostname: string) {
  const normalized = hostname.trim().toLowerCase();
  if (normalized.startsWith("[") && normalized.endsWith("]")) {
    return normalized.slice(1, -1);
  }
  return normalized;
}

export function isPrivateHost(hostname: string) {
  const normalized = normalizeHost(hostname);
  if (!normalized) return true;

  if (
    normalized === "localhost" ||
    normalized === "0.0.0.0" ||
    // `::` is the IPv6 twin of `0.0.0.0`: connecting to it reaches a service bound
    // to the IPv6 loopback, so it has to be refused alongside its IPv4 spelling.
    normalized === "::" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    // `.internal` is reserved for private use (ICANN-style) and is the
    // hostname suffix used by GCP/Azure metadata probes
    // (e.g. `metadata.google.internal`).
    normalized.endsWith(".internal") ||
    normalized.startsWith("::ffff:")
  ) {
    return true;
  }

  if (isIP(normalized) === 4) {
    const octets = normalized.split(".").map((segment) => parseInt(segment, 10));
    const [a, b] = octets;

    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }

  if (isIP(normalized) === 6) {
    return (
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe80:")
    );
  }

  return false;
}

// WHATWG URL serialises an IPv4-mapped IPv6 address as hextets, so
// `http://[::ffff:169.254.169.254]/` reaches these helpers as `::ffff:a9fe:a9fe`.
// Matching the dotted spelling alone therefore misses every mapped address that
// arrives through a parsed URL. Fold the embedded IPv4 back out before deciding.
function mappedIpv4Host(hostname: string): string | null {
  const normalized = normalizeHost(hostname);
  if (!normalized.startsWith("::ffff:")) return null;
  const embedded = normalized.slice("::ffff:".length);
  if (isIP(embedded) === 4) return embedded;
  const hextets = embedded.split(":");
  if (hextets.length !== 2) return null;
  const [high, low] = hextets.map((part) =>
    /^[0-9a-f]{1,4}$/.test(part) ? parseInt(part, 16) : Number.NaN
  );
  if (Number.isNaN(high) || Number.isNaN(low)) return null;
  return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
}

const CLOUD_METADATA_HOSTNAMES = new Set([
  "169.254.169.254", // AWS / GCP / Azure / Oracle IMDS
  "metadata.google.internal", // GCP
  "metadata.goog", // GCP
  "100.100.100.200", // Alibaba Cloud
  "fd00:ec2::254", // AWS IPv6 IMDS
]);

function isCloudMetadataIpv4(host: string): boolean {
  if (CLOUD_METADATA_HOSTNAMES.has(host)) return true;
  return host.startsWith("169.254."); // IPv4 link-local /16
}

/**
 * Cloud-metadata and IPv4 link-local (169.254.0.0/16) endpoints are the classic
 * SSRF→IAM-credential pivot and have no legitimate webhook/automation use case. They are
 * blocked UNCONDITIONALLY — even when private targets are explicitly opted in. (#3269)
 */
export function isCloudMetadataHost(hostname: string): boolean {
  const host = normalizeHost(hostname);
  if (!host) return false;
  if (isCloudMetadataIpv4(host)) return true;
  // An IPv4-mapped IPv6 literal routes to the embedded IPv4 address, so the same
  // verdict has to apply to it — otherwise this block is spelling-sensitive.
  const mapped = mappedIpv4Host(host);
  return mapped !== null && isCloudMetadataIpv4(mapped);
}

export function parseOutboundUrl(input: string | URL) {
  let url: URL;
  try {
    url = input instanceof URL ? input : new URL(String(input));
  } catch {
    throw new OutboundUrlGuardError(`Invalid outbound URL: ${String(input)}`, {
      code: "OUTBOUND_URL_INVALID",
      url: String(input),
    });
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new OutboundUrlGuardError(`Invalid outbound URL protocol for ${url.toString()}`, {
      code: "OUTBOUND_URL_INVALID",
      url: url.toString(),
      hostname: url.hostname || null,
    });
  }

  if (url.username || url.password) {
    throw new OutboundUrlGuardError("Blocked outbound URL with embedded credentials", {
      code: "OUTBOUND_URL_GUARD_BLOCKED",
      url: url.toString(),
      hostname: url.hostname || null,
    });
  }

  return url;
}

export function parseAndValidatePublicUrl(input: string | URL) {
  const url = parseOutboundUrl(input);

  if (isPrivateHost(url.hostname)) {
    throw new OutboundUrlGuardError(PROVIDER_URL_BLOCKED_MESSAGE, {
      code: "OUTBOUND_URL_GUARD_BLOCKED",
      url: url.toString(),
      hostname: url.hostname || null,
    });
  }

  return url;
}

/**
 * #5066: provider-validation variant. Allows private/LAN hosts (so a local OpenAI-compatible
 * provider at 127.0.0.1 validates) but ALWAYS rejects cloud-metadata / link-local endpoints —
 * the classic SSRF→IAM-credential pivot, which is never a legitimate provider endpoint.
 * Protocol and embedded-credential checks from {@link parseOutboundUrl} still apply.
 */
export function parseAndValidateNonMetadataUrl(input: string | URL) {
  const url = parseOutboundUrl(input);

  if (isCloudMetadataHost(url.hostname)) {
    throw new OutboundUrlGuardError(CLOUD_METADATA_BLOCKED_MESSAGE, {
      code: "OUTBOUND_URL_GUARD_BLOCKED",
      url: url.toString(),
      hostname: url.hostname || null,
    });
  }

  return url;
}

// NOTE (#7682): `arePrivateProviderUrlsAllowed`, `areLocalProviderUrlsAllowed`,
// `getProviderOutboundGuard`, `getProviderValidationGuard`, and `parseAndValidateWebhookUrl`
// live in the sibling `./outboundUrlGuardPolicy.ts` module, NOT here. Those helpers need
// `@/shared/utils/featureFlags` (which transitively pulls in the DB layer), and this file is
// loaded by the packaged CLI (`omniroute setup-opencode` → cli-helper/config-generator/
// opencode.ts) where no `tsconfig.json` is present to resolve the `@/*` path alias. Keeping
// this module free of ANY `@/`-aliased import is what makes it safe to load from the CLI.
// Do not add a `@/`-aliased import here — see docs/security/… (packaging) and #7682.
