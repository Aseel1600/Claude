import type { CircuitBreakerStore } from "./circuitBreakerStore";

type RedisCtor = new (url: string, opts?: Record<string, unknown>) => any;

let storeInstance: CircuitBreakerStore | null = null;

export async function getCircuitBreakerStore(): Promise<CircuitBreakerStore> {
  if (storeInstance) return storeInstance;

  const redisUrl = process.env.REDIS_URL;
  if (redisUrl) {
    try {
      const mod = await import("ioredis");
      const RedisCtor = (mod.default ?? mod) as RedisCtor;
      const redis = new RedisCtor(redisUrl, {
        maxRetriesPerRequest: 3,
        connectTimeout: 3000,
        lazyConnect: true,
        retryStrategy: () => null,
      });
      await redis.connect();
      await redis.ping();
      const { RedisCircuitBreakerStore } = await import("./redisCircuitBreakerStore");
      storeInstance = new RedisCircuitBreakerStore(redis);
      return storeInstance;
    } catch {
      storeInstance = null;
    }
  }

  const { SqliteCircuitBreakerStore } = await import("./sqliteCircuitBreakerStore");
  storeInstance = new SqliteCircuitBreakerStore();
  return storeInstance;
}

export function __resetCircuitBreakerFactory(): void {
  storeInstance = null;
}
