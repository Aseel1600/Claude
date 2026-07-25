package server

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/omniroute/omniroute/internal/db"
)

func handleConnections(w http.ResponseWriter, r *http.Request) {
	if !requireManageScope(w, r) {
		return
	}

	switch r.Method {
	case http.MethodGet:
		handleListConnections(w, r)
	case http.MethodPost:
		handleCreateConnection(w, r)
	default:
		writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"error": map[string]any{"message": "method not allowed"}})
	}
}

func handleConnectionByID(w http.ResponseWriter, r *http.Request) {
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
		conn, err := db.GetProviderConnectionByID(id)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": map[string]any{"message": "database error"}})
			return
		}
		if conn == nil {
			writeJSON(w, http.StatusNotFound, map[string]any{"error": map[string]any{"message": "connection not found"}})
			return
		}
		writeJSON(w, http.StatusOK, conn)
	case http.MethodPut:
		handleUpdateConnection(w, r, id)
	case http.MethodDelete:
		if err := db.DeleteProviderConnection(id); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": map[string]any{"message": "failed to delete"}})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"deleted": true})
	default:
		writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"error": map[string]any{"message": "method not allowed"}})
	}
}

func handleListConnections(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	limit, _ := strconv.Atoi(q.Get("limit"))
	offset, _ := strconv.Atoi(q.Get("offset"))
	provider := q.Get("provider")

	var isActive *bool
	if v := q.Get("isActive"); v != "" {
		b := v == "true" || v == "1"
		isActive = &b
	}

	conns, err := db.GetProviderConnections(limit, offset, provider, isActive)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": map[string]any{"message": "database error"}})
		return
	}
	if conns == nil {
		conns = []map[string]interface{}{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": conns})
}

func handleCreateConnection(w http.ResponseWriter, r *http.Request) {
	var data map[string]interface{}
	if err := json.NewDecoder(r.Body).Decode(&data); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": map[string]any{"message": "invalid JSON"}})
		return
	}
	if _, ok := data["provider"].(string); !ok || data["provider"].(string) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": map[string]any{"message": "provider is required"}})
		return
	}

	conn, err := db.CreateProviderConnection(data)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": map[string]any{"message": "failed to create connection"}})
		return
	}
	writeJSON(w, http.StatusCreated, conn)
}

func handleUpdateConnection(w http.ResponseWriter, r *http.Request, id string) {
	var data map[string]interface{}
	if err := json.NewDecoder(r.Body).Decode(&data); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": map[string]any{"message": "invalid JSON"}})
		return
	}

	conn, err := db.UpdateProviderConnection(id, data)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": map[string]any{"message": "failed to update"}})
		return
	}
	if conn == nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": map[string]any{"message": "connection not found"}})
		return
	}
	writeJSON(w, http.StatusOK, conn)
}
