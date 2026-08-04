/**
 * Per-message Aliyun Captcha token handling for chat.z.ai.
 *
 * chat.z.ai runs Aliyun Captcha 2.0 (`SceneId 36qgs6xb`, prefix `no8xfe`,
 * region `sgp`, embed mode) in front of every chat message. `GET /api/config`
 * reports `features.enable_captcha: true` globally, and the SPA calls its
 * captcha widget once per `sendPrompt`, forwarding the resulting token as
 * `captcha_verify_param` in the request body.
 *
 * Live-verified server behavior (guest token, 2026-08):
 *   - field absent or empty  → `FRONTEND_CAPTCHA_REQUIRED` / `missing_param`
 *   - field present, invalid → `FRONTEND_CAPTCHA_REQUIRED` / `verify_failed`
 *                              with `verify_code: "F003"`
 * Both arrive inside an HTTP 200 SSE envelope, which is why they used to
 * surface as a silent empty completion.
 *
 * A token is single-use and short-lived: it is minted by the Aliyun widget in a
 * real browser, so OmniRoute cannot generate one. What it can do is accept
 * operator-supplied tokens and spend exactly one per outbound message, which is
 * what this module implements. The reader precedence mirrors
 * `lmarena.ts::readRecaptchaToken()` (the established pattern for a
 * browser-issued challenge token) and extends it with a pool so a batch of
 * tokens captured in one browser sitting can cover a run of messages.
 */

/** Tokens older than this are dropped unspent — Aliyun certifyIds go stale. */
const TOKEN_TTL_MS = 5 * 60 * 1000;

/** Cap per connection so a runaway caller cannot grow the pool without bound. */
const MAX_POOL_SIZE = 64;

interface PooledToken {
  token: string;
  addedAt: number;
}

/**
 * Process-local pool, keyed by connection. Deliberately in-memory: the tokens
 * expire in minutes and must never be persisted (they are single-use
 * anti-automation challenge proofs tied to one browser session).
 */
const pools = new Map<string, PooledToken[]>();

function normalizeTokens(value: unknown): string[] {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => normalizeTokens(entry));
  }
  return [];
}

function readFrom(source: unknown): string[] {
  if (!source || typeof source !== "object") return [];
  const record = source as Record<string, unknown>;
  const direct = normalizeTokens(
    record.captchaVerifyParam ?? record.captcha_verify_param ?? record.captchaToken
  );
  if (direct.length > 0) return direct;
  const nested = record.providerSpecificData;
  if (nested && typeof nested === "object") {
    const inner = nested as Record<string, unknown>;
    return normalizeTokens(
      inner.captchaVerifyParam ?? inner.captcha_verify_param ?? inner.captchaToken
    );
  }
  return [];
}

/** Client-supplied header alias, for callers that cannot edit the connection. */
const CAPTCHA_HEADER = "x-omniroute-zai-captcha";

function readFromHeaders(headers: Record<string, string> | null | undefined): string[] {
  if (!headers) return [];
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() === CAPTCHA_HEADER) return normalizeTokens(value);
  }
  return [];
}

/**
 * Collect every operator-supplied captcha token for this request, in
 * precedence order: credentials → request body → client headers. Accepts a
 * single token or an array (a pool captured in one browser sitting).
 */
export function readZaiCaptchaTokens(
  credentials: unknown,
  body: unknown,
  clientHeaders?: Record<string, string> | null
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const token of [
    ...readFrom(credentials),
    ...readFrom(body),
    ...readFromHeaders(clientHeaders),
  ]) {
    if (seen.has(token)) continue;
    seen.add(token);
    out.push(token);
  }
  return out;
}

function pruneExpired(pool: PooledToken[], now: number): PooledToken[] {
  return pool.filter((entry) => now - entry.addedAt < TOKEN_TTL_MS);
}

/**
 * Merge freshly supplied tokens into the connection's pool and spend one.
 *
 * Returns the token to attach to this message, or null when nothing is
 * available. Spending is destructive by design — an Aliyun token verifies once,
 * so replaying it would produce `verify_failed/F003` on the second message and
 * look like an intermittent provider fault.
 */
export function takeZaiCaptchaToken(
  poolKey: string,
  incoming: string[],
  now: number = Date.now()
): string | null {
  const key = poolKey || "default";
  const pool = pruneExpired(pools.get(key) ?? [], now);
  const known = new Set(pool.map((entry) => entry.token));
  for (const token of incoming) {
    if (known.has(token)) continue;
    known.add(token);
    pool.push({ token, addedAt: now });
  }
  // Oldest-first: tokens closest to expiry are spent before they go stale.
  const next = pool.shift() ?? null;
  if (pool.length > MAX_POOL_SIZE) pool.splice(0, pool.length - MAX_POOL_SIZE);
  if (pool.length > 0) pools.set(key, pool);
  else pools.delete(key);
  return next?.token ?? null;
}

/** Remaining unspent, unexpired tokens for a connection (diagnostics/tests). */
export function countZaiCaptchaTokens(poolKey: string, now: number = Date.now()): number {
  return pruneExpired(pools.get(poolKey || "default") ?? [], now).length;
}

/** Drop every pooled token. Used by tests and on credential reset. */
export function clearZaiCaptchaTokens(poolKey?: string): void {
  if (poolKey) pools.delete(poolKey);
  else pools.clear();
}
