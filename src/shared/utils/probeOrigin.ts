/**
 * Probe-origin tracking via AsyncLocalStorage.
 *
 * Convention: ANY probe flow (model test-all, future batch tests,
 * credential-health if it ever routes through the chat path) MUST execute
 * inside runAsProbe() so deactivation guards can refuse probe-origin
 * failures (invariant #9817: only a real request-path failure deactivates
 * a connection). Pinned by tests/unit/probe-testall-isolation.test.ts.
 *
 * NOTE: when a probe dispatches through a scheduler with a queue
 * (Bottleneck via withRateLimit), runAsProbe must wrap the scheduled fn
 * itself — a queued job otherwise executes outside this context
 * (pinned by the queued-scheduler test below).
 */
import { AsyncLocalStorage } from "node:async_hooks";

const probeContext = new AsyncLocalStorage<{ probe: true }>();

export function runAsProbe<T>(fn: () => Promise<T>): Promise<T> {
  return probeContext.run({ probe: true }, fn);
}

export function isProbeContext(): boolean {
  return probeContext.getStore() !== undefined;
}
