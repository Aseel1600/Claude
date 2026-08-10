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

export function ensureGovernorTelemetryTable(): void {
  try {
    const db = getDbInstance();
    db.exec(`
      CREATE TABLE IF NOT EXISTS governor_telemetry (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        correlation_id TEXT NOT NULL,
        governor_mode TEXT NOT NULL,
        actual_provider TEXT,
        actual_model TEXT,
        actual_routing_strategy TEXT,
        actual_reasoning_config TEXT,
        actual_compression_config TEXT,
        actual_prompt_tokens INTEGER DEFAULT 0,
        actual_output_tokens INTEGER DEFAULT 0,
        actual_total_tokens INTEGER DEFAULT 0,
        estimated_cost REAL,
        latency_ms INTEGER DEFAULT 0,
        retry_count INTEGER DEFAULT 0,
        success INTEGER NOT NULL,
        error_category TEXT,
        recommendation_json TEXT NOT NULL,
        decision_latency_ms REAL DEFAULT 0
      )
    `);
  } catch (error) {
    console.error("[governorTelemetry] Failed to ensure table:", error);
  }
}

export function insertGovernorTelemetryRow(row: GovernorTelemetry): void {
  try {
    const db = getDbInstance();
    ensureGovernorTelemetryTable();

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
      row.actualPromptTokens ?? 0,
      row.actualOutputTokens ?? 0,
      row.actualTotalTokens ?? 0,
      row.estimatedCost ?? null,
      row.latencyMs ?? 0,
      row.retryCount ?? 0,
      row.success ? 1 : 0,
      row.errorCategory ?? null,
      JSON.stringify(row.recommendation),
      row.decisionLatencyMs ?? 0
    );
  } catch (error) {
    // Best-effort telemetry: failure to persist NEVER impacts an AI request
    console.warn("[governorTelemetry] Best-effort telemetry write failed:", error);
  }
}

export function queryGovernorTelemetryRows(limit = 100): GovernorTelemetry[] {
  try {
    const db = getDbInstance();
    ensureGovernorTelemetryTable();

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
      actual_prompt_tokens: number;
      actual_output_tokens: number;
      actual_total_tokens: number;
      estimated_cost: number | null;
      latency_ms: number;
      retry_count: number;
      success: number;
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
      success: Boolean(r.success),
      errorCategory: r.error_category ?? undefined,
      recommendation: JSON.parse(r.recommendation_json),
      decisionLatencyMs: r.decision_latency_ms,
    }));
  } catch {
    return [];
  }
}
