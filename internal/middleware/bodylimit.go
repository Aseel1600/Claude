package middleware

import (
	"net/http"
	"strconv"
)

// BodyLimit returns a middleware that rejects POST/PUT/PATCH requests whose
// Content-Length exceeds the given limit in bytes. The check happens before
// the handler reads the body; if Content-Length is missing or zero the
// request is passed through (the actual read-side limit is enforced by
// http.MaxBytesReader in the handlers).
func BodyLimit(maxBytes int64) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Only gate write methods that carry a body.
			switch r.Method {
			case http.MethodPost, http.MethodPut, http.MethodPatch:
				// Content-Length may be absent for chunked / HTTP/2; pass through
				// in that case — the handler-level MaxBytesReader is the hard stop.
				if cl := r.Header.Get("Content-Length"); cl != "" {
					if n, err := strconv.ParseInt(cl, 10, 64); err == nil && n > maxBytes {
						w.Header().Set("Content-Type", "application/json")
						w.Header().Set("Content-Length", "0")
						w.WriteHeader(http.StatusRequestEntityTooLarge)
						return
					}
				}
			}

			next.ServeHTTP(w, r)
		})
	}
}
