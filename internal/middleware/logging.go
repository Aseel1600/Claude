package middleware

import (
	"log/slog"
	"net/http"
	"time"

	"github.com/google/uuid"
)

// responseWriter wraps http.ResponseWriter to capture the status code.
type responseWriter struct {
	http.ResponseWriter
	status int
}

func (rw *responseWriter) WriteHeader(code int) {
	rw.status = code
	rw.ResponseWriter.WriteHeader(code)
}

func (rw *responseWriter) Flush() {
	if f, ok := rw.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

// Logging logs every request with method, path, status code, duration, and a
// correlation ID. The correlation ID is propagated via X-Correlation-Id:
//   - If the client sends one, it is echoed back.
//   - Otherwise a UUID v4 is generated.
func Logging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()

		// Resolve or generate correlation ID
		corrID := r.Header.Get("X-Correlation-Id")
		if corrID == "" {
			corrID = uuid.New().String()
		}
		w.Header().Set("X-Correlation-Id", corrID)

		rw := &responseWriter{ResponseWriter: w, status: http.StatusOK}

		next.ServeHTTP(rw, r)

		slog.Info("request",
			"method", r.Method,
			"path", r.URL.Path,
			"status", rw.status,
			"duration_ms", time.Since(start).Milliseconds(),
			"corr_id", corrID,
			"remote", r.RemoteAddr,
		)
	})
}
