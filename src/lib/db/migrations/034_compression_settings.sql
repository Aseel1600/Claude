-- 034_compression_settings.sql
-- Insert default compression settings into key_value table (namespace='compression')
-- Uses INSERT OR IGNORE so existing user settings are never overwritten by migration replay.

INSERT OR IGNORE INTO key_value (namespace, key, value) VALUES ('compression', 'enabled', 'false');
INSERT OR IGNORE INTO key_value (namespace, key, value) VALUES ('compression', 'defaultMode', '"lite"');
INSERT OR IGNORE INTO key_value (namespace, key, value) VALUES ('compression', 'autoTriggerMode', '"stacked"');
INSERT OR IGNORE INTO key_value (namespace, key, value) VALUES ('compression', 'autoTriggerTokens', '32000');
INSERT OR IGNORE INTO key_value (namespace, key, value) VALUES ('compression', 'cacheMinutes', '5');
INSERT OR IGNORE INTO key_value (namespace, key, value) VALUES ('compression', 'preserveSystemPrompt', 'true');
INSERT OR IGNORE INTO key_value (namespace, key, value) VALUES ('compression', 'comboOverrides', '{}');
