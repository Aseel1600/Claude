-- 135_routing_observations.sql
-- Durable request-level observability for the master router. This captures the
-- initial routing decision and is updated with the final provider/model usage
-- once the request completes.

CREATE TABLE IF NOT EXISTS routing_observations (
  request_id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  requested_model TEXT,
  resolved_model TEXT,
  resolved_combo TEXT,
  combo_strategy TEXT,
  mode TEXT,
  task_type TEXT,
  category TEXT,
  lane TEXT,
  difficulty TEXT,
  tool_use TEXT,
  tools_required INTEGER DEFAULT 0,
  vision_required INTEGER DEFAULT 0,
  complexity TEXT,
  score REAL,
  signals_json TEXT,
  input_tokens_estimated INTEGER,
  selected_provider TEXT,
  selected_model TEXT,
  selected_connection_id TEXT,
  status TEXT,
  success INTEGER,
  latency_ms INTEGER,
  ttft_ms INTEGER,
  tokens_input INTEGER DEFAULT 0,
  tokens_output INTEGER DEFAULT 0,
  tokens_cache_read INTEGER DEFAULT 0,
  tokens_cache_creation INTEGER DEFAULT 0,
  tokens_reasoning INTEGER DEFAULT 0,
  estimated_cost_usd REAL DEFAULT 0,
  pricing_source TEXT,
  fallback_count INTEGER DEFAULT 0,
  attempts_json TEXT,
  error_code TEXT,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_ro_timestamp ON routing_observations(timestamp);
CREATE INDEX IF NOT EXISTS idx_ro_requested_model ON routing_observations(requested_model);
CREATE INDEX IF NOT EXISTS idx_ro_resolved_combo ON routing_observations(resolved_combo);
CREATE INDEX IF NOT EXISTS idx_ro_mode_task_level ON routing_observations(mode, task_type, difficulty);
CREATE INDEX IF NOT EXISTS idx_ro_provider_model ON routing_observations(selected_provider, selected_model);
CREATE INDEX IF NOT EXISTS idx_ro_tools ON routing_observations(tools_required, tool_use);
