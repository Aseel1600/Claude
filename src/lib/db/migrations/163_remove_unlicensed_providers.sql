-- 163_remove_unlicensed_providers.sql
-- The Raycast Relay, Hailuo Web, Felo Web, and Qwen Web integrations are no
-- longer distributed by OmniRoute. Remove their executable/current
-- configuration and historical runtime aliases without erasing request,
-- usage, quota-snapshot, or call-log history.
--
-- The temporary connection ledger keeps every cleanup predicate exact. It
-- deliberately avoids broad substring matches such as `%rc%`, which would hit
-- unrelated provider/model names.

DROP TABLE IF EXISTS temp._omniroute_removed_provider_connections;
DROP TABLE IF EXISTS temp._omniroute_removed_provider_ids;

CREATE TEMP TABLE _omniroute_removed_provider_ids (
  provider_id TEXT PRIMARY KEY
) WITHOUT ROWID;

INSERT INTO _omniroute_removed_provider_ids (provider_id)
VALUES
  ('raycast'),
  ('rc'),
  ('hailuo-web'),
  ('felo-web'),
  ('felo'),
  ('qwen-web'),
  ('qw'),
  ('microsoft-designer-web'),
  ('msdesigner');

CREATE TEMP TABLE _omniroute_removed_provider_connections (
  connection_id TEXT PRIMARY KEY
) WITHOUT ROWID;

INSERT OR IGNORE INTO _omniroute_removed_provider_connections (connection_id)
SELECT id
FROM provider_connections
WHERE provider IN (SELECT provider_id FROM _omniroute_removed_provider_ids);

-- Leases are historical/auditable records. End active leases instead of
-- deleting them, so operators can still explain why a lease stopped.
UPDATE exclusive_connection_leases
SET state = 'INVALIDATED',
    ended_at = COALESCE(ended_at, datetime('now')),
    end_reason = COALESCE(end_reason, 'provider removed in v3.8.50')
WHERE state = 'ACTIVE'
  AND (
    provider IN (SELECT provider_id FROM _omniroute_removed_provider_ids)
    OR connection_id IN (
      SELECT connection_id FROM _omniroute_removed_provider_connections
    )
  );

-- A multi-connection quota pool survives when it still has another member.
-- Provider-only pools are removed together with their non-historical policy.
DELETE FROM quota_pool_connections
WHERE connection_id IN (
  SELECT connection_id FROM _omniroute_removed_provider_connections
);

UPDATE quota_pools
SET connection_id = (
  SELECT MIN(membership.connection_id)
  FROM quota_pool_connections AS membership
  WHERE membership.pool_id = quota_pools.id
)
WHERE connection_id IN (
    SELECT connection_id FROM _omniroute_removed_provider_connections
  )
  AND EXISTS (
    SELECT 1
    FROM quota_pool_connections AS membership
    WHERE membership.pool_id = quota_pools.id
  );

DELETE FROM quota_allocation_model_caps
WHERE pool_id IN (
  SELECT id
  FROM quota_pools
  WHERE connection_id IN (
      SELECT connection_id FROM _omniroute_removed_provider_connections
    )
    AND NOT EXISTS (
      SELECT 1
      FROM quota_pool_connections AS membership
      WHERE membership.pool_id = quota_pools.id
    )
);

DELETE FROM quota_allocations
WHERE pool_id IN (
  SELECT id
  FROM quota_pools
  WHERE connection_id IN (
      SELECT connection_id FROM _omniroute_removed_provider_connections
    )
    AND NOT EXISTS (
      SELECT 1
      FROM quota_pool_connections AS membership
      WHERE membership.pool_id = quota_pools.id
    )
);

DELETE FROM quota_pools
WHERE connection_id IN (
    SELECT connection_id FROM _omniroute_removed_provider_connections
  )
  AND NOT EXISTS (
    SELECT 1
    FROM quota_pool_connections AS membership
    WHERE membership.pool_id = quota_pools.id
  );

DELETE FROM provider_quota_state
WHERE connection_id IN (
  SELECT connection_id FROM _omniroute_removed_provider_connections
);

DELETE FROM connection_runtime_state
WHERE connection_id IN (
  SELECT connection_id FROM _omniroute_removed_provider_connections
);

DELETE FROM auto_candidate_overrides
WHERE connection_id IN (
  SELECT connection_id FROM _omniroute_removed_provider_connections
);

DELETE FROM reasoning_routing_rules
WHERE connection_id IN (
    SELECT connection_id FROM _omniroute_removed_provider_connections
  )
  OR EXISTS (
    SELECT 1
    FROM _omniroute_removed_provider_ids AS removed
    WHERE target_model = removed.provider_id
      OR substr(target_model, 1, length(removed.provider_id) + 1) = removed.provider_id || '/'
      OR model_pattern = removed.provider_id
      OR substr(model_pattern, 1, length(removed.provider_id) + 1) = removed.provider_id || '/'
  );

DELETE FROM provider_plans
WHERE provider IN (SELECT provider_id FROM _omniroute_removed_provider_ids)
  OR connection_id IN (
    SELECT connection_id FROM _omniroute_removed_provider_connections
  );

DELETE FROM session_account_affinity
WHERE provider IN (SELECT provider_id FROM _omniroute_removed_provider_ids)
  OR connection_id IN (
    SELECT connection_id FROM _omniroute_removed_provider_connections
  );

DELETE FROM combo_adaptation_state
WHERE provider_id IN (SELECT provider_id FROM _omniroute_removed_provider_ids);

DELETE FROM tier_assignments
WHERE provider IN (SELECT provider_id FROM _omniroute_removed_provider_ids);

DELETE FROM model_context_overrides
WHERE provider IN (SELECT provider_id FROM _omniroute_removed_provider_ids);

DELETE FROM model_capability_overrides
WHERE provider IN (SELECT provider_id FROM _omniroute_removed_provider_ids);

DELETE FROM group_model_permissions
WHERE provider IN (SELECT provider_id FROM _omniroute_removed_provider_ids)
  OR EXISTS (
    SELECT 1
    FROM _omniroute_removed_provider_ids AS removed
    WHERE model_pattern = removed.provider_id
      OR substr(model_pattern, 1, length(removed.provider_id) + 1) = removed.provider_id || '/'
  );

DELETE FROM upstream_proxy_config
WHERE provider_id IN (SELECT provider_id FROM _omniroute_removed_provider_ids);

DELETE FROM radar_local_model_state
WHERE provider IN (SELECT provider_id FROM _omniroute_removed_provider_ids);

DELETE FROM cloud_agent_credentials
WHERE provider_id IN (SELECT provider_id FROM _omniroute_removed_provider_ids);

DELETE FROM domain_circuit_breakers
WHERE name IN (SELECT provider_id FROM _omniroute_removed_provider_ids);

DELETE FROM provider_nodes
WHERE id IN (SELECT provider_id FROM _omniroute_removed_provider_ids);

-- Provider-limit cache keys are connection ids, so remove them before the
-- provider_connections rows disappear.
DELETE FROM key_value
WHERE namespace = 'providerLimitsCache'
  AND key IN (
    SELECT connection_id FROM _omniroute_removed_provider_connections
  );

DELETE FROM key_value
WHERE namespace IN ('customModels', 'modelCompatOverrides', 'providerAliases')
  AND key IN (SELECT provider_id FROM _omniroute_removed_provider_ids);

DELETE FROM key_value
WHERE namespace = 'syncedAvailableModels'
  AND EXISTS (
    SELECT 1
    FROM _omniroute_removed_provider_ids AS removed
    WHERE substr(key, 1, length(removed.provider_id) + 1) = removed.provider_id || ':'
  );

DELETE FROM key_value
WHERE namespace = 'modelAliases'
  AND EXISTS (
    SELECT 1
    FROM _omniroute_removed_provider_ids AS removed
    WHERE value = json_quote(removed.provider_id)
      OR substr(value, 1, length(removed.provider_id) + 2) = '"' || removed.provider_id || '/'
  );

-- Filter retired targets while preserving the rest of each combo object.
-- Invalid legacy JSON is left untouched for the database health repair path.
UPDATE combos
SET data = json_set(
  data,
  '$.models',
  COALESCE(
    (
      SELECT json_group_array(
        CASE
          WHEN entry.type IN ('object', 'array') THEN json(entry.value)
          ELSE entry.value
        END
      )
      FROM json_each(combos.data, '$.models') AS entry
      WHERE CASE
        WHEN entry.type = 'object' THEN NOT (
          COALESCE(json_extract(entry.value, '$.connectionId'), '') IN (
            SELECT connection_id FROM _omniroute_removed_provider_connections
          )
          OR EXISTS (
            SELECT 1
            FROM _omniroute_removed_provider_ids AS removed
            WHERE COALESCE(json_extract(entry.value, '$.provider'), '') = removed.provider_id
              OR COALESCE(json_extract(entry.value, '$.providerId'), '') = removed.provider_id
              OR COALESCE(json_extract(entry.value, '$.model'), '') = removed.provider_id
              OR substr(
                COALESCE(json_extract(entry.value, '$.model'), ''),
                1,
                length(removed.provider_id) + 1
              ) = removed.provider_id || '/'
          )
        )
        WHEN entry.type = 'text' THEN NOT (
          EXISTS (
            SELECT 1
            FROM _omniroute_removed_provider_ids AS removed
            WHERE entry.value = removed.provider_id
              OR substr(entry.value, 1, length(removed.provider_id) + 1) = removed.provider_id || '/'
          )
        )
        ELSE 1
      END
    ),
    json('[]')
  )
)
WHERE CASE
  WHEN json_valid(data) THEN json_type(data, '$.models') = 'array'
  ELSE 0
END;

-- Shadow targets use the same model-entry schema as primary combo targets.
UPDATE combos
SET data = json_set(
  data,
  '$.config.shadowRouting.targets',
  COALESCE(
    (
      SELECT json_group_array(
        CASE
          WHEN entry.type IN ('object', 'array') THEN json(entry.value)
          ELSE entry.value
        END
      )
      FROM json_each(combos.data, '$.config.shadowRouting.targets') AS entry
      WHERE CASE
        WHEN entry.type = 'object' THEN NOT (
          COALESCE(json_extract(entry.value, '$.connectionId'), '') IN (
            SELECT connection_id FROM _omniroute_removed_provider_connections
          )
          OR EXISTS (
            SELECT 1
            FROM _omniroute_removed_provider_ids AS removed
            WHERE COALESCE(json_extract(entry.value, '$.provider'), '') = removed.provider_id
              OR COALESCE(json_extract(entry.value, '$.providerId'), '') = removed.provider_id
              OR COALESCE(json_extract(entry.value, '$.model'), '') = removed.provider_id
              OR substr(
                COALESCE(json_extract(entry.value, '$.model'), ''),
                1,
                length(removed.provider_id) + 1
              ) = removed.provider_id || '/'
          )
        )
        WHEN entry.type = 'text' THEN NOT (
          EXISTS (
            SELECT 1
            FROM _omniroute_removed_provider_ids AS removed
            WHERE entry.value = removed.provider_id
              OR substr(entry.value, 1, length(removed.provider_id) + 1) = removed.provider_id || '/'
          )
        )
        ELSE 1
      END
    ),
    json('[]')
  )
)
WHERE CASE
  WHEN json_valid(data)
    THEN json_type(data, '$.config.shadowRouting.targets') = 'array'
  ELSE 0
END;

-- Provider-only allowlists and handoff lists are arrays of exact provider ids.
UPDATE combos
SET data = json_set(
  data,
  '$.allowedProviders',
  COALESCE(
    (
      SELECT json_group_array(entry.value)
      FROM json_each(combos.data, '$.allowedProviders') AS entry
      WHERE entry.type != 'text'
        OR entry.value NOT IN (SELECT provider_id FROM _omniroute_removed_provider_ids)
    ),
    json('[]')
  )
)
WHERE CASE
  WHEN json_valid(data) THEN json_type(data, '$.allowedProviders') = 'array'
  ELSE 0
END;

UPDATE combos
SET data = json_set(
  data,
  '$.config.handoffProviders',
  COALESCE(
    (
      SELECT json_group_array(entry.value)
      FROM json_each(combos.data, '$.config.handoffProviders') AS entry
      WHERE entry.type != 'text'
        OR entry.value NOT IN (SELECT provider_id FROM _omniroute_removed_provider_ids)
    ),
    json('[]')
  )
)
WHERE CASE
  WHEN json_valid(data) THEN json_type(data, '$.config.handoffProviders') = 'array'
  ELSE 0
END;

-- Fallback policies are current routing configuration, not historical usage.
UPDATE domain_fallback_chains
SET chain = COALESCE(
  (
    SELECT json_group_array(json(entry.value))
    FROM json_each(domain_fallback_chains.chain) AS entry
    WHERE entry.type != 'object'
      OR COALESCE(json_extract(entry.value, '$.provider'), '') NOT IN (
        SELECT provider_id FROM _omniroute_removed_provider_ids
      )
  ),
  json('[]')
)
WHERE CASE
  WHEN json_valid(chain) THEN json_type(chain) = 'array'
  ELSE 0
END;

DELETE FROM domain_fallback_chains
WHERE EXISTS (
  SELECT 1
  FROM _omniroute_removed_provider_ids AS removed
  WHERE model = removed.provider_id
    OR substr(model, 1, length(removed.provider_id) + 1) = removed.provider_id || '/'
);

DELETE FROM provider_connections
WHERE provider IN (SELECT provider_id FROM _omniroute_removed_provider_ids);

DELETE FROM registered_keys
WHERE provider IN (SELECT provider_id FROM _omniroute_removed_provider_ids);

DELETE FROM provider_key_limits
WHERE provider IN (SELECT provider_id FROM _omniroute_removed_provider_ids);

DELETE FROM discovery_results
WHERE provider_id IN (SELECT provider_id FROM _omniroute_removed_provider_ids);

DROP TABLE IF EXISTS temp._omniroute_removed_provider_connections;
DROP TABLE IF EXISTS temp._omniroute_removed_provider_ids;
