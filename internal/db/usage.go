package db

import "fmt"

// RecordUsage inserts a usage record into usage_history.
// Fields like tokens may be 0 if unavailable (e.g., streaming responses).
func RecordUsage(data map[string]interface{}) error {
	d := DB()

	_, err := d.Exec(`
		INSERT INTO usage_history (
			provider, model, connection_id, account_key, account_label,
			api_key_id, api_key_name,
			tokens_input, tokens_output, tokens_cache_read, tokens_cache_creation, tokens_reasoning,
			service_tier, status, success, latency_ms, ttft_ms, error_code, timestamp
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		toStringVal(data, "provider"),
		toStringVal(data, "model"),
		toStringVal(data, "connectionId"),
		toStringVal(data, "accountKey"),
		toStringVal(data, "accountLabel"),
		toStringVal(data, "apiKeyId"),
		toStringVal(data, "apiKeyName"),
		toInt(data["tokensInput"]),
		toInt(data["tokensOutput"]),
		toInt(data["tokensCacheRead"]),
		toInt(data["tokensCacheCreation"]),
		toInt(data["tokensReasoning"]),
		coalesceString(toStringVal(data, "serviceTier"), "standard"),
		toStringVal(data, "status"),
		boolToInt(toBoolDefault(data["success"], true)),
		toInt(data["latencyMs"]),
		toInt(data["ttftMs"]),
		toStringVal(data, "errorCode"),
		toStringVal(data, "timestamp"),
	)
	if err != nil {
		return fmt.Errorf("record usage: %w", err)
	}
	return nil
}
