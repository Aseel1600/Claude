package server

import (
	"encoding/json"
	"net/http"

	"github.com/omniroute/omniroute/internal/db"
)

func handleSettings(w http.ResponseWriter, r *http.Request) {
	if !requireManageScope(w, r) {
		return
	}

	switch r.Method {
	case http.MethodGet:
		settings, err := db.GetSettings()
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": map[string]any{"message": "database error"}})
			return
		}
		writeJSON(w, http.StatusOK, settings)
	case http.MethodPut:
		var updates map[string]interface{}
		if err := json.NewDecoder(r.Body).Decode(&updates); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": map[string]any{"message": "invalid JSON"}})
			return
		}
		if err := db.UpdateSettings(updates); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": map[string]any{"message": "failed to update settings"}})
			return
		}
		settings, err := db.GetSettings()
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": map[string]any{"message": "database error"}})
			return
		}
		writeJSON(w, http.StatusOK, settings)
	default:
		writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"error": map[string]any{"message": "method not allowed"}})
	}
}

func handleSettingsByKey(w http.ResponseWriter, r *http.Request) {
	if !requireManageScope(w, r) {
		return
	}
	key := r.PathValue("key")
	if key == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": map[string]any{"message": "missing key"}})
		return
	}

	switch r.Method {
	case http.MethodGet:
		val, err := db.GetKeyValue("settings", key)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": map[string]any{"message": "database error"}})
			return
		}
		if val == "" {
			writeJSON(w, http.StatusNotFound, map[string]any{"error": map[string]any{"message": "setting not found"}})
			return
		}
		var parsed interface{}
		if err := json.Unmarshal([]byte(val), &parsed); err != nil {
			parsed = val
		}
		writeJSON(w, http.StatusOK, map[string]any{"key": key, "value": parsed})
	case http.MethodDelete:
		if err := db.DeleteKeyValue("settings", key); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": map[string]any{"message": "failed to delete"}})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"deleted": true})
	default:
		writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"error": map[string]any{"message": "method not allowed"}})
	}
}
