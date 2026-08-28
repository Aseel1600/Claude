/**
 * BigQuery log-export destination.
 *
 * Ships call logs through the BigQuery streaming API (`tabledata.insertAll`) using a
 * service-account key. Each row carries `insertId = call log id`, so a retried batch
 * after a partial network failure is de-duplicated by BigQuery instead of double-counted.
 *
 * Talks raw REST (see ../googleServiceAccount.ts for why there is no Google SDK here).
 */

import { z } from "zod";
import {
  getServiceAccountAccessToken,
  parseServiceAccountKey,
  type ServiceAccountKey,
} from "../googleServiceAccount";
import type {
  LogExportClient,
  LogExportConfigField,
  LogExportDestinationType,
  LogExportRecord,
  LogExportTestResult,
} from "../types";

const BIGQUERY_SCOPE = "https://www.googleapis.com/auth/bigquery";
const BIGQUERY_API = "https://bigquery.googleapis.com/bigquery/v2";
const NAME_PATTERN = /^[A-Za-z0-9_]+$/;
/** BigQuery's own recommendation for rows per insertAll call. */
const INSERT_CHUNK_SIZE = 500;
/** Statuses worth another attempt inside the same run; everything else is terminal. */
const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const MAX_INSERT_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 500;

export const bigQueryConfigSchema = z.object({
  projectId: z.string().min(1).max(200),
  datasetId: z.string().min(1).max(1024).regex(NAME_PATTERN, "Dataset id must match [A-Za-z0-9_]+"),
  tableId: z.string().min(1).max(1024).regex(NAME_PATTERN, "Table id must match [A-Za-z0-9_]+"),
  location: z.string().min(1).max(64).default("EU"),
  serviceAccountJson: z.string().min(1),
  autoCreate: z.boolean().default(true),
});

export type BigQueryConfig = z.infer<typeof bigQueryConfigSchema>;

const FIELDS: readonly LogExportConfigField[] = [
  {
    key: "projectId",
    labelFallback: "GCP project id",
    type: "text",
    required: true,
    placeholder: "my-gcp-project",
  },
  {
    key: "datasetId",
    labelFallback: "Dataset id",
    type: "text",
    required: true,
    placeholder: "omniroute",
  },
  {
    key: "tableId",
    labelFallback: "Table id",
    type: "text",
    required: true,
    placeholder: "call_logs",
  },
  {
    key: "location",
    labelFallback: "Dataset location",
    type: "text",
    required: true,
    placeholder: "EU",
    helpFallback: "Only used when the dataset has to be created.",
  },
  {
    key: "serviceAccountJson",
    labelFallback: "Service account key (JSON)",
    type: "textarea",
    required: true,
    secret: true,
    helpFallback: "Needs BigQuery Data Editor on the dataset. Stored encrypted, never returned.",
  },
  {
    key: "autoCreate",
    labelFallback: "Create dataset and table if missing",
    type: "boolean",
  },
];

/** BigQuery table schema, one column per Logs-dashboard field. */
export const BIGQUERY_TABLE_SCHEMA = {
  fields: [
    { name: "id", type: "STRING", mode: "REQUIRED" },
    { name: "timestamp", type: "TIMESTAMP", mode: "NULLABLE" },
    { name: "method", type: "STRING", mode: "NULLABLE" },
    { name: "path", type: "STRING", mode: "NULLABLE" },
    { name: "status", type: "INT64", mode: "NULLABLE" },
    { name: "model", type: "STRING", mode: "NULLABLE" },
    { name: "requested_model", type: "STRING", mode: "NULLABLE" },
    { name: "provider", type: "STRING", mode: "NULLABLE" },
    { name: "provider_display", type: "STRING", mode: "NULLABLE" },
    { name: "account", type: "STRING", mode: "NULLABLE" },
    { name: "connection_id", type: "STRING", mode: "NULLABLE" },
    { name: "duration_ms", type: "INT64", mode: "NULLABLE" },
    { name: "tokens_in", type: "INT64", mode: "NULLABLE" },
    { name: "tokens_out", type: "INT64", mode: "NULLABLE" },
    { name: "tokens_cache_read", type: "INT64", mode: "NULLABLE" },
    { name: "tokens_cache_write", type: "INT64", mode: "NULLABLE" },
    { name: "tokens_reasoning", type: "INT64", mode: "NULLABLE" },
    { name: "tokens_compressed", type: "INT64", mode: "NULLABLE" },
    { name: "cache_source", type: "STRING", mode: "NULLABLE" },
    { name: "request_type", type: "STRING", mode: "NULLABLE" },
    { name: "source_format", type: "STRING", mode: "NULLABLE" },
    { name: "target_format", type: "STRING", mode: "NULLABLE" },
    { name: "api_key_id", type: "STRING", mode: "NULLABLE" },
    { name: "api_key_name", type: "STRING", mode: "NULLABLE" },
    { name: "combo_name", type: "STRING", mode: "NULLABLE" },
    { name: "combo_step_id", type: "STRING", mode: "NULLABLE" },
    { name: "combo_execution_key", type: "STRING", mode: "NULLABLE" },
    { name: "error_summary", type: "STRING", mode: "NULLABLE" },
    { name: "error_type", type: "STRING", mode: "NULLABLE" },
    { name: "correlation_id", type: "STRING", mode: "NULLABLE" },
    { name: "session_tag", type: "STRING", mode: "NULLABLE" },
    { name: "model_pinned", type: "BOOL", mode: "NULLABLE" },
    { name: "detail_state", type: "STRING", mode: "NULLABLE" },
    { name: "has_request_body", type: "BOOL", mode: "NULLABLE" },
    { name: "has_response_body", type: "BOOL", mode: "NULLABLE" },
    { name: "has_pipeline_details", type: "BOOL", mode: "NULLABLE" },
    { name: "exported_at", type: "TIMESTAMP", mode: "NULLABLE" },
  ],
} as const;

/** Project a canonical export record onto the BigQuery column names. */
export function toBigQueryRow(record: LogExportRecord, exportedAt: string) {
  return {
    id: record.id,
    timestamp: record.timestamp,
    method: record.method,
    path: record.path,
    status: record.status,
    model: record.model,
    requested_model: record.requestedModel,
    provider: record.provider,
    provider_display: record.providerDisplay,
    account: record.account,
    connection_id: record.connectionId,
    duration_ms: record.duration,
    tokens_in: record.tokensIn,
    tokens_out: record.tokensOut,
    tokens_cache_read: record.tokensCacheRead,
    tokens_cache_write: record.tokensCacheWrite,
    tokens_reasoning: record.tokensReasoning,
    tokens_compressed: record.tokensCompressed,
    cache_source: record.cacheSource,
    request_type: record.requestType,
    source_format: record.sourceFormat,
    target_format: record.targetFormat,
    api_key_id: record.apiKeyId,
    api_key_name: record.apiKeyName,
    combo_name: record.comboName,
    combo_step_id: record.comboStepId,
    combo_execution_key: record.comboExecutionKey,
    error_summary: record.errorSummary,
    error_type: record.errorType,
    correlation_id: record.correlationId,
    session_tag: record.sessionTag,
    model_pinned: record.modelPinned,
    detail_state: record.detailState,
    has_request_body: record.hasRequestBody,
    has_response_body: record.hasResponseBody,
    has_pipeline_details: record.hasPipelineDetails,
    exported_at: exportedAt,
  };
}

interface BigQueryResponseBody {
  error?: { message?: string; status?: string };
  insertErrors?: Array<{ index?: number; errors?: Array<{ message?: string }> }>;
}

interface BigQueryResponse {
  ok: boolean;
  status: number;
  json: BigQueryResponseBody | null;
}

function describeFailure(status: number, body: BigQueryResponseBody | null): string {
  const message = body?.error?.message;
  if (message) return message;
  return `BigQuery request failed with HTTP ${status}`;
}

class BigQueryClient implements LogExportClient {
  private readonly key: ServiceAccountKey;

  constructor(
    private readonly config: BigQueryConfig,
    private readonly fetchImpl: typeof fetch = fetch
  ) {
    this.key = parseServiceAccountKey(config.serviceAccountJson);
  }

  private async request(method: string, path: string, body?: unknown): Promise<BigQueryResponse> {
    const token = await getServiceAccountAccessToken(this.key, BIGQUERY_SCOPE, this.fetchImpl);
    const response = await this.fetchImpl(`${BIGQUERY_API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = (await response.json().catch(() => null)) as BigQueryResponseBody | null;
    return { ok: response.ok, status: response.status, json };
  }

  private get datasetPath(): string {
    return `/projects/${encodeURIComponent(this.config.projectId)}/datasets/${encodeURIComponent(this.config.datasetId)}`;
  }

  private get tablePath(): string {
    return `${this.datasetPath}/tables/${encodeURIComponent(this.config.tableId)}`;
  }

  async test(): Promise<LogExportTestResult> {
    const dataset = await this.request("GET", this.datasetPath);
    if (!dataset.ok) {
      if (dataset.status === 404) {
        return this.config.autoCreate
          ? {
              ok: true,
              detail: `Authenticated as ${this.key.client_email}. Dataset ${this.config.datasetId} does not exist yet and will be created on the first export.`,
            }
          : {
              ok: false,
              detail: `Dataset ${this.config.datasetId} not found and auto-create is off.`,
            };
      }
      return { ok: false, detail: describeFailure(dataset.status, dataset.json) };
    }

    const table = await this.request("GET", this.tablePath);
    if (table.ok) {
      return {
        ok: true,
        detail: `Authenticated as ${this.key.client_email}. Table ${this.config.datasetId}.${this.config.tableId} is reachable.`,
      };
    }
    if (table.status === 404) {
      return this.config.autoCreate
        ? {
            ok: true,
            detail: `Authenticated as ${this.key.client_email}. Table ${this.config.tableId} will be created on the first export.`,
          }
        : { ok: false, detail: `Table ${this.config.tableId} not found and auto-create is off.` };
    }
    return { ok: false, detail: describeFailure(table.status, table.json) };
  }

  async prepare(): Promise<void> {
    const table = await this.request("GET", this.tablePath);
    if (table.ok) return;
    if (table.status !== 404) throw new Error(describeFailure(table.status, table.json));
    if (!this.config.autoCreate) {
      throw new Error(
        `Table ${this.config.datasetId}.${this.config.tableId} does not exist and auto-create is off`
      );
    }

    const dataset = await this.request("GET", this.datasetPath);
    if (!dataset.ok) {
      if (dataset.status !== 404) throw new Error(describeFailure(dataset.status, dataset.json));
      const created = await this.request(
        "POST",
        `/projects/${encodeURIComponent(this.config.projectId)}/datasets`,
        {
          datasetReference: {
            projectId: this.config.projectId,
            datasetId: this.config.datasetId,
          },
          location: this.config.location,
        }
      );
      // 409 means a parallel run won the race, which is the outcome we wanted anyway.
      if (!created.ok && created.status !== 409) {
        throw new Error(describeFailure(created.status, created.json));
      }
    }

    const createdTable = await this.request("POST", `${this.datasetPath}/tables`, {
      tableReference: {
        projectId: this.config.projectId,
        datasetId: this.config.datasetId,
        tableId: this.config.tableId,
      },
      schema: BIGQUERY_TABLE_SCHEMA,
      timePartitioning: { type: "DAY", field: "timestamp" },
    });
    if (!createdTable.ok && createdTable.status !== 409) {
      throw new Error(describeFailure(createdTable.status, createdTable.json));
    }
  }

  async send(records: readonly LogExportRecord[]): Promise<void> {
    if (records.length === 0) return;
    const exportedAt = new Date().toISOString();
    // The caller's batch size is a cursor unit, not an HTTP limit. insertAll caps a
    // request at 10 MB and BigQuery recommends at most 500 rows per call, so a large
    // configured batch is chunked here rather than constraining the generic runner.
    for (let offset = 0; offset < records.length; offset += INSERT_CHUNK_SIZE) {
      await this.insertChunk(records.slice(offset, offset + INSERT_CHUNK_SIZE), exportedAt);
    }
  }

  /**
   * One insertAll call, retried on transient upstream failures. Every row carries the
   * call-log id as its insertId, so a retried chunk is de-duplicated by BigQuery rather
   * than written twice. Permanent failures (auth, missing table, bad schema) throw on
   * the first attempt instead of burning the run's time budget.
   */
  private async insertChunk(records: readonly LogExportRecord[], exportedAt: string) {
    const body = {
      kind: "bigquery#tableDataInsertAllRequest",
      skipInvalidRows: false,
      ignoreUnknownValues: false,
      rows: records.map((record) => ({
        insertId: record.id,
        json: toBigQueryRow(record, exportedAt),
      })),
    };

    for (let attempt = 1; ; attempt++) {
      const response = await this.request("POST", `${this.tablePath}/insertAll`, body);

      if (!response.ok) {
        const retryable = RETRYABLE_STATUSES.has(response.status);
        if (!retryable || attempt >= MAX_INSERT_ATTEMPTS) {
          throw new Error(describeFailure(response.status, response.json));
        }
        await this.sleep(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
        continue;
      }

      // A partial failure comes back as HTTP 200 with insertErrors: throwing here is
      // what keeps the cursor from advancing past rows BigQuery never accepted.
      const insertErrors = response.json?.insertErrors;
      if (Array.isArray(insertErrors) && insertErrors.length > 0) {
        const first = insertErrors[0]?.errors?.[0]?.message ?? "unknown insert error";
        throw new Error(
          `BigQuery rejected ${insertErrors.length} of ${records.length} rows: ${first}`
        );
      }
      return;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      timer.unref?.();
    });
  }
}

export const bigQueryDestination: LogExportDestinationType<BigQueryConfig> = {
  id: "bigquery",
  labelFallback: "Google BigQuery",
  descriptionFallback:
    "Stream call logs into a BigQuery table with a service account. Batches are inserted hourly.",
  docsUrl: "https://cloud.google.com/bigquery/docs/streaming-data-into-bigquery",
  secretFields: ["serviceAccountJson"],
  fields: FIELDS,
  configSchema: bigQueryConfigSchema,
  createClient: (config) => new BigQueryClient(config),
};

/** Test seam: build a client over an injected fetch. */
export function createBigQueryClientForTest(
  config: BigQueryConfig,
  fetchImpl: typeof fetch
): LogExportClient {
  return new BigQueryClient(config, fetchImpl);
}
