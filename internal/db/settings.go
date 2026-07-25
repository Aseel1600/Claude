package db

import (
	"database/sql"
	"encoding/json"
	"fmt"
)

// GetSettings reads all key-value pairs from the 'settings' namespace,
// merges them over sensible defaults, and returns the resulting map.
func GetSettings() (map[string]interface{}, error) {
	d := DB()
	rows, err := d.Query("SELECT key, value FROM key_value WHERE namespace = 'settings'")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	settings := defaultSettings()
	for rows.Next() {
		var key, rawValue string
		if err := rows.Scan(&key, &rawValue); err != nil {
			return nil, err
		}
		var parsed interface{}
		if err := json.Unmarshal([]byte(rawValue), &parsed); err != nil {
			parsed = rawValue
		}
		settings[key] = parsed
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return settings, nil
}

// UpdateSettings writes the given key-value pairs into the 'settings' namespace.
// Each value is JSON-serialized before storage.
func UpdateSettings(updates map[string]interface{}) error {
	d := DB()
	tx, err := d.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback() //nolint:errcheck

	stmt, err := tx.Prepare(
		"INSERT OR REPLACE INTO key_value (namespace, key, value) VALUES ('settings', ?, ?)",
	)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for key, value := range updates {
		var raw string
		switch v := value.(type) {
		case string:
			raw = v
		default:
			b, err := json.Marshal(v)
			if err != nil {
				raw = fmt.Sprintf("%v", v)
			} else {
				raw = string(b)
			}
		}
		if _, err := stmt.Exec(key, raw); err != nil {
			return fmt.Errorf("set %s: %w", key, err)
		}
	}
	return tx.Commit()
}

// GetKeyValue reads a single value from the key_value table.
func GetKeyValue(namespace, key string) (string, error) {
	d := DB()
	var value string
	err := d.QueryRow(
		"SELECT value FROM key_value WHERE namespace = ? AND key = ?",
		namespace, key,
	).Scan(&value)
	if err == sql.ErrNoRows {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return value, nil
}

// SetKeyValue writes a single value to the key_value table.
func SetKeyValue(namespace, key, value string) error {
	d := DB()
	_, err := d.Exec(
		"INSERT OR REPLACE INTO key_value (namespace, key, value) VALUES (?, ?, ?)",
		namespace, key, value,
	)
	if err != nil {
		return fmt.Errorf("set key_value %s/%s: %w", namespace, key, err)
	}
	return nil
}

// DeleteKeyValue removes a single entry from the key_value table.
func DeleteKeyValue(namespace, key string) error {
	d := DB()
	_, err := d.Exec(
		"DELETE FROM key_value WHERE namespace = ? AND key = ?",
		namespace, key,
	)
	if err != nil {
		return fmt.Errorf("delete key_value %s/%s: %w", namespace, key, err)
	}
	return nil
}

// defaultSettings returns the base defaults that are overridden by persisted values.
func defaultSettings() map[string]interface{} {
	return map[string]interface{}{
		"cloudEnabled":                true,
		"tailscaleEnabled":           false,
		"tailscaleUrl":               "",
		"stickyRoundRobinLimit":      3,
		"disableSessionStickiness":   false,
		"comboStrategy":              "fallback",
		"requestRetry":               3,
		"maxRetryIntervalSec":        30,
		"requireLogin":               true,
		"oidcEnabled":                false,
		"oidcIssuer":                 "",
		"oidcClientId":               "",
		"oidcClientSecret":           "",
		"oidcScopes":                 []string{"openid", "profile", "email"},
		"oidcRedirectPath":           "/api/auth/oidc/callback",
		"mcpEnabled":                 false,
		"a2aEnabled":                 false,
		"proxyEnabled":               true,
		"perKeyProxyEnabled":         false,
		"customSystemPromptEnabled":  false,
		"customSystemPrompt":         "",
		"hidePaidModels":             false,
		"debugMode":                  true,
		"comboConfigMode":            "guided",
		"comboAutoPromoteEnabled":    false,
		"idempotencyWindowMs":        5000,
		"maxBodySizeMb":              20,
	}
}
