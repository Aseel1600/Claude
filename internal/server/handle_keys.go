package server

import (
	"encoding/json"
	"net/http"

	"github.com/omniroute/omniroute/internal/db"
)

func handleKeys(w http.ResponseWriter, r *http.Request) {
	if !requireManageScope(w, r) {
		return
	}

	switch r.Method {
	case http.MethodGet:
		handleListKeys(w, r)
	case http.MethodPost:
		handleCreateKey(w, r)
	default:
		writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"error": map[string]any{"message": "method not allowed"}})
	}
}

func handleKeyByID(w http.ResponseWriter, r *http.Request) {
	if !requireManageScope(w, r) {
		return
	}
	id := r.PathValue("id")
	if id == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": map[string]any{"message": "missing id"}})
		return
	}

	switch r.Method {
	case http.MethodGet:
		key, err := db.GetAPIKeyByID(id)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": map[string]any{"message": "database error"}})
			return
		}
		if key == nil {
			writeJSON(w, http.StatusNotFound, map[string]any{"error": map[string]any{"message": "key not found"}})
			return
		}
		writeJSON(w, http.StatusOK, key)
	case http.MethodPut:
		handleUpdateKey(w, r, id)
	case http.MethodDelete:
		if err := db.DeleteAPIKey(id); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": map[string]any{"message": "failed to delete"}})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"deleted": true})
	default:
		writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"error": map[string]any{"message": "method not allowed"}})
	}
}

func handleRevokeKey(w http.ResponseWriter, r *http.Request) {
	if !requireManageScope(w, r) {
		return
	}
	id := r.PathValue("id")
	if id == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": map[string]any{"message": "missing id"}})
		return
	}
	if err := db.RevokeAPIKey(id); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": map[string]any{"message": "failed to revoke"}})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"revoked": true})
}

func handleListKeys(w http.ResponseWriter, r *http.Request) {
	keys, err := db.GetAPIKeys(0, 0)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": map[string]any{"message": "database error"}})
		return
	}
	if keys == nil {
		keys = []map[string]interface{}{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": keys})
}

func handleCreateKey(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name      string `json:"name"`
		MachineID string `json:"machineId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": map[string]any{"message": "invalid JSON"}})
		return
	}
	if body.Name == "" {
		body.Name = "Untitled Key"
	}

	key, err := db.CreateAPIKey(body.Name, body.MachineID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": map[string]any{"message": "failed to create key"}})
		return
	}
	writeJSON(w, http.StatusCreated, key)
}

func handleUpdateKey(w http.ResponseWriter, r *http.Request, id string) {
	var data map[string]interface{}
	if err := json.NewDecoder(r.Body).Decode(&data); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": map[string]any{"message": "invalid JSON"}})
		return
	}

	key, err := db.UpdateAPIKey(id, data)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": map[string]any{"message": "failed to update"}})
		return
	}
	if key == nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": map[string]any{"message": "key not found"}})
		return
	}
	writeJSON(w, http.StatusOK, key)
}
