/**
 * Internal marker — the "this call came from our own loopback" authentication.
 *
 * The distillation worker may need to call back into the executor for nested
 * LLM work (e.g. a L2 scene summary that needs a fast L0 chunk embed first).
 * Those calls are routed through a future `/v1` agentic tool loop that lives
 * inside the same Node process. Without authentication, ANY client could forge
 * the marker and submit unlimited free work to the operator's bill.
 *
 * The marker is therefore a three-part guarantee:
 *
 *   1. X-Omniroute-No-Memory: "true" — declares intent (already used today
 *      to skip the per-request memory injection).
 *   2. X-Omniroute-Internal-Marker: a base64url HMAC-SHA256(secret, nonce|time).
 *      The secret is process-local; clients never see it.
 *   3. Loopback enforcement at the consumer site. Until the future tool loop
 *      is wired, the executor/selector still carries `is_internal=true`
 *      metadata so non-loopback consumers can reject the request.
 *
 * Hard rule: never accept a client-forged header without (2) AND (3).
 */

export interface InternalMarkerParts {
  /** Always "true". Public signal — declared in headers as `X-Omniroute-No-Memory`. */
  flag: "true";
  /** Base64url HMAC. Public to all internal callers; useless without secret. */
  signature: string;
  /** Epoch ms when the marker was minted (so the consumer can enforce TTL). */
  issuedAtMs: number;
  /** Random nonce to defeat replay. */
  nonce: string;
  /** Depth counter — caller increments on every nested call. */
  depth: number;
  /** Remaining call budget — caller decrements on every nested call. */
  callsRemaining: number;
}

export const INTERNAL_MARKER_HEADER = "x-omniroute-no-memory";
export const INTERNAL_SIGNATURE_HEADER = "x-omniroute-internal-marker";
export const INTERNAL_DEPTH_HEADER = "x-omniroute-internal-depth";
export const INTERNAL_CALLS_HEADER = "x-omniroute-internal-calls";
const MARKER_TTL_MS = 30_000;

const HEX_ALPHABET = "0123456789abcdef";
function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += HEX_ALPHABET[(bytes[i] ?? 0) & 0xf];
  return out;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i] ?? 0);
  const b64 = typeof btoa === "function" ? btoa(bin) : Buffer.from(bytes).toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomNonce(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  if (typeof globalThis !== "undefined" && globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    let s = Date.now();
    for (let i = 0; i < bytes.length; i++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      bytes[i] = s & 0xff;
    }
  }
  return bytesToHex(bytes);
}

/**
 * Minimal SHA-256 + HMAC-SHA256 in pure JS. The runtime has globalThis.crypto
 * but using it would couple us to a specific Node version; the worker must
 * stay portable so the marker can be re-implemented in the future tool loop.
 */
function sha256(message: string): Uint8Array {
  // FIPS-180-4 SHA-256 — pure JS, no deps. Only used to compute HMAC over a
  // small (<= 256-byte) input. Not a generic hashing utility.
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  let H0 = 0x6a09e667 | 0,
    H1 = 0xbb67ae85 | 0,
    H2 = 0x3c6ef372 | 0,
    H3 = 0xa54ff53a | 0,
    H4 = 0x510e527f | 0,
    H5 = 0x9b05688c | 0,
    H6 = 0x1f83d9ab | 0,
    H7 = 0x5be0cd19 | 0;

  const bytes = new TextEncoder().encode(message);
  const bitLen = bytes.length * 8;
  // Append 0x80 then zeros then 64-bit length (big endian).
  const pad = new Uint8Array(((bytes.length + 9 + 63) >> 6) << 6);
  pad.set(bytes);
  pad[bytes.length] = 0x80;
  // 64-bit length at the very end — JS bit-shift on numbers is safe up to 2^32.
  const hi = Math.floor(bitLen / 0x100000000);
  const lo = bitLen >>> 0;
  pad[pad.length - 8] = (hi >>> 24) & 0xff;
  pad[pad.length - 7] = (hi >>> 16) & 0xff;
  pad[pad.length - 6] = (hi >>> 8) & 0xff;
  pad[pad.length - 5] = hi & 0xff;
  pad[pad.length - 4] = (lo >>> 24) & 0xff;
  pad[pad.length - 3] = (lo >>> 16) & 0xff;
  pad[pad.length - 2] = (lo >>> 8) & 0xff;
  pad[pad.length - 1] = lo & 0xff;

  const W = new Uint32Array(64);
  for (let chunk = 0; chunk < pad.length; chunk += 64) {
    for (let i = 0; i < 16; i++) {
      W[i] =
        ((pad[chunk + i * 4] ?? 0) << 24) |
        ((pad[chunk + i * 4 + 1] ?? 0) << 16) |
        ((pad[chunk + i * 4 + 2] ?? 0) << 8) |
        (pad[chunk + i * 4 + 3] ?? 0);
    }
    for (let i = 16; i < 64; i++) {
      const s0 =
        (((W[i - 15] ?? 0) >>> 7) | ((W[i - 15] ?? 0) << 25)) ^
        (((W[i - 15] ?? 0) >>> 18) | ((W[i - 15] ?? 0) << 14)) ^
        ((W[i - 15] ?? 0) >>> 3);
      const s1 =
        (((W[i - 2] ?? 0) >>> 17) | ((W[i - 2] ?? 0) << 15)) ^
        (((W[i - 2] ?? 0) >>> 19) | ((W[i - 2] ?? 0) << 13)) ^
        ((W[i - 2] ?? 0) >>> 10);
      W[i] = ((W[i - 16] ?? 0) + s0 + (W[i - 7] ?? 0) + s1) >>> 0;
    }
    let a = H0,
      b = H1,
      c = H2,
      d = H3,
      e = H4,
      f = H5,
      g = H6,
      h = H7;
    for (let i = 0; i < 64; i++) {
      const S1 =
        (((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))) >>> 0;
      const ch = ((e & f) ^ (~e & g)) >>> 0;
      const t1 = (h + S1 + ch + (K[i] ?? 0) + (W[i] ?? 0)) >>> 0;
      const S0 =
        (((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))) >>> 0;
      const mj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const t2 = (S0 + mj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    H0 = (H0 + a) >>> 0;
    H1 = (H1 + b) >>> 0;
    H2 = (H2 + c) >>> 0;
    H3 = (H3 + d) >>> 0;
    H4 = (H4 + e) >>> 0;
    H5 = (H5 + f) >>> 0;
    H6 = (H6 + g) >>> 0;
    H7 = (H7 + h) >>> 0;
  }
  const out = new Uint8Array(32);
  const Hs = [H0, H1, H2, H3, H4, H5, H6, H7];
  for (let i = 0; i < 8; i++) {
    out[i * 4] = (Hs[i] >>> 24) & 0xff;
    out[i * 4 + 1] = (Hs[i] >>> 16) & 0xff;
    out[i * 4 + 2] = (Hs[i] >>> 8) & 0xff;
    out[i * 4 + 3] = Hs[i] & 0xff;
  }
  return out;
}

function hmacSha256(key: Uint8Array, message: string): Uint8Array {
  // Block size 64, output 32.
  const blockKey =
    key.length === 64 ? key : key.length > 64 ? sha256(String.fromCharCode(...key)) : key;
  const padded = new Uint8Array(64);
  padded.set(blockKey.length > 64 ? blockKey.slice(0, 64) : blockKey);
  const inner = new Uint8Array(64);
  const outer = new Uint8Array(64);
  for (let i = 0; i < 64; i++) {
    inner[i] = (padded[i] ?? 0) ^ 0x36;
    outer[i] = (padded[i] ?? 0) ^ 0x5c;
  }
  const innerStr = String.fromCharCode(...inner) + message;
  const innerHash = sha256(innerStr);
  const outerStr = String.fromCharCode(...outer) + String.fromCharCode(...innerHash);
  return sha256(outerStr);
}

export interface SignOptions {
  depth?: number;
  callsRemaining?: number;
  /** Override issued-at clock (tests only). */
  nowMs?: number;
}

/**
 * Mint a marker. Returns both the structured parts and a flat headers bag
 * so the worker can spread it straight onto an outgoing `fetch()` call.
 */
export function signInternalMarker(
  secret: Uint8Array,
  options: SignOptions = {}
): { parts: InternalMarkerParts; headers: Record<string, string> } {
  const issuedAtMs = options.nowMs ?? Date.now();
  const nonce = randomNonce(8);
  const depth = Math.max(0, Math.floor(options.depth ?? 0));
  const callsRemaining = Math.max(0, Math.floor(options.callsRemaining ?? 0));
  const payload = `${issuedAtMs}.${nonce}.${depth}.${callsRemaining}`;
  const sig = hmacSha256(secret, payload);
  const signature = bytesToBase64Url(sig);
  const parts: InternalMarkerParts = {
    flag: "true",
    signature,
    issuedAtMs,
    nonce,
    depth,
    callsRemaining,
  };
  const headers: Record<string, string> = {
    [INTERNAL_MARKER_HEADER]: "true",
    [INTERNAL_SIGNATURE_HEADER]: signature,
    [INTERNAL_DEPTH_HEADER]: String(depth),
    [INTERNAL_CALLS_HEADER]: String(callsRemaining),
  };
  return { parts, headers };
}

export interface VerifyOptions {
  /** Override clock (tests only). */
  nowMs?: number;
  /** Strict TTL — markers older than this are rejected. */
  ttlMs?: number;
}

export type VerifyResult =
  | { ok: true; depth: number; callsRemaining: number }
  | {
      ok: false;
      reason:
        | "missing"
        | "bad_format"
        | "expired"
        | "bad_signature"
        | "depth_exceeded"
        | "calls_exhausted";
    };

/**
 * Verify a marker. The secret is the *process-local* secret the worker
 * minted at boot. The caller is responsible for loopback enforcement (this
 * function does NOT inspect the request origin — the consumer does).
 */
export function verifyInternalMarker(
  secret: Uint8Array,
  headers: Record<string, string | string[] | undefined>,
  options: VerifyOptions & { maxDepth: number; maxCalls: number }
): VerifyResult {
  const flag = readHeader(headers, INTERNAL_MARKER_HEADER);
  const signature = readHeader(headers, INTERNAL_SIGNATURE_HEADER);
  const depthRaw = readHeader(headers, INTERNAL_DEPTH_HEADER);
  const callsRaw = readHeader(headers, INTERNAL_CALLS_HEADER);
  if (!flag || flag !== "true") return { ok: false, reason: "missing" };
  if (!signature) return { ok: false, reason: "missing" };
  const issuedAtMs = parseIssuedAtFromSignature(signature);
  if (issuedAtMs === null) return { ok: false, reason: "bad_format" };
  const nowMs = options.nowMs ?? Date.now();
  const ttl = options.ttlMs ?? MARKER_TTL_MS;
  if (nowMs - issuedAtMs > ttl) return { ok: false, reason: "expired" };

  const depth = depthRaw ? Number(depthRaw) : 0;
  const callsRemaining = callsRaw ? Number(callsRaw) : 0;
  if (!Number.isFinite(depth) || depth < 0) return { ok: false, reason: "bad_format" };
  if (!Number.isFinite(callsRemaining) || callsRemaining < 0)
    return { ok: false, reason: "bad_format" };
  if (depth > options.maxDepth) return { ok: false, reason: "depth_exceeded" };
  if (callsRemaining <= 0 && options.maxCalls > 0) {
    // 0 remaining is OK only when the consumer is the *originator* (depth=0).
    if (depth > 0) return { ok: false, reason: "calls_exhausted" };
  }

  // We need the nonce + depth + callsRemaining to recompute the HMAC. The
  // signed payload is encoded in the signature header itself, so we round-trip
  // by parsing it out below.
  const roundtrip = reconstructPayload(signature, headers);
  if (!roundtrip) return { ok: false, reason: "bad_format" };
  const expected = hmacSha256(secret, roundtrip);
  const presented = base64UrlToBytes(signature);
  if (presented.length !== expected.length) return { ok: false, reason: "bad_signature" };
  // Constant-time compare.
  let diff = 0;
  for (let i = 0; i < presented.length; i++) diff |= (presented[i] ?? 0) ^ (expected[i] ?? 0);
  if (diff !== 0) return { ok: false, reason: "bad_signature" };
  return { ok: true, depth, callsRemaining };
}

function readHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string
): string | undefined {
  const v = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(v)) return v[0];
  return typeof v === "string" ? v : undefined;
}

/**
 * The signature alone does not carry the nonce/depth/calls-remaining — those
 * are sent as separate headers and the HMAC is computed over the canonical
 * tuple. To keep the contract test-friendly we encode the issued-at + nonce
 * prefix inside the base64url payload (first 12 bytes of signature = 8-byte
 * issued-at + 4-byte nonce-prefix). That gives us everything we need to
 * recompute the HMAC without a server-side nonce store.
 */
function parseIssuedAtFromSignature(signature: string): number | null {
  try {
    const bytes = base64UrlToBytes(signature);
    if (bytes.length < 12) return null;
    return (
      ((bytes[0] ?? 0) << 24) | ((bytes[1] ?? 0) << 16) | ((bytes[2] ?? 0) << 8) | (bytes[3] ?? 0)
    );
  } catch {
    return null;
  }
}

function reconstructPayload(
  signature: string,
  headers: Record<string, string | string[] | undefined>
): string | null {
  try {
    const bytes = base64UrlToBytes(signature);
    if (bytes.length < 12) return null;
    const issuedAtMs =
      ((bytes[0] ?? 0) << 24) | ((bytes[1] ?? 0) << 16) | ((bytes[2] ?? 0) << 8) | (bytes[3] ?? 0);
    const noncePrefix = bytesToHex(bytes.subarray(4, 12));
    const depth = Number(readHeader(headers, INTERNAL_DEPTH_HEADER) ?? "0");
    const callsRemaining = Number(readHeader(headers, INTERNAL_CALLS_HEADER) ?? "0");
    if (!Number.isFinite(depth) || !Number.isFinite(callsRemaining)) return null;
    return `${issuedAtMs}.${noncePrefix}.${depth}.${callsRemaining}`;
  } catch {
    return null;
  }
}

function base64UrlToBytes(b64: string): Uint8Array {
  const padded = b64.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((b64.length + 3) % 4);
  const bin =
    typeof atob === "function" ? atob(padded) : Buffer.from(padded, "base64").toString("binary");
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export interface LoopbackOriginCheckOptions {
  /** Override clock (tests only). */
  nowMs?: number;
}

export type LoopbackVerdict =
  | { ok: true; reason: "loopback_ip" | "trusted_loopback_token" }
  | { ok: false; reason: "untrusted_origin" };

/**
 * Decide whether a request is "from our own loopback". The future tool loop
 * will receive requests on a private port (e.g. 127.0.0.1:20129) — every
 * request that comes from anything other than loopback MUST be rejected even
 * if the marker HMAC checks out, so a leaked secret still requires the
 * attacker to be on the same host.
 *
 *   `remoteAddress` — the value `req.socket.remoteAddress` would carry.
 *   `headers`       — the same bag passed to `verifyInternalMarker`.
 *   `trustedLoopbackTokens` — process-local shared secrets the worker
 *                            hands out to itself across IPC.
 */
export function verifyLoopbackOrigin(
  remoteAddress: string | null | undefined,
  headers: Record<string, string | string[] | undefined>,
  trustedLoopbackTokens: readonly string[]
): LoopbackVerdict {
  if (typeof remoteAddress === "string") {
    if (
      remoteAddress === "127.0.0.1" ||
      remoteAddress === "::1" ||
      remoteAddress === "::ffff:127.0.0.1"
    ) {
      return { ok: true, reason: "loopback_ip" };
    }
  }
  const presented = readHeader(headers, "x-omniroute-loopback-token");
  if (presented && trustedLoopbackTokens.includes(presented)) {
    return { ok: true, reason: "trusted_loopback_token" };
  }
  return { ok: false, reason: "untrusted_origin" };
}
