-- Migration 139: proxy_logs.egress_ip (#9291)
--
-- Renumbered from 134 → 139: 134 collided with 134_ccr_blocks.sql (#9061),
-- which made getMigrationFiles() throw a version-collision error and blocked
-- getDbInstance() at startup. The collision threw before any DB could apply
-- this file under 134, so renumbering is safe; the idempotent guard in
-- isSchemaAlreadyApplied(case "139") covers any DB that already has the column.
-- egress_ip: no index by design (not a query dimension) — YAGNI
ALTER TABLE proxy_logs ADD COLUMN egress_ip TEXT;