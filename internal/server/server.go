package server

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/omniroute/omniroute/internal/config"
	"github.com/omniroute/omniroute/internal/middleware"
)

// Server wraps an http.Server with pre-configured routing.
type Server struct {
	httpServer *http.Server
	rateLimiter *middleware.RateLimiter
}

// New creates a new Server listening on the given port.
// Routes are wired with the full middleware stack (logging, CORS, auth, body-limit).
func New(port int) *Server {
	mux := http.NewServeMux()

	// ── Health probes (unauthenticated) ──────────────────────────────────
	mux.HandleFunc("GET /health", handleHealth)
	mux.HandleFunc("GET /healthz", handleHealthz)

	// ── OpenAI-compatible v1 API ──────────────────────────────────────────
	mux.HandleFunc("GET /v1", handleListModels)
	mux.HandleFunc("POST /v1/chat/completions", handleChatCompletions)
	mux.HandleFunc("POST /v1/embeddings", handleEmbeddings)
	mux.HandleFunc("POST /v1/images/generations", handleImageGeneration)
	mux.HandleFunc("POST /v1/audio/speech", handleAudioSpeech)
	mux.HandleFunc("POST /v1/audio/transcriptions", handleAudioTranscription)
	mux.HandleFunc("POST /v1/responses", handleResponses)

	// ── Admin CRUD API ───────────────────────────────────────────────────
	mux.HandleFunc("/api/keys", handleKeys)
	mux.HandleFunc("/api/keys/{id}", handleKeyByID)
	mux.HandleFunc("/api/keys/{id}/revoke", handleRevokeKey)
	mux.HandleFunc("/api/connections", handleConnections)
	mux.HandleFunc("/api/connections/{id}", handleConnectionByID)
	mux.HandleFunc("/api/combos", handleCombos)
	mux.HandleFunc("/api/combos/{id}", handleComboByID)
	mux.HandleFunc("/api/settings", handleSettings)
	mux.HandleFunc("/api/settings/{key}", handleSettingsByKey)

	// ── Middleware stack ──────────────────────────────────────────────────
	// Outer → Inner: logging → cors → body-limit → auth → rate-limit → handler
	rl := middleware.NewRateLimiter()
	var handler http.Handler = mux
	handler = middleware.RateLimit(rl)(handler)
	handler = middleware.Auth(handler)
	handler = middleware.BodyLimit(10<<20)(handler) // 10 MB
	handler = middleware.CORS(handler)
	handler = middleware.Logging(handler)

	return &Server{
		httpServer: &http.Server{
			Addr:         fmt.Sprintf(":%d", port),
			Handler:      handler,
			ReadTimeout:  60 * time.Second,
			WriteTimeout: 0, // disabled — SSE streams need unbounded write time
			IdleTimeout:  120 * time.Second,
		},
		rateLimiter: rl,
	}
}

// ListenAndServe starts accepting connections.
func (s *Server) ListenAndServe() error {
	return s.httpServer.ListenAndServe()
}

// Shutdown gracefully shuts down the server.
func (s *Server) Shutdown(ctx context.Context) error {
	if s.rateLimiter != nil {
		s.rateLimiter.Stop()
	}
	return s.httpServer.Shutdown(ctx)
}

// ─── Health handlers ────────────────────────────────────────────────────────

func handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"status":    "ok",
		"timestamp": time.Now().UTC().Format(time.RFC3339),
	})
}

func handleHealthz(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// ─── Stub handlers (to be implemented) ──────────────────────────────────────

func handleListModels(w http.ResponseWriter, r *http.Request) {
	var data []map[string]any
	for _, id := range config.GetRegisteredIDs() {
		entry := config.GetRegistryEntry(id)
		if entry == nil {
			continue
		}
		for _, m := range entry.Models {
			data = append(data, map[string]any{
				"id":       m.ID,
				"object":   "model",
				"owned_by": id,
			})
		}
	}
	if data == nil {
		data = []map[string]any{}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"object": "list",
		"data":   data,
	})
}

func handleAudioSpeech(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusNotImplemented, map[string]any{
		"error": map[string]any{
			"message": "audio speech not yet implemented",
			"type":    "not_implemented",
		},
	})
}

func handleAudioTranscription(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusNotImplemented, map[string]any{
		"error": map[string]any{
			"message": "audio transcription not yet implemented",
			"type":    "not_implemented",
		},
	})
}

// ─── Helpers ────────────────────────────────────────────────────────────────

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := encodeJSON(w, v); err != nil {
		slog.Error("json encode", "error", err)
	}
}
