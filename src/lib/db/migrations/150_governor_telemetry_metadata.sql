ALTER TABLE governor_telemetry ADD COLUMN governor_name TEXT;
ALTER TABLE governor_telemetry ADD COLUMN governor_version TEXT;
ALTER TABLE governor_telemetry ADD COLUMN policy_version TEXT;
ALTER TABLE governor_telemetry ADD COLUMN observed_features_json TEXT;
