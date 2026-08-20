/**
 * Provider/Model Quality Signal — feedback-driven adaptive routing.
 *
 * Consumes RoutingEvents and maintains a per-(provider, model) online quality
 * estimate using robust online statistics (EWMA + bounded window counts). This
 * is deliberately simpler than the existing resilience stack (circuit breaker,
 * connection cooldown, model lockout, health matrix) — those handle
 * *availability* (can we send traffic?), while this signal captures *quality*
 * (was the traffic good?). The two layers work together: a provider that keeps
 * failing will be removed by the breaker; a provider that "succeeds" but
 * consistently produces empty/malformed/short outputs gradually scores lower
 * here and is progressively de-preferenced by the auto-combo scorer.
 *
 * Signals folded into the estimate:
 *  - HTTP failures / 4xx / 5xx / connection-level errors
 *  - rate limits (429) — less harsh than a 500, but still negative
 *  - malformed responses and empty-output / finish_reason anomalies
 *  - stream interruptions and cancelled streams
 *  - latency (EWMA) vs a per-model bootstrap baseline; TTFT when available
 *
 * The exported `getQualityScore()` returns a [0,1] score (1 = best) that feeds
 * the auto-combo `quality` scoring factor. Before enough samples accumulate the
 * score is neutral (1.0) so a fresh model is never penalized for lack of data.
 *
 * Statistics are plain arithmetic (EWMA with constant alpha, small counters) —
 * no lock-free/atomics trickery. Writes happen from the request path (sink
 * record) and reads happen from the scorer/explain path; the update math is
 * O(1) per event and safe to run under the event loop's single thread.
 */

/** EWMA smoothing factor (alpha). Lower = slower adaptation. */
const QUALITY_ALPHA = 0.2;
/** Latency EWMA alpha — slower so transient spikes don't tank quality instantly. */
const LATENCY_ALPHA = 0.1;
/** Minimum samples before a non-neutral quality score is returned. */
const MIN_QUALITY_SAMPLES = 5;
/** Baseline TTFT (ms) used to normalize a latency-degradation signal. */
const DEFAULT_TTFT_BASELINE_MS = 1500;

interface QualityState {
  /** EWMA of the success indicator (1 = good, 0 = bad). */
  successEwma: number;
  /** EWMA of latency in ms. */
  latencyEwma: number;
  /** EWMA of TTFT in ms (streaming only). */
  ttftEwma: number | null;
  /** Total events observed for this (provider, model). */
  samples: number;
  /** Count of quality-anomaly events (malformed / empty / length / cancelled). */
  anomalies: number;
  lastTs: number;
}

const states = new Map<string, QualityState>();

function keyOf(provider: string, model: string): string {
  return `${provider}/${model}`;
}

function getOrCreate(key: string): QualityState {
  let state = states.get(key);
  if (!state) {
    state = { successEwma: 1, latencyEwma: 0, ttftEwma: null, samples: 0, anomalies: 0, lastTs: 0 };
    states.set(key, state);
  }
  return state;
}

function isAnomalousEvent(event: {
  outcome: string;
  finishReason: string | null;
  outputTokens: number | null | undefined;
}): boolean {
  if (event.outcome === "malformed" || event.outcome === "stream_interrupted") return true;
  // finish_reason=length → the model ran out of output budget (truncated answer).
  if (event.outcome === "success" && event.finishReason === "length") return true;
  // A "successful" 200 that produced zero output tokens is an empty/invalid output.
  // NOTE: we deliberately do NOT treat a missing finish_reason as an anomaly —
  // streaming passthrough frequently has no reconstructed finish_reason, so that
  // signal would penalize every legitimately streamed request (pure noise).
  if (event.outcome === "success" && event.outputTokens === 0) return true;
  return false;
}

function successIndicator(event: { outcome: string; status: number | null }): number {
  if (event.outcome === "success") return 1;
  // 429 is a transient signal, not a quality failure — treat as neutral-positive.
  if (event.outcome === "rate_limited" || event.status === 429) return 0.5;
  return 0;
}

/** Record one routing event into the quality estimate. O(1). */
export function recordQualityEvent(event: {
  provider: string;
  model: string;
  outcome: string;
  status: number | null;
  latencyMs: number;
  ttftMs?: number | null;
  finishReason?: string | null;
  outputTokens?: number | null;
  ts?: number;
}): void {
  const key = keyOf(event.provider || "unknown", event.model || "unknown");
  const state = getOrCreate(key);

  state.samples += 1;
  if (
    isAnomalousEvent({
      outcome: event.outcome,
      finishReason: event.finishReason ?? null,
      outputTokens: event.outputTokens ?? undefined,
    })
  ) {
    state.anomalies += 1;
  }

  const indicator = successIndicator({ outcome: event.outcome, status: event.status });
  // First sample seeds the EWMA directly (no lag toward a default).
  state.successEwma =
    state.samples === 1
      ? indicator
      : state.successEwma + QUALITY_ALPHA * (indicator - state.successEwma);

  const latency = Number.isFinite(event.latencyMs) && event.latencyMs >= 0 ? event.latencyMs : 0;
  state.latencyEwma =
    state.samples === 1
      ? latency
      : state.latencyEwma + LATENCY_ALPHA * (latency - state.latencyEwma);

  const ttft = event.ttftMs;
  if (typeof ttft === "number" && Number.isFinite(ttft) && ttft >= 0) {
    state.ttftEwma =
      state.ttftEwma == null ? ttft : state.ttftEwma + LATENCY_ALPHA * (ttft - state.ttftEwma);
  }

  state.lastTs = event.ts ?? Date.now();
}

export interface QualityView {
  provider: string;
  model: string;
  score: number;
  successEwma: number;
  latencyEwmaMs: number;
  ttftEwmaMs: number | null;
  samples: number;
  anomalies: number;
  confidence: number;
  lastTs: number;
}

/**
 * Current quality score [0,1] for a (provider, model). Neutral (1.0) below the
 * warmup threshold so cold models are never penalized. The score combines the
 * success EWMA with a latency-degradation penalty and an anomaly penalty.
 */
export function getQualityScore(provider: string, model: string): number {
  const state = states.get(keyOf(provider, model));
  if (!state || state.samples === 0) return 1;
  if (state.samples < MIN_QUALITY_SAMPLES) return 1;

  let score = state.successEwma;

  // Latency degradation: if the latency EWMA is high (relative to a sane
  // baseline), blend in a penalty. We use a soft ceiling so very slow models
  // aren't zeroed out — just discounted.
  const latencyPenalty = Math.min(0.2, state.latencyEwma / 60_000);
  score -= latencyPenalty;

  // Anomaly penalty: capped so a few bad apples don't nuke a provider entirely.
  const anomalyRate = state.anomalies / state.samples;
  score -= Math.min(0.25, anomalyRate * 0.5);

  return Math.max(0, Math.min(1, score));
}

/** Full snapshot of the tracker for explainability / debugging. */
export function getQualitySnapshot(limit = 200): QualityView[] {
  const views: QualityView[] = [];
  for (const [key, state] of states) {
    const slash = key.indexOf("/");
    const provider = slash >= 0 ? key.slice(0, slash) : key;
    const model = slash >= 0 ? key.slice(slash + 1) : key;
    const confidence =
      state.samples >= MIN_QUALITY_SAMPLES ? 1 : state.samples / MIN_QUALITY_SAMPLES;
    views.push({
      provider,
      model,
      score: getQualityScore(provider, model),
      successEwma: state.successEwma,
      latencyEwmaMs: state.latencyEwma,
      ttftEwmaMs: state.ttftEwma,
      samples: state.samples,
      anomalies: state.anomalies,
      confidence,
      lastTs: state.lastTs,
    });
  }
  views.sort((a, b) => b.lastTs - a.lastTs);
  return views.slice(0, limit);
}

/** Test/ops hook: reset all quality state. */
export function resetQualityTracker(): void {
  states.clear();
}

export const QUALITY_WELL_KNOWN = {
  MIN_QUALITY_SAMPLES,
  DEFAULT_TTFT_BASELINE_MS,
} as const;
