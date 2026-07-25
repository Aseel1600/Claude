package server

import (
	"net/http"
	"os"

	"github.com/omniroute/omniroute/internal/middleware"
)

// requireManageScope checks that the request has a validated API key with "manage" scope.
// Returns true if authorized, writes an error and returns false otherwise.
func requireManageScope(w http.ResponseWriter, r *http.Request) bool {
	// If auth is disabled, allow all.
	if v := os.Getenv("REQUIRE_API_KEY"); v == "" || v == "false" {
		return true
	}

	meta := middleware.APIKeyFromContext(r.Context())
	if meta == nil {
		writeJSON(w, http.StatusUnauthorized, map[string]any{
			"error": map[string]any{"message": "authentication required", "type": "auth_error"},
		})
		return false
	}

	scopes, _ := meta["scopes"].([]string)
	for _, s := range scopes {
		if s == "manage" {
			return true
		}
	}

	writeJSON(w, http.StatusForbidden, map[string]any{
		"error": map[string]any{"message": "manage scope required", "type": "forbidden"},
	})
	return false
}
