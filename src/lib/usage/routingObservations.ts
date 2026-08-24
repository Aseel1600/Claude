import { getDbInstance, isBuildPhase, isCloud } from "../db/core";
import { ensureRoutingObservationsSchema } from "../db/schemaColumns";

// Keep the hot chat handler independent from the legacy usage migration graph.
const shouldPersistToDisk = !isCloud && !isBuildPhase;

export interface RoutingObservationEntry {
  requestId?: string | null;
  timestamp?: string | null;
  requestedModel?: string | null;
  resolvedModel?: string | null;
  resolvedCombo?: string | null;
  comboStrategy?: string | null;
  mode?: string | null;
  taskType?: string | null;
  category?: string | null;
  lane?: string | null;
  difficulty?: string | null;
  toolUse?: string | null;
  toolsRequired?: boolean | number | null;
  visionRequired?: boolean | number | null;
  complexity?: string | null;
  score?: number | string | null;
  signals?: unknown;
  inputTokensEstimated?: number | string | null;
  selectedProvider?: string | null;
  selectedModel?: string | null;
  selectedConnectionId?: string | null;
  status?: string | null;
  success?: boolean | number | null;
  latencyMs?: number | string | null;
  timeToFirstTokenMs?: number | string | null;
  tokensInput?: number | string | null;
  tokensOutput?: number | string | null;
  tokensCacheRead?: number | string | null;
  tokensCacheCreation?: number | string | null;
  tokensReasoning?: number | string | null;
  estimatedCostUsd?: number | string | null;
  pricingSource?: string | null;
  fallbackCount?: number | string | null;
  attempts?: unknown;
  errorCode?: string | null;
  errorMessage?: string | null;
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function toNumberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function toIntegerOrNull(value: unknown): number | null {
  const parsed = toNumberOrNull(value);
  return parsed === null ? null : Math.trunc(parsed);
}

function toFlag(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  const parsed = toNumberOrNull(value);
  return parsed === null ? null : parsed > 0 ? 1 : 0;
}

function toJsonOrNull(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function coalescingSet(column: string): string {
  return `${column} = COALESCE(excluded.${column}, routing_observations.${column})`;
}

export async function saveRoutingObservation(entry: RoutingObservationEntry): Promise<void> {
  if (!shouldPersistToDisk) return;

  const requestId = toStringOrNull(entry.requestId);
  if (!requestId) return;

  try {
    const db = getDbInstance();
    ensureRoutingObservationsSchema(db);

    const timestamp = toStringOrNull(entry.timestamp) || new Date().toISOString();
    const updatedAt = new Date().toISOString();
    const row = {
      requestId,
      timestamp,
      updatedAt,
      requestedModel: toStringOrNull(entry.requestedModel),
      resolvedModel: toStringOrNull(entry.resolvedModel),
      resolvedCombo: toStringOrNull(entry.resolvedCombo),
      comboStrategy: toStringOrNull(entry.comboStrategy),
      mode: toStringOrNull(entry.mode),
      taskType: toStringOrNull(entry.taskType),
      category: toStringOrNull(entry.category),
      lane: toStringOrNull(entry.lane),
      difficulty: toStringOrNull(entry.difficulty),
      toolUse: toStringOrNull(entry.toolUse),
      toolsRequired: toFlag(entry.toolsRequired),
      visionRequired: toFlag(entry.visionRequired),
      complexity: toStringOrNull(entry.complexity),
      score: toNumberOrNull(entry.score),
      signalsJson: toJsonOrNull(entry.signals),
      inputTokensEstimated: toIntegerOrNull(entry.inputTokensEstimated),
      selectedProvider: toStringOrNull(entry.selectedProvider),
      selectedModel: toStringOrNull(entry.selectedModel),
      selectedConnectionId: toStringOrNull(entry.selectedConnectionId),
      status: toStringOrNull(entry.status),
      success: toFlag(entry.success),
      latencyMs: toIntegerOrNull(entry.latencyMs),
      ttftMs: toIntegerOrNull(entry.timeToFirstTokenMs),
      tokensInput: toIntegerOrNull(entry.tokensInput),
      tokensOutput: toIntegerOrNull(entry.tokensOutput),
      tokensCacheRead: toIntegerOrNull(entry.tokensCacheRead),
      tokensCacheCreation: toIntegerOrNull(entry.tokensCacheCreation),
      tokensReasoning: toIntegerOrNull(entry.tokensReasoning),
      estimatedCostUsd: toNumberOrNull(entry.estimatedCostUsd),
      pricingSource: toStringOrNull(entry.pricingSource),
      fallbackCount: toIntegerOrNull(entry.fallbackCount),
      attemptsJson: toJsonOrNull(entry.attempts),
      errorCode: toStringOrNull(entry.errorCode),
      errorMessage: toStringOrNull(entry.errorMessage),
    };

    db.prepare(
      `
      INSERT INTO routing_observations (
        request_id, timestamp, updated_at, requested_model, resolved_model, resolved_combo,
        combo_strategy, mode, task_type, category, lane, difficulty, tool_use, tools_required,
        vision_required, complexity, score, signals_json, input_tokens_estimated,
        selected_provider, selected_model, selected_connection_id, status, success,
        latency_ms, ttft_ms, tokens_input, tokens_output, tokens_cache_read,
        tokens_cache_creation, tokens_reasoning, estimated_cost_usd, pricing_source,
        fallback_count, attempts_json, error_code, error_message
      )
      VALUES (
        @requestId, @timestamp, @updatedAt, @requestedModel, @resolvedModel, @resolvedCombo,
        @comboStrategy, @mode, @taskType, @category, @lane, @difficulty, @toolUse,
        @toolsRequired, @visionRequired, @complexity, @score,
        @signalsJson, @inputTokensEstimated, @selectedProvider, @selectedModel,
        @selectedConnectionId, @status, @success, @latencyMs, @ttftMs,
        @tokensInput, @tokensOutput, @tokensCacheRead, @tokensCacheCreation, @tokensReasoning,
        @estimatedCostUsd, @pricingSource, @fallbackCount,
        @attemptsJson, @errorCode, @errorMessage
      )
      ON CONFLICT(request_id) DO UPDATE SET
        updated_at = excluded.updated_at,
        ${coalescingSet("requested_model")},
        ${coalescingSet("resolved_model")},
        ${coalescingSet("resolved_combo")},
        ${coalescingSet("combo_strategy")},
        ${coalescingSet("mode")},
        ${coalescingSet("task_type")},
        ${coalescingSet("category")},
        ${coalescingSet("lane")},
        ${coalescingSet("difficulty")},
        ${coalescingSet("tool_use")},
        tools_required = CASE
          WHEN excluded.tools_required IS NOT NULL THEN excluded.tools_required
          ELSE routing_observations.tools_required
        END,
        vision_required = CASE
          WHEN excluded.vision_required IS NOT NULL THEN excluded.vision_required
          ELSE routing_observations.vision_required
        END,
        ${coalescingSet("complexity")},
        ${coalescingSet("score")},
        ${coalescingSet("signals_json")},
        ${coalescingSet("input_tokens_estimated")},
        ${coalescingSet("selected_provider")},
        ${coalescingSet("selected_model")},
        ${coalescingSet("selected_connection_id")},
        ${coalescingSet("status")},
        ${coalescingSet("success")},
        ${coalescingSet("latency_ms")},
        ${coalescingSet("ttft_ms")},
        tokens_input = COALESCE(excluded.tokens_input, routing_observations.tokens_input),
        tokens_output = COALESCE(excluded.tokens_output, routing_observations.tokens_output),
        tokens_cache_read = COALESCE(excluded.tokens_cache_read, routing_observations.tokens_cache_read),
        tokens_cache_creation = COALESCE(excluded.tokens_cache_creation, routing_observations.tokens_cache_creation),
        tokens_reasoning = COALESCE(excluded.tokens_reasoning, routing_observations.tokens_reasoning),
        estimated_cost_usd = COALESCE(excluded.estimated_cost_usd, routing_observations.estimated_cost_usd),
        ${coalescingSet("pricing_source")},
        fallback_count = MAX(COALESCE(routing_observations.fallback_count, 0), COALESCE(excluded.fallback_count, 0)),
        ${coalescingSet("attempts_json")},
        ${coalescingSet("error_code")},
        ${coalescingSet("error_message")}
    `
    ).run(row);
  } catch (error) {
    console.warn("[routingObservations] Failed to save observation:", (error as Error).message);
  }
}
