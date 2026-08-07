import { test } from "node:test";
import assert from "node:assert";

import {
  BridgeCache,
  bridgeCacheKey,
} from "../../src/lib/guardrails/modalityBridge/bridgeCache.ts";

test("key is stable sha256 of content+prompt+model", () => {
  const a = bridgeCacheKey("data:image/png;base64,AAA", "describe", "gpt-4o-mini");
  const b = bridgeCacheKey("data:image/png;base64,AAA", "describe", "gpt-4o-mini");
  assert.equal(a, b);
  assert.match(a, /^[a-f0-9]{64}$/);
  assert.notEqual(a, bridgeCacheKey("data:image/png;base64,AAA", "other", "gpt-4o-mini"));
});

test("get/set roundtrip and TTL expiry", () => {
  let now = 1000;
  const cache = new BridgeCache({ maxEntries: 10, ttlMs: 500, now: () => now });
  cache.set("k1", "desc");
  assert.equal(cache.get("k1"), "desc");
  now = 1600;
  assert.equal(cache.get("k1"), undefined);
});

test("LRU evicts oldest when full", () => {
  const cache = new BridgeCache({ maxEntries: 2, ttlMs: 60000, now: () => 0 });
  cache.set("a", "1");
  cache.set("b", "2");
  cache.get("a");
  cache.set("c", "3");
  assert.equal(cache.get("b"), undefined);
  assert.equal(cache.get("a"), "1");
});
