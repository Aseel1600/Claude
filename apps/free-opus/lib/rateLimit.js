// Simple in-memory rate limiter per IP. Replace with redis-backed limiter in prod.
const WINDOW_MS = 60 * 1000; // 1 minute
const MAX_REQ = 20;
const map = new Map();

function cleanup() {
  const now = Date.now();
  for (const [k, v] of map.entries()) {
    if (v.start + WINDOW_MS < now) map.delete(k);
  }
}

function allow(key) {
  cleanup();
  const now = Date.now();
  const existing = map.get(key);
  if (!existing) {
    map.set(key, { start: now, count: 1 });
    return true;
  }
  if (existing.count < MAX_REQ) {
    existing.count += 1;
    return true;
  }
  return false;
}

module.exports = { allow };
