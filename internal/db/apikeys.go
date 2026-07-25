package db

import (
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
)

// GetAPIKeys returns all API keys ordered by created_at, with optional pagination.
func GetAPIKeys(limit, offset int) ([]map[string]interface{}, error) {
	query := "SELECT * FROM api_keys ORDER BY created_at"
	var args []any
	if limit > 0 {
		query += " LIMIT ? OFFSET ?"
		args = append(args, limit, offset)
	}
	return queryRowsToMaps(DB(), query, args...)
}

// GetAPIKeyByID returns a single API key by its ID.
func GetAPIKeyByID(id string) (map[string]interface{}, error) {
	return queryRowToMap(DB(), "SELECT * FROM api_keys WHERE id = ?", id)
}

// CreateAPIKey creates a new API key. Generates a UUID id, a random key string,
// computes its SHA-256 hash, and stores the row. Returns the created key record
// including the plaintext key (shown once).
func CreateAPIKey(name, machineID string) (map[string]interface{}, error) {
	d := DB()
	now := time.Now().UTC().Format(time.RFC3339)
	id := uuid.New().String()

	// Generate a high-entropy key: "sk-" + UUID segments.
	rawKey := "sk-" + uuid.New().String() + uuid.New().String()[:8]

	keyHash := sha256Sum(rawKey)
	keyPrefix := rawKey
	if len(rawKey) > 12 {
		keyPrefix = rawKey[:12]
	}

	_, err := d.Exec(`
		INSERT INTO api_keys (
			id, name, key, key_prefix, key_hash, machine_id,
			allowed_models, no_log, is_active, created_at
		) VALUES (?, ?, ?, ?, ?, ?, '[]', 0, 1, ?)`,
		id, name, rawKey, keyPrefix, keyHash, machineID, now,
	)
	if err != nil {
		return nil, fmt.Errorf("insert api key: %w", err)
	}

	result, err := GetAPIKeyByID(id)
	if err != nil {
		return nil, err
	}
	if result != nil {
		result["key"] = rawKey
	}
	return result, nil
}

// UpdateAPIKey updates mutable fields of an API key by ID.
func UpdateAPIKey(id string, data map[string]interface{}) (map[string]interface{}, error) {
	d := DB()
	now := time.Now().UTC().Format(time.RFC3339)

	existing, err := GetAPIKeyByID(id)
	if err != nil {
		return nil, err
	}
	if existing == nil {
		return nil, nil
	}

	var setClauses []string
	var args []any

	if v, ok := data["name"].(string); ok {
		setClauses = append(setClauses, "name = ?")
		args = append(args, v)
	}
	if v, ok := data["isActive"].(bool); ok {
		setClauses = append(setClauses, "is_active = ?")
		args = append(args, boolToInt(v))
	}
	if v, ok := data["noLog"].(bool); ok {
		setClauses = append(setClauses, "no_log = ?")
		args = append(args, boolToInt(v))
	}
	if v, ok := data["allowedModels"]; ok {
		setClauses = append(setClauses, "allowed_models = ?")
		args = append(args, jsonStringOrEmpty(v))
	}
	if v, ok := data["blockedModels"]; ok {
		setClauses = append(setClauses, "blocked_models = ?")
		args = append(args, jsonStringOrEmpty(v))
	}
	if v, ok := data["scopes"]; ok {
		setClauses = append(setClauses, "scopes = ?")
		args = append(args, jsonStringOrEmpty(v))
	}
	if v, ok := data["maxRequestsPerDay"].(float64); ok {
		setClauses = append(setClauses, "max_requests_per_day = ?")
		args = append(args, int(v))
	}
	if v, ok := data["maxRequestsPerMinute"].(float64); ok {
		setClauses = append(setClauses, "max_requests_per_minute = ?")
		args = append(args, int(v))
	}
	if v, ok := data["expiresAt"].(string); ok {
		setClauses = append(setClauses, "expires_at = ?")
		args = append(args, v)
	}
	if v, ok := data["machineId"].(string); ok {
		setClauses = append(setClauses, "machine_id = ?")
		args = append(args, v)
	}
	if v, ok := data["dailyUsageLimitUsd"].(float64); ok {
		setClauses = append(setClauses, "daily_usage_limit_usd = ?")
		args = append(args, v)
	}
	if v, ok := data["weeklyUsageLimitUsd"].(float64); ok {
		setClauses = append(setClauses, "weekly_usage_limit_usd = ?")
		args = append(args, v)
	}

	if len(setClauses) == 0 {
		return existing, nil
	}

	setClauses = append(setClauses, "last_used_at = last_used_at") // no-op to avoid trailing comma
	_ = now

	query := "UPDATE api_keys SET " + strings.Join(setClauses[:len(setClauses)-1], ", ") + " WHERE id = ?"
	args = append(args, id)

	_, err = d.Exec(query, args...)
	if err != nil {
		return nil, fmt.Errorf("update api key: %w", err)
	}

	return GetAPIKeyByID(id)
}

// RevokeAPIKey marks a key as revoked by setting revoked_at.
func RevokeAPIKey(id string) error {
	d := DB()
	now := time.Now().UTC().Format(time.RFC3339)
	_, err := d.Exec("UPDATE api_keys SET revoked_at = ? WHERE id = ?", now, id)
	return err
}

// ValidateAPIKey checks whether the given key is valid: active, not revoked,
// not banned, and not expired. Returns (valid, metadata, error).
// If the key matches the env-var key (OMNIROUTE_API_KEY / ROUTER_API_KEY),
// it is always valid with synthetic manage-scoped metadata.
func ValidateAPIKey(key string) (bool, map[string]interface{}, error) {
	if key == "" {
		return false, nil, nil
	}

	// Check env-var key first.
	if envKey := getEnvAPIKey(); envKey != "" && key == envKey {
		meta := map[string]interface{}{
			"id":                "env-key",
			"name":              "Environment Key",
			"machineId":         "server-env",
			"isActive":          true,
			"isBanned":          false,
			"scopes":            []string{"manage"},
			"streamDefaultMode": "legacy",
		}
		return true, meta, nil
	}

	d := DB()
	hash := sha256Sum(key)

	row := d.QueryRow(`
		SELECT id, name, machine_id, is_active, is_banned, revoked_at, expires_at, scopes
		FROM api_keys
		WHERE key = ? OR key_hash = ?`,
		key, hash,
	)

	var (
		id        string
		name      string
		machineID string
		isActive  int
		isBanned  int
		revokedAt sql.NullString
		expiresAt sql.NullString
		scopes    sql.NullString
	)
	err := row.Scan(&id, &name, &machineID, &isActive, &isBanned, &revokedAt, &expiresAt, &scopes)
	if err == sql.ErrNoRows {
		return false, nil, nil
	}
	if err != nil {
		return false, nil, fmt.Errorf("scan api key: %w", err)
	}

	if isBanned != 0 {
		return false, nil, nil
	}
	if isActive == 0 {
		return false, nil, nil
	}
	if revokedAt.Valid && revokedAt.String != "" {
		return false, nil, nil
	}
	if expiresAt.Valid && expiresAt.String != "" {
		if t, err := time.Parse(time.RFC3339, expiresAt.String); err == nil && time.Now().UTC().After(t) {
			return false, nil, nil
		}
	}

	meta := map[string]interface{}{
		"id":                id,
		"name":              name,
		"machineId":         machineID,
		"isActive":          isActive == 1,
		"isBanned":          isBanned == 1,
		"revokedAt":         nullString(revokedAt),
		"expiresAt":         nullString(expiresAt),
		"scopes":            parseScopes(scopes),
		"streamDefaultMode": "legacy",
	}

	// Best-effort last_used_at update.
	go func() {
		d.Exec("UPDATE api_keys SET last_used_at = ? WHERE id = ?",
			time.Now().UTC().Format(time.RFC3339), id)
	}()

	return true, meta, nil
}

// DeleteAPIKey removes an API key and its associated domain budget/cost data.
func DeleteAPIKey(id string) error {
	d := DB()
	tx, err := d.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback() //nolint:errcheck

	if _, err := tx.Exec("DELETE FROM api_keys WHERE id = ?", id); err != nil {
		return err
	}
	if _, err := tx.Exec("DELETE FROM domain_budgets WHERE api_key_id = ?", id); err != nil {
		return err
	}
	if _, err := tx.Exec("DELETE FROM domain_cost_history WHERE api_key_id = ?", id); err != nil {
		return err
	}
	return tx.Commit()
}

// ──────── helpers ────────

func sha256Sum(s string) string {
	h := sha256.Sum256([]byte(s))
	return fmt.Sprintf("%x", h)
}

func getEnvAPIKey() string {
	if v := os.Getenv("OMNIROUTE_API_KEY"); v != "" {
		return v
	}
	return os.Getenv("ROUTER_API_KEY")
}

func parseScopes(ns sql.NullString) []string {
	if !ns.Valid || ns.String == "" {
		return []string{}
	}
	var scopes []string
	if err := json.Unmarshal([]byte(ns.String), &scopes); err != nil {
		return []string{}
	}
	return scopes
}
