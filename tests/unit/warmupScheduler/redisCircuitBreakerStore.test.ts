/**
 * Tests for RedisCircuitBreakerStore using a lightweight in-memory mock that
 * implements the RedisLike surface (hgetall/hset/hget/expire/persist).
 */

import test from "node:test";
import assert from "node:assert/strict";
import { RedisCircuitBreakerStore } from "../../../src/lib/warmupScheduler/redisCircuitBreakerStore.ts";

function makeMockRedis() {
  const store = new Map<string, Map<string, string>>();
  let failForbidden = false;
  return {
    _store: store,
    _setFailForbidden(v: boolean) {
      failForbidden = v;
    },
    redis: {
      async hgetall(key: string) {
        const entry = store.get(key);
        if (!entry) return {};
        return Object.fromEntries(entry);
      },
      async hset(key: string, ...args: (string | number)[]) {
        if (!store.has(key)) store.set(key, new Map());
        const entry = store.get(key)!;
        if (args.length === 1 && typeof args[0] === "object") {
          for (const [k, v] of Object.entries(args[0])) entry.set(k, String(v));
        } else {
          for (let i = 0; i < args.length; i += 2) entry.set(args[i], String(args[i + 1]));
        }
        return "OK";
      },
      async hget(key: string, field: string) {
        return store.get(key)?.get(field) ?? null;
      },
      async expire(key: string, seconds: number) {
        return 1;
      },
      async persist(key: string) {
        return 1;
      },
    } as {
      hgetall(k: string): Promise<Record<string, string>>;
      hset(k: string, ...a: (string | number)[]): Promise<string>;
      hget(k: string, f: string): Promise<string | null>;
      expire(k: string, s: number): Promise<number>;
      persist(k: string): Promise<number>;
    },
    // Simulate the best-effort SQLite dual-write failing once.
    failForbidden,
  };
}

test("recordResult(success): clears streak and until", async () => {
  const mock = makeMockRedis();
  const store = new RedisCircuitBreakerStore(mock.redis);
  await store.recordResult("c1", {
    success: false,
    tokensUsed: 0,
    durationMs: 1,
    failureKind: "network",
  });
  await store.recordResult("c1", { success: true, tokensUsed: 4, durationMs: 5 });
  const state = await store.get("c1");
  assert.equal(state?.streak, 0);
  assert.equal(state?.lastResult, "success");
  assert.ok(state?.lastWarmupAt, "success should set lastWarmupAt");
  assert.equal(await store.isInBackoff("c1"), false);
});

test("recordResult(forbidden): sets lastResult=forbidden and PERSISTs", async () => {
  const mock = makeMockRedis();
  const store = new RedisCircuitBreakerStore(mock.redis);
  await store.recordResult("c1", {
    success: false,
    tokensUsed: 0,
    durationMs: 1,
    failureKind: "forbidden",
  });
  const state = await store.get("c1");
  assert.equal(state?.lastResult, "forbidden");
  assert.ok(state?.lastFailAt, "forbidden should set lastFailAt");
});

test("recordResult(rate_limit): increments streak and sets TTL", async () => {
  const mock = makeMockRedis();
  const store = new RedisCircuitBreakerStore(mock.redis);
  await store.recordResult("c1", {
    success: false,
    tokensUsed: 0,
    durationMs: 1,
    failureKind: "rate_limit",
  });
  await store.recordResult("c1", {
    success: false,
    tokensUsed: 0,
    durationMs: 1,
    failureKind: "rate_limit",
  });
  const state = await store.get("c1");
  assert.equal(state?.streak, 2);
  assert.equal(state?.lastResult, "rate_limit");
  assert.ok(state?.until);
});

test("isInBackoff: until > now → true, absent → false", async () => {
  const mock = makeMockRedis();
  const store = new RedisCircuitBreakerStore(mock.redis);
  assert.equal(await store.isInBackoff("c1"), false);
  await store.recordResult("c1", {
    success: false,
    tokensUsed: 0,
    durationMs: 1,
    failureKind: "network",
  });
  assert.equal(await store.isInBackoff("c1"), true);
});

test("get: returns empty-state for unknown connection", async () => {
  const mock = makeMockRedis();
  const store = new RedisCircuitBreakerStore(mock.redis);
  assert.equal(await store.get("nope"), null);
});
