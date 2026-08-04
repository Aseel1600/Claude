import type { CircuitBreakerStore, CircuitBreakerState } from "./circuitBreakerStore";
import { getWarmupBackoffUntil } from "./backoff";
import {
  markForbidden as sqliteMarkForbidden,
  upsertWarmupState as sqliteUpsertWarmupState,
} from "@/lib/db/connectionRuntimeState";
import type { WarmupResult } from "./core";

type RedisLike = {
  hgetall: (key: string) => Promise<Record<string, string>>;
  hset: (key: string, ...args: any[]) => Promise<unknown>;
  hget: (key: string, field: string) => Promise<string | null>;
  expire: (key: string, seconds: number) => Promise<unknown>;
  persist: (key: string) => Promise<unknown>;
};

const KEY_PREFIX = "omniroute:warmup:cb:";

export class RedisCircuitBreakerStore implements CircuitBreakerStore {
  constructor(private redis: RedisLike) {}

  async get(connectionId: string): Promise<CircuitBreakerState | null> {
    const data = await this.redis.hgetall(`${KEY_PREFIX}${connectionId}`);
    if (!data || Object.keys(data).length === 0) return null;
    return {
      connectionId,
      streak: parseInt(data.streak, 10) || 0,
      until: data.until || null,
      lastFailAt: data.lastFailAt || null,
      lastWarmupAt: data.lastWarmupAt || null,
      lastResult: data.lastResult || null,
    };
  }

  async recordResult(connectionId: string, result: WarmupResult): Promise<void> {
    if (result.success) {
      await this.redis.hset(`${KEY_PREFIX}${connectionId}`, {
        streak: "0",
        until: "",
        lastResult: "success",
        lastWarmupAt: new Date().toISOString(),
      });
      // Clear any stale forbidden flag in SQLite backup so a Redis eviction
      // does not permanently trap the connection in forbidden state.
      // upsertWarmupState updates last_warmup_result (unlike clearWarmupCircuit
      // which only clears streak/until/lastFailAt columns).
      try {
        await sqliteUpsertWarmupState(connectionId, {
          lastWarmupAt: new Date().toISOString(),
          lastResult: "success",
          tokensUsed: result.tokensUsed,
        });
      } catch {
        /* non-fatal; Redis is source of truth */
      }
      return;
    }
    if (result.failureKind === "forbidden") {
      await this.redis.hset(`${KEY_PREFIX}${connectionId}`, {
        lastResult: "forbidden",
        lastFailAt: new Date().toISOString(),
      });
      await this.redis.persist(`${KEY_PREFIX}${connectionId}`);
      // Best-effort SQLite backup so a forbidden flag survives Redis eviction;
      // Redis is the source of truth, so a backup write failure is non-fatal.
      try {
        await sqliteMarkForbidden(connectionId, new Date().toISOString());
      } catch {
        /* non-fatal; Redis already holds the authoritative state */
      }
      return;
    }
    const state = await this.get(connectionId);
    const streak = (state?.streak ?? 0) + 1;
    const until =
      result.retryAfterSeconds && Number.isFinite(result.retryAfterSeconds)
        ? new Date(Date.now() + result.retryAfterSeconds * 1000).toISOString()
        : getWarmupBackoffUntil(streak);
    await this.redis.hset(`${KEY_PREFIX}${connectionId}`, {
      streak: String(streak),
      until,
      lastResult: result.failureKind || "unknown",
      lastFailAt: new Date().toISOString(),
    });
    const ttlMs = Math.max(new Date(until).getTime() - Date.now(), 0) + 24 * 3600 * 1000;
    await this.redis.expire(`${KEY_PREFIX}${connectionId}`, Math.ceil(ttlMs / 1000));
  }

  async isInBackoff(connectionId: string): Promise<boolean> {
    const until = await this.redis.hget(`${KEY_PREFIX}${connectionId}`, "until");
    if (!until) return false;
    return new Date(until).getTime() > Date.now();
  }
}
