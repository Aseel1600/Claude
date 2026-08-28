/**
 * Call-log source for the log-export pipeline.
 *
 * Reads `call_logs` in insertion order using SQLite's implicit `rowid` as the export
 * cursor. `timestamp` is NOT usable as a cursor: callers may supply their own value
 * (see saveCallLogOperation), so a slow request can be written after a faster one that
 * started later — a timestamp cursor would silently skip it. `rowid` is monotonic for
 * inserts and log rotation only deletes the oldest rows, so the high-water mark never
 * moves backwards except on a full purge, which `getMaxCallLogRowId` detects.
 *
 * The projected record mirrors what the Logs dashboard tab renders (same JOINs, same
 * provider/account resolution helpers) minus the request/response payloads, which live
 * in filesystem artifacts and are governed by the no-log and PII rules.
 */

import { getDbInstance } from "../db/core";
import { applyNodePrefix, resolveProviderDisplay } from "./callLogs";
import type { LogExportRecord, LogExportSourceRow } from "../logExport/types";

const RESOLVED_ACCOUNT_SQL = "COALESCE(NULLIF(pc.name, ''), NULLIF(pc.email, ''), cl.account)";

type ExportSourceRow = {
  row_id: number;
  id: string;
  timestamp: string | null;
  method: string | null;
  path: string | null;
  status: number | null;
  model: string | null;
  requested_model: string | null;
  provider: string | null;
  account: string | null;
  connection_id: string | null;
  duration: number | null;
  tokens_in: number | null;
  tokens_out: number | null;
  tokens_cache_read: number | null;
  tokens_cache_creation: number | null;
  tokens_reasoning: number | null;
  tokens_compressed: number | null;
  cache_source: string | null;
  request_type: string | null;
  source_format: string | null;
  target_format: string | null;
  api_key_id: string | null;
  api_key_name: string | null;
  combo_name: string | null;
  combo_step_id: string | null;
  combo_execution_key: string | null;
  error_summary: string | null;
  error_type: string | null;
  detail_state: string | null;
  has_request_body: number | null;
  has_response_body: number | null;
  has_pipeline_details: number | null;
  correlation_id: string | null;
  model_pinned: number | null;
  session_tag: string | null;
  provider_node_name: string | null;
  provider_node_prefix: string | null;
  resolved_account: string | null;
};

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function mapExportRow(row: ExportSourceRow): LogExportRecord {
  const provider = row.provider;
  return {
    id: row.id,
    timestamp: row.timestamp,
    method: row.method,
    path: row.path,
    status: toNumberOrNull(row.status),
    model: row.model,
    requestedModel: applyNodePrefix(row.requested_model, provider, row.provider_node_prefix),
    provider,
    providerDisplay: resolveProviderDisplay(
      provider,
      row.provider_node_name,
      row.provider_node_prefix
    ),
    account: row.resolved_account || row.account,
    connectionId: row.connection_id,
    duration: toNumberOrNull(row.duration),
    tokensIn: toNumberOrNull(row.tokens_in),
    tokensOut: toNumberOrNull(row.tokens_out),
    tokensCacheRead: toNumberOrNull(row.tokens_cache_read),
    tokensCacheWrite: toNumberOrNull(row.tokens_cache_creation),
    tokensReasoning: toNumberOrNull(row.tokens_reasoning),
    tokensCompressed: toNumberOrNull(row.tokens_compressed),
    cacheSource: row.cache_source || "upstream",
    requestType: row.request_type,
    sourceFormat: row.source_format,
    targetFormat: row.target_format,
    apiKeyId: row.api_key_id,
    apiKeyName: row.api_key_name,
    comboName: row.combo_name,
    comboStepId: row.combo_step_id,
    comboExecutionKey: row.combo_execution_key,
    errorSummary: row.error_summary,
    errorType: row.error_type ?? null,
    correlationId: row.correlation_id || null,
    sessionTag: row.session_tag || null,
    modelPinned: toNumberOrNull(row.model_pinned) === 1,
    detailState: row.detail_state,
    hasRequestBody: toNumberOrNull(row.has_request_body) === 1,
    hasResponseBody: toNumberOrNull(row.has_response_body) === 1,
    hasPipelineDetails: toNumberOrNull(row.has_pipeline_details) === 1,
  };
}

/** Highest rowid currently in `call_logs`, or 0 when the table is empty. */
export function getMaxCallLogRowId(): number {
  const db = getDbInstance();
  const row = db.prepare("SELECT COALESCE(MAX(rowid), 0) AS max_row_id FROM call_logs").get() as {
    max_row_id: number;
  };
  return Number(row?.max_row_id ?? 0);
}

/** Rows still waiting to be exported past `afterRowId`. */
export function countCallLogsAfterRowId(afterRowId: number): number {
  const db = getDbInstance();
  const row = db
    .prepare("SELECT COUNT(*) AS pending FROM call_logs WHERE rowid > ?")
    .get(afterRowId) as { pending: number };
  return Number(row?.pending ?? 0);
}

/** One batch of exportable rows, oldest first, paired with their cursor value. */
export function getCallLogsForExport(afterRowId: number, limit: number): LogExportSourceRow[] {
  const db = getDbInstance();
  const rows = db
    .prepare(
      `SELECT cl.rowid AS row_id, cl.*,
              pn.name AS provider_node_name,
              pn.prefix AS provider_node_prefix,
              ${RESOLVED_ACCOUNT_SQL} AS resolved_account
         FROM call_logs cl
         LEFT JOIN provider_nodes pn ON pn.id = cl.provider
         LEFT JOIN provider_connections pc ON pc.id = cl.connection_id
        WHERE cl.rowid > @afterRowId
        ORDER BY cl.rowid ASC
        LIMIT @limit`
    )
    .all({ afterRowId, limit }) as ExportSourceRow[];

  return rows.map((row) => ({ rowId: Number(row.row_id), record: mapExportRow(row) }));
}
