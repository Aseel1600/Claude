package db

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
)

// GetCombos returns all combos ordered by sort_order, name, with optional pagination.
// Each row's `data` column is parsed and returned as a map.
func GetCombos(limit, offset int) ([]map[string]interface{}, error) {
	query := "SELECT data, sort_order FROM combos ORDER BY sort_order ASC, name COLLATE NOCASE ASC"
	var args []any
	if limit > 0 {
		query += " LIMIT ? OFFSET ?"
		args = append(args, limit, offset)
	}

	d := DB()
	rows, err := d.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []map[string]interface{}
	for rows.Next() {
		var data sql.NullString
		var sortOrder sql.NullInt64
		if err := rows.Scan(&data, &sortOrder); err != nil {
			return nil, err
		}
		if !data.Valid || data.String == "" {
			continue
		}
		parsed := make(map[string]interface{})
		if err := json.Unmarshal([]byte(data.String), &parsed); err != nil {
			continue
		}
		if sortOrder.Valid {
			parsed["sortOrder"] = sortOrder.Int64
		}
		result = append(result, parsed)
	}
	return result, rows.Err()
}

// GetComboByID returns a single combo by ID, parsed from the data JSON column.
func GetComboByID(id string) (map[string]interface{}, error) {
	d := DB()
	var data sql.NullString
	var sortOrder sql.NullInt64
	err := d.QueryRow(
		"SELECT data, sort_order FROM combos WHERE id = ?", id,
	).Scan(&data, &sortOrder)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return parseComboData(data, sortOrder)
}

// GetComboByName returns a single combo by name.
func GetComboByName(name string) (map[string]interface{}, error) {
	d := DB()
	var data sql.NullString
	var sortOrder sql.NullInt64
	err := d.QueryRow(
		"SELECT data, sort_order FROM combos WHERE name = ?", name,
	).Scan(&data, &sortOrder)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return parseComboData(data, sortOrder)
}

// CreateCombo creates a new combo with the given name and JSON data.
func CreateCombo(name, dataJSON string) (map[string]interface{}, error) {
	d := DB()
	now := time.Now().UTC().Format(time.RFC3339)
	id := uuid.New().String()

	// Get next sort order.
	var maxOrder sql.NullInt64
	d.QueryRow("SELECT COALESCE(MAX(sort_order), 0) FROM combos").Scan(&maxOrder)
	sortOrder := int64(0)
	if maxOrder.Valid {
		sortOrder = maxOrder.Int64 + 1
	} else {
		sortOrder = 1
	}

	// Ensure the data JSON contains id and name.
	parsed := make(map[string]interface{})
	if err := json.Unmarshal([]byte(dataJSON), &parsed); err == nil {
		parsed["id"] = id
		parsed["name"] = name
		parsed["createdAt"] = now
		parsed["updatedAt"] = now
		b, _ := json.Marshal(parsed)
		dataJSON = string(b)
	}

	_, err := d.Exec(
		"INSERT INTO combos (id, name, data, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
		id, name, dataJSON, sortOrder, now, now,
	)
	if err != nil {
		return nil, fmt.Errorf("insert combo: %w", err)
	}

	return GetComboByID(id)
}

// UpdateCombo updates an existing combo's data JSON.
func UpdateCombo(id, dataJSON string) (map[string]interface{}, error) {
	d := DB()
	now := time.Now().UTC().Format(time.RFC3339)

	existing, err := GetComboByID(id)
	if err != nil {
		return nil, err
	}
	if existing == nil {
		return nil, nil
	}

	// Sort order: use existing.
	var sortOrder int64
	if so, ok := existing["sortOrder"].(float64); ok {
		sortOrder = int64(so)
	}

	name := ""
	if n, ok := existing["name"].(string); ok {
		name = n
	}
	if n, ok := parsedName(dataJSON); ok && n != "" {
		name = n
	}

	// Merge the new data with the existing.
	parsed := make(map[string]interface{})
	if err := json.Unmarshal([]byte(dataJSON), &parsed); err == nil {
		parsed["id"] = id
		parsed["name"] = name
		parsed["updatedAt"] = now
		b, _ := json.Marshal(parsed)
		dataJSON = string(b)
	}

	_, err = d.Exec(
		"UPDATE combos SET name = ?, data = ?, sort_order = ?, updated_at = ? WHERE id = ?",
		name, dataJSON, sortOrder, now, id,
	)
	if err != nil {
		return nil, fmt.Errorf("update combo: %w", err)
	}

	return GetComboByID(id)
}

// DeleteCombo removes a combo by ID.
func DeleteCombo(id string) error {
	d := DB()
	result, err := d.Exec("DELETE FROM combos WHERE id = ?", id)
	if err != nil {
		return err
	}
	n, _ := result.RowsAffected()
	if n == 0 {
		return fmt.Errorf("combo %s not found", id)
	}
	return nil
}

// ──────── helpers ────────

func parseComboData(data sql.NullString, sortOrder sql.NullInt64) (map[string]interface{}, error) {
	if !data.Valid || data.String == "" {
		return nil, nil
	}
	parsed := make(map[string]interface{})
	if err := json.Unmarshal([]byte(data.String), &parsed); err != nil {
		return nil, nil
	}
	if sortOrder.Valid {
		parsed["sortOrder"] = sortOrder.Int64
	}
	return parsed, nil
}

// parsedName extracts the "name" field from a JSON string.
func parsedName(dataJSON string) (string, bool) {
	var m map[string]interface{}
	if err := json.Unmarshal([]byte(dataJSON), &m); err != nil {
		return "", false
	}
	n, ok := m["name"].(string)
	return n, ok && n != ""
}
