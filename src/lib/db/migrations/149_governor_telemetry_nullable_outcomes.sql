ALTER TABLE governor_telemetry RENAME TO governor_telemetry_v1;

CREATE TABLE governor_telemetry (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp INTEGER NOT NULL,
  correlation_id TEXT NOT NULL,
  governor_mode TEXT NOT NULL,
  actual_provider TEXT,
  actual_model TEXT,
  actual_routing_strategy TEXT,
  actual_reasoning_config TEXT,
  actual_compression_config TEXT,
  actual_prompt_tokens INTEGER,
  actual_output_tokens INTEGER,
  actual_total_tokens INTEGER,
  estimated_cost REAL,
  latency_ms INTEGER,
  retry_count INTEGER,
  success INTEGER,
  error_category TEXT,
  recommendation_json TEXT NOT NULL,
  decision_latency_ms REAL
);

INSERT INTO governor_telemetry (
  id, timestamp, correlation_id, governor_mode, actual_provider, actual_model,
  actual_routing_strategy, actual_reasoning_config, actual_compression_config,
  actual_prompt_tokens, actual_output_tokens, actual_total_tokens, estimated_cost,
  latency_ms, retry_count, success, error_category, recommendation_json, decision_latency_ms
)
SELECT
  id, timestamp, correlation_id, governor_mode, actual_provider, actual_model,
  actual_routing_strategy, actual_reasoning_config, actual_compression_config,
  actual_prompt_tokens, actual_output_tokens, actual_total_tokens, estimated_cost,
  latency_ms, retry_count, success, error_category, recommendation_json, decision_latency_ms
FROM governor_telemetry_v1;

DROP TABLE governor_telemetry_v1;
