package middleware

import (
	"encoding/json"
	"net/http"
	"sync"
	"time"
)

// rateLimitEntry tracks request timestamps for a single key.
type rateLimitEntry struct {
	timestamps []time.Time
}

// RateLimiter is an in-memory per-key sliding window rate limiter.
type RateLimiter struct {
	mu      sync.Mutex
	entries map[string]*rateLimitEntry
	stop    chan struct{}
}

// NewRateLimiter creates a rate limiter and starts a background cleanup goroutine.
func NewRateLimiter() *RateLimiter {
	rl := &RateLimiter{
		entries: make(map[string]*rateLimitEntry),
		stop:    make(chan struct{}),
	}
	go rl.cleanup()
	return rl
}

// Stop terminates the background cleanup goroutine.
func (rl *RateLimiter) Stop() {
	close(rl.stop)
}

// Allow checks whether a request from the given key is allowed under the
// specified maxRequestsPerMinute limit. Returns (allowed, retryAfter).
// If maxRequestsPerMinute <= 0, the request is always allowed.
func (rl *RateLimiter) Allow(key string, maxRequestsPerMinute int) (bool, time.Duration) {
	if maxRequestsPerMinute <= 0 {
		return true, 0
	}

	now := time.Now()
	windowStart := now.Add(-1 * time.Minute)

	rl.mu.Lock()
	defer rl.mu.Unlock()

	entry, ok := rl.entries[key]
	if !ok {
		entry = &rateLimitEntry{}
		rl.entries[key] = entry
	}

	// Evict timestamps outside the window.
	cleaned := entry.timestamps[:0]
	for _, ts := range entry.timestamps {
		if ts.After(windowStart) {
			cleaned = append(cleaned, ts)
		}
	}
	entry.timestamps = cleaned

	if len(entry.timestamps) >= maxRequestsPerMinute {
		// Find the oldest timestamp in the window to compute retry-after.
		oldest := entry.timestamps[0]
		retryAfter := oldest.Add(time.Minute).Sub(now)
		if retryAfter < 0 {
			retryAfter = time.Second
		}
		return false, retryAfter
	}

	entry.timestamps = append(entry.timestamps, now)
	return true, 0
}

// cleanup removes stale entries every 5 minutes to prevent memory leaks.
func (rl *RateLimiter) cleanup() {
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			rl.mu.Lock()
			cutoff := time.Now().Add(-2 * time.Minute)
			for k, entry := range rl.entries {
				stale := true
				for _, ts := range entry.timestamps {
					if ts.After(cutoff) {
						stale = false
						break
					}
				}
				if stale {
					delete(rl.entries, k)
				}
			}
			rl.mu.Unlock()
		case <-rl.stop:
			return
		}
	}
}

// RateLimit returns a middleware that enforces per-key rate limits based on
// the "max_requests_per_minute" field from the API key metadata in context.
func RateLimit(rl *RateLimiter) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Extract key ID and rate limit from context metadata.
			meta := APIKeyFromContext(r.Context())
			if meta == nil {
				// No auth context (auth disabled) — pass through.
				next.ServeHTTP(w, r)
				return
			}

			keyID, _ := meta["id"].(string)
			if keyID == "" {
				next.ServeHTTP(w, r)
				return
			}

			// Check max_requests_per_minute from the key metadata.
			rpm := 0
			if v, ok := meta["maxRequestsPerMinute"].(float64); ok {
				rpm = int(v)
			} else if v, ok := meta["maxRequestsPerMinute"].(int); ok {
				rpm = v
			}

			if rpm <= 0 {
				next.ServeHTTP(w, r)
				return
			}

			allowed, retryAfter := rl.Allow(keyID, rpm)
			if !allowed {
				w.Header().Set("Content-Type", "application/json")
				w.Header().Set("Retry-After", formatRetryAfter(retryAfter))
				w.Header().Set("X-RateLimit-Limit", itoa(rpm))
				w.Header().Set("X-RateLimit-Remaining", "0")
				w.WriteHeader(http.StatusTooManyRequests)
				resp := map[string]any{
					"error": map[string]any{
						"message": "rate limit exceeded",
						"type":    "rate_limit_error",
					},
				}
				json.NewEncoder(w).Encode(resp)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

func formatRetryAfter(d time.Duration) string {
	secs := int(d.Seconds())
	if secs < 1 {
		secs = 1
	}
	return itoa(secs)
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	buf := [20]byte{}
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	return string(buf[i:])
}
