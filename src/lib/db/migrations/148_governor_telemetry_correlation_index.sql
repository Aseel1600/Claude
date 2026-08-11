-- Governor V1: keep metadata-only correlation lookups bounded as telemetry grows.
CREATE INDEX IF NOT EXISTS idx_governor_telemetry_correlation_id
  ON governor_telemetry(correlation_id);
