-- 134_connection_billing_mode.sql
-- Optional billing classification per connection: FREE (no cost), PLAN
-- (subscription / flat-rate with quota), METERED (pay-per-use).
-- NULL means "auto / legacy behavior" — scoring uses the public catalog price
-- exactly as before, so existing connections are unaffected.

ALTER TABLE provider_connections ADD COLUMN billing_mode TEXT DEFAULT NULL;
