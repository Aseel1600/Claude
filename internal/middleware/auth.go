package middleware

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"strings"

	"github.com/omniroute/omniroute/internal/db"
)

type contextKey string

const apiKeyContextKey contextKey = "api_key_metadata"

// APIKeyFromContext extracts the validated API key metadata from the request context.
// Returns nil if no key was attached (e.g., auth was bypassed).
func APIKeyFromContext(ctx context.Context) map[string]interface{} {
	v, _ := ctx.Value(apiKeyContextKey).(map[string]interface{})
	return v
}

// Auth validates the Bearer token from the Authorization header against the DB.
// If REQUIRE_API_KEY is not set or empty, authentication is bypassed (anonymous access).
func Auth(next http.Handler) http.Handler {
	requireKey := os.Getenv("REQUIRE_API_KEY")

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Skip auth for health probes
		path := r.URL.Path
		if path == "/health" || path == "/healthz" {
			next.ServeHTTP(w, r)
			return
		}

		// If auth is disabled, pass through
		if requireKey == "" || requireKey == "false" {
			next.ServeHTTP(w, r)
			return
		}

		rawKey := extractBearerToken(r)
		if rawKey == "" {
			writeAuthError(w, http.StatusUnauthorized, "missing or malformed Authorization header")
			return
		}

		valid, meta, err := db.ValidateAPIKey(rawKey)
		if err != nil {
			writeAuthError(w, http.StatusInternalServerError, "authentication service error")
			return
		}
		if !valid || meta == nil {
			writeAuthError(w, http.StatusUnauthorized, "invalid API key")
			return
		}

		ctx := context.WithValue(r.Context(), apiKeyContextKey, meta)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// extractBearerToken pulls the token from "Authorization: Bearer <token>".
func extractBearerToken(r *http.Request) string {
	h := r.Header.Get("Authorization")
	if h == "" {
		return ""
	}

	const prefix = "Bearer "
	if !strings.HasPrefix(h, prefix) {
		return ""
	}

	token := strings.TrimSpace(h[len(prefix):])
	if token == "" {
		return ""
	}
	return token
}

func writeAuthError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	type authErrResp struct {
		Error struct {
			Message string `json:"message"`
			Type    string `json:"type"`
		} `json:"error"`
	}
	resp := authErrResp{}
	resp.Error.Message = message
	resp.Error.Type = "invalid_request_error"
	json.NewEncoder(w).Encode(resp)
}
