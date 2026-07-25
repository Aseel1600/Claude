package db

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
)

// GetProviderConnections returns provider connections with optional filtering and pagination.
func GetProviderConnections(limit, offset int, provider string, isActive *bool) ([]map[string]interface{}, error) {
	query := "SELECT * FROM provider_connections"
	var conditions []string
	var args []any

	if provider != "" {
		conditions = append(conditions, "provider = ?")
		args = append(args, provider)
	}
	if isActive != nil {
		conditions = append(conditions, "is_active = ?")
		if *isActive {
			args = append(args, 1)
		} else {
			args = append(args, 0)
		}
	}

	if len(conditions) > 0 {
		query += " WHERE " + joinConditions(conditions)
	}
	query += " ORDER BY priority ASC, updated_at DESC"

	if limit > 0 {
		query += " LIMIT ? OFFSET ?"
		args = append(args, limit, offset)
	}

	return queryRowsToMaps(DB(), query, args...)
}

// GetProviderConnectionByID returns a single provider connection by ID.
func GetProviderConnectionByID(id string) (map[string]interface{}, error) {
	return queryRowToMap(DB(), "SELECT * FROM provider_connections WHERE id = ?", id)
}

// CreateProviderConnection inserts a new provider connection.
// Credential fields (apiKey, accessToken, refreshToken, idToken) are stored as-is.
func CreateProviderConnection(data map[string]interface{}) (map[string]interface{}, error) {
	d := DB()
	now := time.Now().UTC().Format(time.RFC3339)
	id := uuid.New().String()

	provider := toStringVal(data, "provider")
	authType := coalesceString(toStringVal(data, "authType"), "oauth")
	name := toStringVal(data, "name")
	email := toStringVal(data, "email")
	priority := toInt(data["priority"])
	isActive := toBoolDefault(data["isActive"], true)
	accessToken := toStringVal(data, "accessToken")
	refreshToken := toStringVal(data, "refreshToken")
	expiresAt := toStringVal(data, "expiresAt")
	tokenExpiresAt := toStringVal(data, "tokenExpiresAt")
	scope := toStringVal(data, "scope")
	projectId := toStringVal(data, "projectId")
	testStatus := toStringVal(data, "testStatus")
	errorCode := toStringVal(data, "errorCode")
	lastError := toStringVal(data, "lastError")
	lastErrorAt := toStringVal(data, "lastErrorAt")
	lastErrorType := toStringVal(data, "lastErrorType")
	lastErrorSource := toStringVal(data, "lastErrorSource")
	backoffLevel := toInt(data["backoffLevel"])
	rateLimitedUntil := toStringVal(data, "rateLimitedUntil")
	healthCheckInterval := toIntPtr(data["healthCheckInterval"])
	lastHealthCheckAt := toStringVal(data, "lastHealthCheckAt")
	lastTested := toStringVal(data, "lastTested")
	apiKey := toStringVal(data, "apiKey")
	idToken := toStringVal(data, "idToken")
	providerSpecificData := marshalProviderSpecificData(data["providerSpecificData"])
	expiresIn := toIntPtr(data["expiresIn"])
	displayName := toStringVal(data, "displayName")
	globalPriority := toIntPtr(data["globalPriority"])
	defaultModel := toStringVal(data, "defaultModel")
	tokenType := toStringVal(data, "tokenType")
	consecutiveUseCount := toInt(data["consecutiveUseCount"])
	rateLimitProtection := boolToInt(toBoolDefault(data["rateLimitProtection"], false))
	lastUsedAt := toStringVal(data, "lastUsedAt")
	group := toStringVal(data, "group")
	maxConcurrent := toIntPtr(data["maxConcurrent"])
	proxyEnabled := boolToInt(toBoolDefault(data["proxyEnabled"], true))
	perKeyProxyEnabled := boolToInt(toBoolDefault(data["perKeyProxyEnabled"], false))
	quotaVisible := boolToInt(toBoolDefault(data["quotaVisible"], true))
	quotaWindowThresholdsJSON := marshalJSONField(data["quotaWindowThresholds"])
	rateLimitOverridesJSON := marshalJSONField(data["rateLimitOverrides"])

	// Auto-increment priority if not explicitly set.
	if _, ok := data["priority"]; !ok || priority == 0 {
		var maxP sql.NullInt64
		err := d.QueryRow(
			"SELECT MAX(priority) FROM provider_connections WHERE provider = ?", provider,
		).Scan(&maxP)
		if err == nil && maxP.Valid {
			priority = int(maxP.Int64) + 1
		} else {
			priority = 1
		}
	}

	_, err := d.Exec(`
		INSERT INTO provider_connections (
			id, provider, auth_type, name, email, priority, is_active,
			access_token, refresh_token, expires_at, token_expires_at,
			scope, project_id, test_status, error_code, last_error,
			last_error_at, last_error_type, last_error_source, backoff_level,
			rate_limited_until, health_check_interval, last_health_check_at,
			last_tested, api_key, id_token, provider_specific_data,
			expires_in, display_name, global_priority, default_model,
			token_type, consecutive_use_count, rate_limit_protection, last_used_at,
			"group", max_concurrent,
			proxy_enabled, per_key_proxy_enabled, quota_visible,
			quota_window_thresholds_json, rate_limit_overrides_json,
			created_at, updated_at
		) VALUES (
			?, ?, ?, ?, ?, ?, ?,
			?, ?, ?, ?,
			?, ?, ?, ?, ?,
			?, ?, ?, ?,
			?, ?, ?,
			?, ?, ?, ?,
			?, ?, ?, ?,
			?, ?, ?, ?,
			?, ?,
			?, ?, ?,
			?, ?,
			?, ?
		)`,
		id, provider, nullStr(authType), nullStr(name), nullStr(email), priority, boolToInt(isActive),
		nullStr(accessToken), nullStr(refreshToken), nullStr(expiresAt), nullStr(tokenExpiresAt),
		nullStr(scope), nullStr(projectId), nullStr(testStatus), nullStr(errorCode), nullStr(lastError),
		nullStr(lastErrorAt), nullStr(lastErrorType), nullStr(lastErrorSource), backoffLevel,
		nullStr(rateLimitedUntil), healthCheckInterval, nullStr(lastHealthCheckAt),
		nullStr(lastTested), nullStr(apiKey), nullStr(idToken), nullStr(providerSpecificData),
		expiresIn, nullStr(displayName), globalPriority, nullStr(defaultModel),
		nullStr(tokenType), consecutiveUseCount, rateLimitProtection, nullStr(lastUsedAt),
		nullStr(group), maxConcurrent,
		proxyEnabled, perKeyProxyEnabled, quotaVisible,
		quotaWindowThresholdsJSON, rateLimitOverridesJSON,
		now, now,
	)
	if err != nil {
		return nil, fmt.Errorf("insert provider connection: %w", err)
	}

	return GetProviderConnectionByID(id)
}

// UpdateProviderConnection updates an existing provider connection by ID.
func UpdateProviderConnection(id string, data map[string]interface{}) (map[string]interface{}, error) {
	d := DB()
	now := time.Now().UTC().Format(time.RFC3339)

	existing, err := GetProviderConnectionByID(id)
	if err != nil {
		return nil, err
	}
	if existing == nil {
		return nil, nil
	}

	// Merge existing with updates.
	merged := make(map[string]interface{})
	for k, v := range existing {
		merged[k] = v
	}
	for k, v := range data {
		merged[k] = v
	}
	merged["updatedAt"] = now

	var setClauses []string
	var args []any

	// Fields that can be updated from the input map.
	fieldMap := map[string]interface{}{
		"provider":                  toStringVal(merged, "provider"),
		"auth_type":                 toStringVal(merged, "authType"),
		"name":                      toStringVal(merged, "name"),
		"email":                     toStringVal(merged, "email"),
		"priority":                  toInt(merged["priority"]),
		"is_active":                 boolToInt(toBoolDefault(merged["isActive"], true)),
		"access_token":              toStringVal(merged, "accessToken"),
		"refresh_token":             toStringVal(merged, "refreshToken"),
		"expires_at":                toStringVal(merged, "expiresAt"),
		"token_expires_at":          toStringVal(merged, "tokenExpiresAt"),
		"scope":                     toStringVal(merged, "scope"),
		"project_id":                toStringVal(merged, "projectId"),
		"test_status":               toStringVal(merged, "testStatus"),
		"error_code":                toStringVal(merged, "errorCode"),
		"last_error":                toStringVal(merged, "lastError"),
		"last_error_at":             toStringVal(merged, "lastErrorAt"),
		"last_error_type":           toStringVal(merged, "lastErrorType"),
		"last_error_source":         toStringVal(merged, "lastErrorSource"),
		"backoff_level":             toInt(merged["backoffLevel"]),
		"rate_limited_until":        toStringVal(merged, "rateLimitedUntil"),
		"health_check_interval":     toIntPtr(merged["healthCheckInterval"]),
		"last_health_check_at":      toStringVal(merged, "lastHealthCheckAt"),
		"last_tested":               toStringVal(merged, "lastTested"),
		"api_key":                   toStringVal(merged, "apiKey"),
		"id_token":                  toStringVal(merged, "idToken"),
		"provider_specific_data":    marshalProviderSpecificData(merged["providerSpecificData"]),
		"expires_in":                toIntPtr(merged["expiresIn"]),
		"display_name":              toStringVal(merged, "displayName"),
		"global_priority":           toIntPtr(merged["globalPriority"]),
		"default_model":             toStringVal(merged, "defaultModel"),
		"token_type":                toStringVal(merged, "tokenType"),
		"consecutive_use_count":     toInt(merged["consecutiveUseCount"]),
		"rate_limit_protection":     boolToInt(toBoolDefault(merged["rateLimitProtection"], false)),
		"last_used_at":              toStringVal(merged, "lastUsedAt"),
		"max_concurrent":            toIntPtr(merged["maxConcurrent"]),
		"proxy_enabled":             boolToInt(toBoolDefault(merged["proxyEnabled"], true)),
		"per_key_proxy_enabled":     boolToInt(toBoolDefault(merged["perKeyProxyEnabled"], false)),
		"quota_visible":             boolToInt(toBoolDefault(merged["quotaVisible"], true)),
		"quota_window_thresholds_json": marshalJSONField(merged["quotaWindowThresholds"]),
		"rate_limit_overrides_json": marshalJSONField(merged["rateLimitOverrides"]),
	}

	for col, val := range fieldMap {
		setClauses = append(setClauses, col+" = ?")
		args = append(args, val)
	}
	// "group" column — special handling for reserved keyword.
	setClauses = append(setClauses, `"group" = ?`)
	args = append(args, toStringVal(merged, "group"))

	setClauses = append(setClauses, "updated_at = ?")
	args = append(args, now)
	args = append(args, id)

	query := "UPDATE provider_connections SET " + strings.Join(setClauses, ", ") + " WHERE id = ?"
	_, err = d.Exec(query, args...)
	if err != nil {
		return nil, fmt.Errorf("update provider connection: %w", err)
	}

	return GetProviderConnectionByID(id)
}

// DeleteProviderConnection removes a provider connection by ID and its associated quota snapshots.
func DeleteProviderConnection(id string) error {
	d := DB()
	tx, err := d.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback() //nolint:errcheck

	if _, err := tx.Exec("DELETE FROM quota_snapshots WHERE connection_id = ?", id); err != nil {
		return err
	}
	if _, err := tx.Exec("DELETE FROM provider_connections WHERE id = ?", id); err != nil {
		return err
	}
	return tx.Commit()
}

// DeleteProviderConnectionsByProvider removes all connections for a given provider ID.
func DeleteProviderConnectionsByProvider(providerID string) error {
	d := DB()
	// Find connection IDs first.
	rows, err := d.Query("SELECT id FROM provider_connections WHERE provider = ?", providerID)
	if err != nil {
		return err
	}
	defer rows.Close()

	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return err
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return err
	}

	tx, err := d.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback() //nolint:errcheck

	for _, cid := range ids {
		if _, err := tx.Exec("DELETE FROM quota_snapshots WHERE connection_id = ?", cid); err != nil {
			return err
		}
	}
	if _, err := tx.Exec("DELETE FROM provider_connections WHERE provider = ?", providerID); err != nil {
		return err
	}
	return tx.Commit()
}

// ──────── helpers ────────

func toStringVal(m map[string]interface{}, key string) string {
	v, _ := m[key].(string)
	return v
}

func toIntPtr(v interface{}) sql.NullInt64 {
	if v == nil {
		return sql.NullInt64{}
	}
	switch n := v.(type) {
	case int:
		return sql.NullInt64{Int64: int64(n), Valid: true}
	case int64:
		return sql.NullInt64{Int64: n, Valid: true}
	case float64:
		return sql.NullInt64{Int64: int64(n), Valid: true}
	default:
		return sql.NullInt64{}
	}
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

func nullStr(s string) sql.NullString {
	if s == "" {
		return sql.NullString{}
	}
	return sql.NullString{String: s, Valid: true}
}

func marshalProviderSpecificData(v interface{}) string {
	if v == nil {
		return ""
	}
	switch s := v.(type) {
	case string:
		return s
	default:
		b, err := json.Marshal(v)
		if err != nil {
			return ""
		}
		return string(b)
	}
}

func marshalJSONField(v interface{}) sql.NullString {
	if v == nil {
		return sql.NullString{}
	}
	b, err := json.Marshal(v)
	if err != nil {
		return sql.NullString{}
	}
	s := string(b)
	if s == "null" || s == "{}" || s == "[]" {
		return sql.NullString{}
	}
	return sql.NullString{String: s, Valid: true}
}
