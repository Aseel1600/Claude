package server

import (
	"encoding/json"
	"io"
	"net/http"

	"github.com/omniroute/omniroute/internal/db"
)

func handleCombos(w http.ResponseWriter, r *http.Request) {
	if !requireManageScope(w, r) {
		return
	}

	switch r.Method {
	case http.MethodGet:
		handleListCombos(w, r)
	case http.MethodPost:
		handleCreateCombo(w, r)
	default:
		writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"error": map[string]any{"message": "method not allowed"}})
	}
}

func handleComboByID(w http.ResponseWriter, r *http.Request) {
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
		combo, err := db.GetComboByID(id)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": map[string]any{"message": "database error"}})
			return
		}
		if combo == nil {
			writeJSON(w, http.StatusNotFound, map[string]any{"error": map[string]any{"message": "combo not found"}})
			return
		}
		writeJSON(w, http.StatusOK, combo)
	case http.MethodPut:
		handleUpdateCombo(w, r, id)
	case http.MethodDelete:
		if err := db.DeleteCombo(id); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": map[string]any{"message": "failed to delete"}})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"deleted": true})
	default:
		writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"error": map[string]any{"message": "method not allowed"}})
	}
}

func handleListCombos(w http.ResponseWriter, r *http.Request) {
	combos, err := db.GetCombos(0, 0)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": map[string]any{"message": "database error"}})
		return
	}
	if combos == nil {
		combos = []map[string]interface{}{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": combos})
}

func handleCreateCombo(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name string          `json:"name"`
		Data json.RawMessage `json:"data"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": map[string]any{"message": "invalid JSON"}})
		return
	}
	if body.Name == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": map[string]any{"message": "name is required"}})
		return
	}

	// Use raw data bytes or empty object.
	dataStr := string(body.Data)
	if dataStr == "" || dataStr == "null" {
		dataStr = "{}"
	}

	combo, err := db.CreateCombo(body.Name, dataStr)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": map[string]any{"message": "failed to create combo"}})
		return
	}
	writeJSON(w, http.StatusCreated, combo)
}

func handleUpdateCombo(w http.ResponseWriter, r *http.Request, id string) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": map[string]any{"message": "failed to read body"}})
		return
	}

	combo, err := db.UpdateCombo(id, string(body))
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": map[string]any{"message": "failed to update"}})
		return
	}
	if combo == nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": map[string]any{"message": "combo not found"}})
		return
	}
	writeJSON(w, http.StatusOK, combo)
}
