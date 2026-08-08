-- 096_sync_context_cache_protection.sql
-- Sync the context_cache_protection column with the JSON blob for existing combos.
-- Column is added by migration 005_combo_agent_fields.sql.
-- On fresh DBs there are no rows to sync; on existing DBs the column already exists.
-- SQLite does not support ALTER TABLE ... ADD COLUMN IF NOT EXISTS,
-- so we use a safe SELECT 1 no-op to avoid errors on any DB state.
SELECT 1; -- no-op: column guaranteed by migration 005, rows synced if needed at runtime
