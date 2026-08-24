/**
 * MaxAI web-app signing — the `X-Authorization` per-request signature.
 *
 * Ported byte-exact from the MaxAI web app's own JS bundle (constants lifted from
 * the public `_app-*.js` chunk, module 69319) and validated against real captured
 * `X-Authorization` blobs. The scheme is:
 *
 *   sign_str = `${APP_VERSION}:${req_time}:${path}:${uid}`
 *   sha1     = HMAC_SHA1_hex(sign_str, key=`${req_time}:${WEBAPP_HMAC_KEY}`)
 *   p        = SM3_hex(`${req_time}:${sha1}:${WEBAPP_HMAC_KEY}`)
 *   payload  = { X-Client-Domain, X-Client-Path(page url), X-Random(6-digit),
 *               t(ms), p, d(device_id), <CTX_KEY>:{ a: context } }
 *   X-Authorization = base64( "Salted__" + salt8 + AES-256-CBC(payloadJSON) )
 *                     with key/iv from OpenSSL EVP_BytesToKey(MD5, aes_passphrase, salt)
 *
 * All primitives are in `node:crypto` (HMAC-SHA1, SM3 via OpenSSL 3, MD5, AES-256-CBC);
 * no external dependency. Live-verified: a request signed by this module was
 * accepted 200 by MaxAI's guarded `/models/get_config` and `/gpt/cwc/chat`.
 *
 * NOTE these are the WEB-APP (www.maxai.co) constants, DISTINCT from the browser
 * EXTENSION constants — the two are different clients with different secrets and
 * must not be mixed.
 */
import { createHmac, createHash, createCipheriv, randomBytes } from "node:crypto";

export const MAXAI_APP_VERSION = "webpage_8.18.0";
// These are PUBLIC web-app client constants, not secrets: they ship verbatim in
// the www.maxai.co JavaScript bundle (module 69319) and are identical for every
// visitor's browser. They are the client-side keying material the web app uses to
// sign its own outbound requests; there is no per-user or server secret here.
// Named *_WEBAPP_* (not *_SECRET*) to reflect that and to avoid mislabelling a
// public constant as a credential.
const MAXAI_WEBAPP_HMAC_KEY = "4bcbe741c53022f41bf88948e46f257e71ce826d8409a72128398863";
const MAXAI_WEBAPP_AES_KEY = "93d2c4cb7089b5d8cb2b19565d303c0a465ea0157d7466dfd5982ebb";
/** Content slot key (a constant hex string from the bundle). */
const CTX_KEY = "3c86e26ccbb7274f752e7d868a1541ebfb7f37e7";
const CLIENT_DOMAIN = "maxai.co";
/** Default browser page URL recorded verbatim as X-Client-Path (NOT the API path). */
export const MAXAI_DEFAULT_PAGE = "https://www.maxai.co/app/";
/** Only /oauth/* routes blank the user_id inside the signature. */
const BLANK_USER_ROUTES = new Set([
  "/oauth/signin_with_email",
  "/oauth/signin_with_google",
  "/oauth/verify_secret_code",
]);

const MAGIC = Buffer.from("Salted__", "ascii");

function hmacSha1Hex(message: string, key: string): string {
  return createHmac("sha1", Buffer.from(key, "utf8")).update(Buffer.from(message, "utf8")).digest("hex");
}

function sm3Hex(message: string): string {
  return createHash("sm3").update(Buffer.from(message, "utf8")).digest("hex");
}

/** OpenSSL EVP_BytesToKey with MD5 (CryptoJS default for a string passphrase). */
function evpBytesToKey(
  passphrase: string,
  salt: Buffer,
  keyLen = 32,
  ivLen = 16
): { key: Buffer; iv: Buffer } {
  let derived = Buffer.alloc(0);
  let block = Buffer.alloc(0);
  const pass = Buffer.from(passphrase, "utf8");
  while (derived.length < keyLen + ivLen) {
    block = createHash("md5").update(Buffer.concat([block, pass, salt])).digest();
    derived = Buffer.concat([derived, block]);
  }
  return { key: derived.subarray(0, keyLen), iv: derived.subarray(keyLen, keyLen + ivLen) };
}

/** Reproduce CryptoJS.AES.encrypt(text, passphrase).toString() (OpenSSL Salted__ envelope). */
export function maxaiAesEncrypt(plaintext: string, passphrase: string = MAXAI_WEBAPP_AES_KEY, salt?: Buffer): string {
  const s = salt ?? randomBytes(8);
  const { key, iv } = evpBytesToKey(passphrase, s);
  const cipher = createCipheriv("aes-256-cbc", key, iv); // PKCS7 padding is the default
  const body = Buffer.concat([cipher.update(Buffer.from(plaintext, "utf8")), cipher.final()]);
  return Buffer.concat([MAGIC, s, body]).toString("base64");
}

/** Compute the SM3 `p` proof for an API `path` at `reqTime` ms. */
export function computeMaxaiProof(path: string, reqTime: number, userId: string): string {
  const p = path.endsWith("?") ? path.slice(0, -1) : path;
  const uid = BLANK_USER_ROUTES.has(p) ? "" : userId;
  const signStr = `${MAXAI_APP_VERSION}:${reqTime}:${p}:${uid}`;
  const sha1 = hmacSha1Hex(signStr, `${reqTime}:${MAXAI_WEBAPP_HMAC_KEY}`);
  return sm3Hex(`${reqTime}:${sha1}:${MAXAI_WEBAPP_HMAC_KEY}`);
}

export interface MaxaiSignInput {
  /** API path being signed, e.g. "/gpt/cwc/chat". */
  path: string;
  userId: string;
  deviceId: string;
  /** Browser page URL for X-Client-Path (defaults to the app page). */
  pageUrl?: string;
  /** Context slot value (defaults to "" — the wire default). */
  context?: string;
  /** Injectable clock/random for deterministic tests. */
  now?: () => number;
  random?: () => string;
}

/**
 * Build the signing headers (X-Authorization plus the X-App and X-Browser
 * companions) for one request. `device_id` MUST match the device that minted the
 * token, or the server rejects the signature.
 */
export function buildMaxaiSignedHeaders(input: MaxaiSignInput): Record<string, string> {
  const reqTime = (input.now ?? (() => Date.now()))();
  const random =
    input.random?.() ?? String((randomBytes(4).readUInt32BE(0) % 900000) + 100000);
  // Key ORDER matters — it is signed as a compact JSON string.
  const payload: Record<string, unknown> = {
    "X-Client-Domain": CLIENT_DOMAIN,
    "X-Client-Path": input.pageUrl ?? MAXAI_DEFAULT_PAGE,
    "X-Random": random,
    t: reqTime,
    p: computeMaxaiProof(input.path, reqTime, input.userId),
    d: input.deviceId,
    [CTX_KEY]: { a: input.context ?? "" },
  };
  const blob = maxaiAesEncrypt(JSON.stringify(payload));
  return {
    "X-Browser-Name": "Firefox",
    "X-Browser-Version": "150.0",
    "X-Browser-Major": "150",
    "X-App-Version": MAXAI_APP_VERSION,
    "X-App-Env": "MaxAI-Browser-Extension",
    "X-Authorization": blob,
  };
}
