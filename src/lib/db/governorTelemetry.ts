/**
 * src/lib/db/governorTelemetry.ts
 *
 * Database persistence layer for Intelligence Governor telemetry.
 * Stores non-blocking metadata evaluation rows in the local SQLite database.
 *
 * PRIVACY GUARANTEE:
 * - NO API keys, bearer tokens, or authorization headers are stored.
 * - NO prompt bodies or model output content are stored.
 * - Stores metadata metrics ONLY.
 *
 * RESILIENCE GUARANTEE:
 * - Database write failures are caught silently.
 * - Telemetry failure MUST NEVER fail an AI request.
 */

import type { GovernorTelemetry } from "@omniroute/open-sse/governor/types.ts";
import { getDbInstance } from "./core";

const MAX_PENDING_TELEMETRY = 256;
const pendingTelemetry: GovernorTelemetry[] = [];
let flushScheduled = false;

export function enqueueGovernorTelemetryRow(row: GovernorTelemetry): void {
  if (pendingTelemetry.length >= MAX_PENDING_TELEMETRY) return;
  pendingTelemetry.push(row);
  if (flushScheduled) return;
  flushScheduled = true;
  setImmediate(() => {
    flushScheduled = false;
    const batch = pendingTelemetry.splice(0, pendingTelemetry.length);
    for (const pending of batch) insertGovernorTelemetryRow(pending);
  });
}

export function insertGovernorTelemetryRow(row: GovernorTelemetry): void {
  try {
    const db = getDbInstance();

    db.prepare(`
      INSERT INTO governor_telemetry (
        timestamp, correlation_id, governor_mode, actual_provider, actual_model,
        actual_routing_strategy, actual_reasoning_config, actual_compression_config,
        actual_prompt_tokens, actual_output_tokens, actual_total_tokens,
        estimated_cost, latency_ms, retry_count, success, error_category,
        recommendation_json, decision_latency_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      row.timestamp ?? Date.now(),
      row.correlationId || "unknown",
      row.governorMode,
      row.actualProvider ?? null,
      row.actualModel ?? null,
      row.actualRoutingStrategy ?? null,
      row.actualReasoningConfig ?? null,
      row.actualCompressionConfig ?? null,
      row.actualPromptTokens ?? null,
      row.actualOutputTokens ?? null,
      row.actualTotalTokens ?? null,
      row.estimatedCost ?? null,
      row.latencyMs ?? null,
      row.retryCount ?? null,
      row.success == null ? null : row.success ? 1 : 0,
      row.errorCategory ?? null,
      JSON.stringify(row.recommendation),
      row.decisionLatencyMs ?? null
    );
  } catch (error) {
    // Best-effort telemetry: failure to persist NEVER impacts an AI request
    console.warn("[governorTelemetry] Best-effort telemetry write failed:", error);
  }
}

export function queryGovernorTelemetryRows(limit = 100): GovernorTelemetry[] {
  try {
    const db = getDbInstance();

    const rows = db.prepare(`
      SELECT * FROM governor_telemetry ORDER BY id DESC LIMIT ?
    `).all(limit) as Array<{
      id: number;
      timestamp: number;
      correlation_id: string;
      governor_mode: "off" | "shadow";
      actual_provider: string | null;
      actual_model: string | null;
      actual_routing_strategy: string | null;
      actual_reasoning_config: string | null;
      actual_compression_config: string | null;
      actual_prompt_tokens: number | null;
      actual_output_tokens: number | null;
      actual_total_tokens: number | null;
      estimated_cost: number | null;
      latency_ms: number | null;
      retry_count: number | null;
      success: number | null;
      error_category: string | null;
      recommendation_json: string;
      decision_latency_ms: number;
    }>;

    return rows.map((r) => ({
      id: r.id,
      timestamp: r.timestamp,
      correlationId: r.correlation_id,
      governorMode: r.governor_mode,
      actualProvider: r.actual_provider ?? "",
      actualModel: r.actual_model ?? "",
      actualRoutingStrategy: r.actual_routing_strategy ?? undefined,
      actualReasoningConfig: r.actual_reasoning_config ?? undefined,
      actualCompressionConfig: r.actual_compression_config ?? undefined,
      actualPromptTokens: r.actual_prompt_tokens,
      actualOutputTokens: r.actual_output_tokens,
      actualTotalTokens: r.actual_total_tokens,
      estimatedCost: r.estimated_cost ?? undefined,
      latencyMs: r.latency_ms,
      retryCount: r.retry_count,
      success: r.success == null ? null : Boolean(r.success),
      errorCategory: r.error_category ?? undefined,
      recommendation: JSON.parse(r.recommendation_json),
      decisionLatencyMs: r.decision_latency_ms,
    }));
  } catch {
    return [];
  }
}
