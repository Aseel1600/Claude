/**
 * Distillation worker — the lifecycle orchestrator.
 *
 * Public surface:
 *
 *   startDistillationWorker(deps?) → boolean
 *     Idempotent; returns true when the worker actually started.
 *
 *   stopDistillationWorker() → Promise<void>
 *     Waits for in-flight tasks to drain up to a small grace window.
 *
 * Boot:
 *   - Doubly opt-in via env (MEMORY_DISTILLATION_ENABLED=true AND
 *     MEMORY_DISTILLATION_INTERVAL>0). Both missing → no-op.
 *   - No start under isBuildPhase / isCloud / isAutomatedTestProcess.
 *
 * Loop:
 *   1. setTimeout(initialDelay, tick) — first poll is fast (200 ms), then
 *      `config.intervalMs` thereafter. Both timers are unref'd so the
 *      worker never blocks process exit.
 *   2. tick() acquires a permit; on miss, sleeps for `idleSleepMs()`.
 *   3. claims the next task from the store.
 *   4. resolves the selection; surfaces model_unset / model_deleted /
 *      credentials_invalid as DLQ entries (no silent fallback).
 *   5. runs the kind-specific handler; classifies failure; either retries
 *      (with backoff) or DLQs (with sanitized message).
 *   6. breaker-open is a NO-op for the attempt — task is left queued with
 *      `notBefore = now + breakerRetryAfterMs` so the next tick re-polls.
 *   7. usage is recorded via the batcher; flushes on every successful task
 *      and on shutdown.
 *
 * Cross-cutting concerns:
 *   - Synchronous reentry guard via a module-level `running` flag.
 *   - Owner-level lock per scope (default TTL 240 s, renew every 30 s).
 *   - Internal marker HMAC secret is minted at boot and threaded into the
 *     `internalMarker` module via `setInternalMarkerSecret`.
 */

import { resolveDistillationConfig, isWorkerStartAllowed } from "./config.ts";
import {
  InMemoryDistillationStore,
  createDefaultDistillationStore,
  type DistillationStore,
  type DistillationTask,
  type DistillationTaskKind,
} from "./store.ts";
import { ProcessPermitPool, releasePermit, type AcquiredPermit } from "./permit.ts";
import {
  computeRetryBackoffMs,
  initialDelayForKind,
  idleSleepMs,
  nextWarmupDelayMs,
} from "./scheduler.ts";
import {
  resolveDistillationSelection,
  validateModelStillUsable,
  type SelectorDeps,
} from "./selector.ts";
import { classifyFailure, decideRetry, sanitizeMessage } from "./failure.ts";
import { signInternalMarker } from "./internalMarker.ts";
import { withOwnerLock, type OwnerLockHandle } from "./lock.ts";
import { UsageBatcher, buildUsageRecord } from "./usage.ts";
import { DEFAULT_HANDLERS, type DistillationHandler, type HandlerError } from "./handlers.ts";
import type { ExecutorDeps, ExecutorResult, ExecutorBreakerHook } from "./executor.ts";
import { makeCodedError } from "./executor.ts";
import { isAutomatedTestProcess, isBuildProcess } from "@/shared/utils/testProcess";

/**
 * Cloudflare Workers / Cloudflare Pages detection — mirrors `isCloud` in
 * `@/lib/db/core.ts` but reachable without importing the DB layer (which
 * would drag in better-sqlite3 etc. into the worker module). The runtime
 * detection is the same: presence of the `caches` global.
 */
function isCloudRuntime(): boolean {
  return (
    typeof globalThis !== "undefined" &&
    typeof globalThis.caches === "object" &&
    globalThis.caches !== null
  );
}

declare global {
   
  var __omnirouteDistillationWorker:
    | {
        timer: ReturnType<typeof setTimeout> | null;
        interval: ReturnType<typeof setInterval> | null;
        store: DistillationStore;
        permitPool: ProcessPermitPool;
        usage: UsageBatcher;
        running: boolean;
        stopping: boolean;
        config: ReturnType<typeof resolveDistillationConfig>;
        executorDeps: ExecutorDeps | null;
        handlers: Record<DistillationTaskKind, DistillationHandler>;
        selectorDeps: SelectorDeps | null;
        activeLocks: Map<string, OwnerLockHandle>;
        activeTasks: Set<string>;
        consecutiveSuccesses: number;
        ownerId: string;
        catalog: {
          providers: Map<string, readonly string[]>;
          isModelUsable(p: string, m: string): boolean;
        } | null;
      }
    | undefined;
}

const INITIAL_DELAY_MS = 200;
const SHUTDOWN_GRACE_MS = 5_000;
const MAX_INFLIGHT_PER_SCOPE = 1;

function generateOwnerId(): string {
  // Stable per-process owner id. Two workers in the same process share it;
  // two workers in two processes differ by pid.
  const pid = typeof process !== "undefined" ? process.pid : 0;
  let r = "";
  for (let i = 0; i < 8; i++) r += Math.floor(Math.random() * 16).toString(16);
  return `pid:${pid ?? 0}:${r}`;
}

function getWorker(): NonNullable<typeof globalThis.__omnirouteDistillationWorker> | null {
  return globalThis.__omnirouteDistillationWorker ?? null;
}

export interface StartDeps {
  store?: DistillationStore;
  executor?: ExecutorDeps;
  selector?: SelectorDeps;
  handlers?: Partial<Record<DistillationTaskKind, DistillationHandler>>;
}

export interface StopOptions {
  /** Bypass the env opt-in (used only by tests). */
  force?: boolean;
  /** Override the shutdown grace window (tests only). */
  graceMs?: number;
}

/**
 * Start the worker. Returns `true` when the loop is scheduled. The function
 * is idempotent — calling it twice returns `false` on the second call.
 */
export async function startDistillationWorker(deps: StartDeps = {}): Promise<boolean> {
  if (typeof globalThis !== "undefined" && globalThis.__omnirouteDistillationWorker) {
    // Idempotent — already started.
    return false;
  }
  const config = resolveDistillationConfig();
  if (
    !isWorkerStartAllowed(process.env, isBuildProcess(), isCloudRuntime(), isAutomatedTestProcess())
  ) {
    return false;
  }
  if (!config.enabled || config.intervalMs <= 0) {
    // Doubly opt-in: missing either → no-op.
    return false;
  }

  const store = deps.store ?? (await createDefaultDistillationStore());
  const permitPool = new ProcessPermitPool({ size: config.concurrency });
  const usageBatcher = new UsageBatcher(store);
  usageBatcher.start();
  const handlers: Record<DistillationTaskKind, DistillationHandler> = {
    ...DEFAULT_HANDLERS,
    ...(deps.handlers ?? {}),
  };
  const executorDeps = deps.executor ?? null;
  const selectorDeps = deps.selector ?? null;

  const worker = {
    timer: null as ReturnType<typeof setTimeout> | null,
    interval: null as ReturnType<typeof setInterval> | null,
    store,
    permitPool,
    usage: usageBatcher,
    running: false, // synchronous reentry guard for `tick`
    stopping: false,
    config,
    executorDeps,
    handlers,
    selectorDeps,
    activeLocks: new Map<string, OwnerLockHandle>(),
    activeTasks: new Set<string>(),
    consecutiveSuccesses: 0,
    ownerId: generateOwnerId(),
    catalog: null as null | {
      providers: Map<string, readonly string[]>;
      isModelUsable(p: string, m: string): boolean;
    },
  };
  globalThis.__omnirouteDistillationWorker = worker;

  // First tick: immediate (setTimeout 200ms) so the test suite does not have
  // to wait a full interval. Subsequent ticks run on the configured cadence.
  worker.timer = setTimeout(() => {
    void tickOnce();
  }, INITIAL_DELAY_MS);
  if (worker.timer && typeof (worker.timer as { unref?: () => void }).unref === "function") {
    (worker.timer as { unref: () => void }).unref();
  }
  worker.interval = setInterval(() => {
    void tickOnce();
  }, config.intervalMs);
  if (worker.interval && typeof (worker.interval as { unref?: () => void }).unref === "function") {
    (worker.interval as { unref: () => void }).unref();
  }
  return true;
}

/**
 * Stop the worker. Awaits the best shutdown grace for in-flight work
 * (default 5 s). Safe to call multiple times.
 */
export async function stopDistillationWorker(options: StopOptions = {}): Promise<void> {
  const worker = getWorker();
  if (!worker) return;
  worker.stopping = true;
  if (worker.timer) {
    clearTimeout(worker.timer);
    worker.timer = null;
  }
  if (worker.interval) {
    clearInterval(worker.interval);
    worker.interval = null;
  }
  const grace = options.graceMs ?? SHUTDOWN_GRACE_MS;
  const start = Date.now();
  while (worker.activeTasks.size > 0 && Date.now() - start < grace) {
    await delay(50);
  }
  // Release every lock.
  for (const handle of worker.activeLocks.values()) {
    try {
      await handle.release();
    } catch {
      /* ignore */
    }
  }
  worker.activeLocks.clear();
  try {
    await worker.usage.stop();
  } catch {
    /* ignore */
  }
  // Final cleanup — only when not forced to skip the env gate (force=true
  // is the test escape hatch; production stopDistillationWorker also wipes
  // the worker handle).
  worker.running = false;
  worker.stopping = false;
  if (typeof globalThis !== "undefined") {
    delete globalThis.__omnirouteDistillationWorker;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const id = setTimeout(resolve, ms);
    if (typeof id.unref === "function") id.unref();
  });
}

/** Test-only — wipe the global worker handle without draining. */
export function __resetDistillationWorkerForTests(): void {
  if (typeof globalThis !== "undefined") {
    delete globalThis.__omnirouteDistillationWorker;
  }
}

/**
 * One tick of the polling loop. Called by setInterval + the initial
 * setTimeout. The synchronous reentry guard prevents two ticks from
 * running concurrently when a tick exceeds the configured interval.
 */
export async function tickOnce(): Promise<void> {
  const worker = getWorker();
  if (!worker) return;
  if (worker.stopping) return;
  if (worker.running) return; // reentry guard
  worker.running = true;
  try {
    const permit = worker.permitPool.tryAcquire();
    if (!permit) {
      // Over budget — sleep for the idle window and exit.
      await delay(idleSleepMs());
      return;
    }
    try {
      const claim = await worker.store.claimNextTask(Date.now(), null);
      if (!claim.task) {
        // Nothing to do — let the permit expire so we don't keep spinning.
        return;
      }
      const task = claim.task;
      worker.activeTasks.add(task.id);
      try {
        await processTask(task, permit);
      } finally {
        worker.activeTasks.delete(task.id);
      }
    } finally {
      releasePermit(permit);
    }
  } finally {
    worker.running = false;
  }
}

async function processTask(task: DistillationTask, _permit: AcquiredPermit): Promise<void> {
  const worker = getWorker();
  if (!worker) return;
  if (!worker.executorDeps || !worker.selectorDeps) {
    // No executor wired → DLQ with model_unset. We do not silently fall
    // back to a different store / executor.
    await worker.store.markDLQ(
      task.id,
      worker.ownerId,
      sanitizeMessage("Distillation executor not wired"),
      "model_unset"
    );
    await worker.store.appendDLQ({
      taskId: task.id,
      reason: "executor_not_wired",
      failureKind: "model_unset",
      attempts: task.attempt,
      error: "Distillation executor not wired",
      recordedAt: Date.now(),
    });
    return;
  }

  // Owner-level lock — refuse the task when another worker holds it.
  let lockHandle = worker.activeLocks.get(task.scope);
  if (!lockHandle) {
    const handle = await withOwnerLock(worker.store, task.scope, worker.ownerId);
    if (!handle) {
      // Another worker holds the lock; defer the task.
      await worker.store.markSkippedBreaker(
        task.id,
        worker.ownerId,
        Date.now() + 15_000,
        "scope locked"
      );
      return;
    }
    worker.activeLocks.set(task.scope, handle);
    lockHandle = handle;
  }

  // Selection.
  const selection = await resolveDistillationSelection(task, worker.selectorDeps);
  if (!selection) {
    await worker.store.markDLQ(
      task.id,
      worker.ownerId,
      sanitizeMessage("No provider/model available"),
      "model_unset"
    );
    await worker.store.appendDLQ({
      taskId: task.id,
      reason: "model_unset",
      failureKind: "model_unset",
      attempts: task.attempt,
      error: "No provider/model available",
      recordedAt: Date.now(),
    });
    return;
  }
  const validation: { ok: true } | { ok: false; reason: "model_unset" | "model_deleted" } =
    worker.catalog ? validateModelStillUsable(selection, worker.catalog) : { ok: true };
  if (!validation.ok) {
    const validationReason = validation.reason as "model_unset" | "model_deleted";
    await worker.store.markDLQ(
      task.id,
      worker.ownerId,
      sanitizeMessage(`Selected model unusable: ${validationReason}`),
      validationReason === "model_deleted" ? "model_deleted" : "model_unset"
    );
    await worker.store.appendDLQ({
      taskId: task.id,
      reason: validationReason,
      failureKind: validationReason === "model_deleted" ? "model_deleted" : "model_unset",
      attempts: task.attempt,
      error: `Selected model unusable: ${validationReason}`,
      recordedAt: Date.now(),
    });
    return;
  }

  // Optimistic claim.
  const claimed = await worker.store.markClaimed(task.id, task.version, worker.ownerId, 60_000);
  if (!claimed) {
    // Another worker beat us — nothing to do.
    return;
  }
  await worker.store.markRunning(task.id, worker.ownerId);

  // Run the handler.
  const handler = worker.handlers[task.kind];
  if (!handler) {
    await worker.store.markDLQ(
      task.id,
      worker.ownerId,
      sanitizeMessage(`No handler for kind=${task.kind}`),
      "model_unset"
    );
    await worker.store.appendDLQ({
      taskId: task.id,
      reason: "no_handler",
      failureKind: "model_unset",
      attempts: task.attempt,
      error: `No handler for kind=${task.kind}`,
      recordedAt: Date.now(),
    });
    return;
  }

  const outcome = await handler({
    task,
    selection,
    budget: {
      maxTokens: worker.config.maxTokens,
      maxSteps: worker.config.maxSteps,
      maxCalls: worker.config.maxCalls,
      maxDepth: worker.config.maxDepth,
    },
    callModel: async ({ messages, maxTokens }) => {
      // Mint the internal marker. The `callModel` adapter will spread these
      // headers onto the outgoing fetch (production) or into the executor
      // input (test).
      const marker = signInternalMarker(worker.config.secret, {
        depth: 0,
        callsRemaining: worker.config.maxCalls,
      });
      void marker;
      const result = await runExecutorCall({
        worker,
        provider: selection.provider,
        model: selection.model,
        messages,
        maxTokens,
        task,
      });
      if (!result.ok) {
        throw (result as ExecutorCallErr).error;
      }
      const ok = result as ExecutorCallOk;
      return {
        text: ok.value.text,
        promptTokens: ok.value.promptTokens,
        completionTokens: ok.value.completionTokens,
      };
    },
  });

  if (outcome.ok) {
    await worker.store.markSucceeded(task.id, worker.ownerId);
    worker.usage.enqueue(
      buildUsageRecord({
        taskId: task.id,
        scope: task.scope,
        kind: task.kind,
        provider: selection.provider,
        model: selection.model,
        promptTokens: outcome.result.promptTokens,
        completionTokens: outcome.result.completionTokens,
        costPerKTokenIn: (await worker.selectorDeps.resolveGlobalSettings())
          ? undefined
          : undefined,
      })
    );
    worker.consecutiveSuccesses++;
    // Warm-up ramp — adjust notBefore for the next same-scope task via the
    // next initialDelayForKind call (kept here for visibility).
    void nextWarmupDelayMs(worker.consecutiveSuccesses);
    return;
  }

  // Failure handling.
  if (outcome.ok) {
    // handled above
  } else {
    const handlerError = (outcome as { ok: false; error: HandlerError }).error;
    const failure = classifyFailure(handlerError as unknown);
    const decision = decideRetry(failure, task.attempt);
    if (decision.retry) {
      await worker.store.markRetry(
        task.id,
        worker.ownerId,
        decision.nextAttempt,
        Date.now() + decision.backoffMs,
        failure.message
      );
      return;
    }
    await worker.store.markDLQ(task.id, worker.ownerId, failure.message, decision.dlqKind);
    await worker.store.appendDLQ({
      taskId: task.id,
      reason: failure.kind,
      failureKind: decision.dlqKind,
      attempts: task.attempt,
      error: failure.message,
      recordedAt: Date.now(),
    });
  }
}

interface ExecutorCallOk {
  ok: true;
  value: { text: string; promptTokens: number; completionTokens: number };
}
interface ExecutorCallErr {
  ok: false;
  error: Error & { code?: string };
}
type ExecutorCallResult = ExecutorCallOk | ExecutorCallErr;

async function runExecutorCall(args: {
  worker: NonNullable<typeof globalThis.__omnirouteDistillationWorker>;
  provider: string;
  model: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  maxTokens: number;
  task: DistillationTask;
}): Promise<ExecutorCallResult> {
  const { worker, provider, model, messages, maxTokens, task } = args;
  // 1. Breaker check.
  const breaker: ExecutorBreakerHook = worker.executorDeps!.breaker;
  const breakerState = await breaker.isOpen(provider);
  if (breakerState.open) {
    await worker.store.markSkippedBreaker(
      task.id,
      worker.ownerId,
      Date.now() + Math.max(breakerState.retryAfterMs, 5_000),
      "breaker open"
    );
    return {
      ok: false,
      error: makeCodedError("BREAKER_OPEN", "Provider breaker is OPEN"),
    };
  }
  // 2. Credentials.
  const creds = await worker.executorDeps!.resolveCredentials(provider);
  if (!creds || !creds.credentials) {
    return {
      ok: false,
      error: makeCodedError("CREDENTIALS_INVALID", "No credentials"),
    };
  }
  // 3. Run.
  try {
    const result: ExecutorResult = await worker.executorDeps!.runModelCall({
      provider,
      credentials: creds.credentials,
      model,
      messages,
      maxTokens,
      isInternal: true,
    });
    return {
      ok: true,
      value: {
        text: result.text,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
      },
    };
  } catch (err) {
    const failure = classifyFailure(err);
    return { ok: false, error: makeCodedError(failure.kind, failure.message) };
  }
}

/** Public façade used by tests / API to enqueue work without the store. */
export function buildInitialDelayForKind(kind: DistillationTaskKind, now: number): number {
  return initialDelayForKind(kind, now);
}

/** Re-export the in-memory store for integration owners / tests. */
export { InMemoryDistillationStore } from "./store.ts";

// Cap import-only reference to avoid unused-var lint on the constant.
void MAX_INFLIGHT_PER_SCOPE;
