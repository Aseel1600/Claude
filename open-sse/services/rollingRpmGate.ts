import {
  SlidingWindowLimiter,
  type RateLimitScope,
  type RateLimitWindow,
  type SlidingWindowLease,
} from "./slidingWindowLimiter.ts";

type GetLimiterKey = (provider: string, connectionId: string, model?: string | null) => string;
type QueueTimeoutErrorFactory = (
  provider: string,
  model: string | null,
  maxWaitMs: number
) => Error;

export interface RollingRpmGateOptions {
  getGlobalRpm: () => number | null | undefined;
  getProviderWindow: (provider: string) => RateLimitWindow | undefined;
  getConnectionRpm: (connectionId: string) => number | null | undefined;
  getLimiterKey: GetLimiterKey;
  createQueueTimeoutError: QueueTimeoutErrorFactory;
}

interface LearnedHeaderWindow {
  window: RateLimitWindow;
  expiresAt: number;
}

function createAbortError(signal: AbortSignal): Error {
  const reason = signal.reason;
  if (reason instanceof Error) return reason;
  const error = new Error(typeof reason === "string" ? reason : "The operation was aborted");
  error.name = "AbortError";
  if (reason !== undefined) (error as Error & { cause?: unknown }).cause = reason;
  return error;
}

function sleepOrAbort(ms: number, signal: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(createAbortError(signal as AbortSignal));
    };
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

/**
 * Process-local trailing-window RPM admission. Distributed deployments need a
 * shared coordination store before this scope can be treated as cluster-wide.
 */
export class RollingRpmGate {
  private readonly limiter = new SlidingWindowLimiter();
  private readonly blockedUntil = new Map<string, number>();
  private readonly learnedHeaderWindows = new Map<string, LearnedHeaderWindow>();
  private readonly windowMs = 60_000;

  constructor(private readonly options: RollingRpmGateOptions) {}

  async acquire(
    provider: string,
    connectionId: string,
    model: string | null,
    signal: AbortSignal | null,
    maxWaitMs: number,
    startedAt: number
  ): Promise<SlidingWindowLease | null> {
    const scopes = this.getScopes(provider, connectionId);
    if (scopes.length === 0) return null;

    const blockKey = this.options.getLimiterKey(provider, connectionId, model);
    for (;;) {
      if (signal?.aborted) throw createAbortError(signal);

      const now = Date.now();
      const blockedUntil = this.blockedUntil.get(blockKey) ?? 0;
      if (blockedUntil <= now) this.blockedUntil.delete(blockKey);
      const forcedWaitMs = Math.max(0, blockedUntil - now);

      if (forcedWaitMs === 0) {
        const result = this.limiter.tryAcquireMany(scopes);
        if (result.allowed) return result.lease ?? null;
        const retryAfterMs = Math.max(1, result.retryAfterMs);
        const remainingMs = maxWaitMs > 0 ? maxWaitMs - (now - startedAt) : retryAfterMs;
        if (maxWaitMs > 0 && remainingMs <= 0) {
          throw this.options.createQueueTimeoutError(provider, model, maxWaitMs);
        }
        await sleepOrAbort(
          Math.min(retryAfterMs, maxWaitMs > 0 ? remainingMs : retryAfterMs),
          signal
        );
        continue;
      }

      const remainingMs = maxWaitMs > 0 ? maxWaitMs - (now - startedAt) : forcedWaitMs;
      if (maxWaitMs > 0 && remainingMs <= 0) {
        throw this.options.createQueueTimeoutError(provider, model, maxWaitMs);
      }
      await sleepOrAbort(
        Math.min(forcedWaitMs, maxWaitMs > 0 ? remainingMs : forcedWaitMs),
        signal
      );
    }
  }

  block(provider: string, connectionId: string, model: string | null, retryAfterMs: number): void {
    if (retryAfterMs > 0) {
      const key = this.options.getLimiterKey(provider, connectionId, model);
      this.blockedUntil.set(key, Date.now() + retryAfterMs);
    }
  }

  learnHeaderWindow(
    provider: string,
    connectionId: string,
    requests: number,
    windowMs: number,
    expiresAt: number
  ): void {
    const key = `header:${this.options.getLimiterKey(provider, connectionId)}`;
    this.learnedHeaderWindows.set(key, {
      window: { requests: Math.max(1, requests), windowMs },
      expiresAt,
    });
  }

  clearLearnedHeaderWindow(provider: string, connectionId: string): void {
    const key = `header:${this.options.getLimiterKey(provider, connectionId)}`;
    this.learnedHeaderWindows.delete(key);
  }

  clearConnection(connectionId: string): void {
    for (const key of this.blockedUntil.keys()) {
      if (key.includes(connectionId)) this.blockedUntil.delete(key);
    }
    for (const key of this.learnedHeaderWindows.keys()) {
      if (key.includes(connectionId)) this.learnedHeaderWindows.delete(key);
    }
  }

  reset(): void {
    this.limiter.reset();
    this.blockedUntil.clear();
    this.learnedHeaderWindows.clear();
  }

  private getScopes(provider: string, connectionId: string): RateLimitScope[] {
    const scopes: RateLimitScope[] = [];
    const globalRpm = this.options.getGlobalRpm();
    if (typeof globalRpm === "number" && globalRpm > 0) {
      scopes.push({
        key: "global",
        window: { requests: globalRpm, windowMs: this.windowMs },
      });
    }

    const providerWindow = this.options.getProviderWindow(provider);
    if (providerWindow) scopes.push({ key: `provider:${provider}`, window: providerWindow });

    const connectionRpm = this.options.getConnectionRpm(connectionId);
    if (typeof connectionRpm === "number" && connectionRpm > 0) {
      scopes.push({
        key: `provider-account:${provider}:${connectionId}`,
        window: { requests: connectionRpm, windowMs: this.windowMs },
      });
    }

    const headerKey = `header:${this.options.getLimiterKey(provider, connectionId)}`;
    const headerWindow = this.learnedHeaderWindows.get(headerKey);
    if (headerWindow) {
      if (headerWindow.expiresAt > Date.now()) {
        scopes.push({ key: headerKey, window: headerWindow.window });
      } else {
        this.learnedHeaderWindows.delete(headerKey);
      }
    }
    return scopes;
  }
}
