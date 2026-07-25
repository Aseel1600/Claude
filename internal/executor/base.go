package executor

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"math"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/omniroute/omniroute/internal/config"
)

const (
	fetchTimeoutMs       = 60000
	maxRetries           = 2
	initialRetryDelay    = 1 * time.Second
	statusRateLimited    = 429
	statusServerError    = 500
	statusBadGateway     = 502
	statusServiceUnavail = 503
	statusGatewayTimeout = 504
)

// sharedTransport is reused across all executors for connection pooling.
var sharedTransport = &http.Transport{
	MaxIdleConns:        200,
	MaxIdleConnsPerHost: 50,
	IdleConnTimeout:     90 * time.Second,
	DialContext: (&net.Dialer{
		Timeout:   30 * time.Second,
		KeepAlive: 30 * time.Second,
	}).DialContext,
	TLSHandshakeTimeout:   10 * time.Second,
	ResponseHeaderTimeout: 60 * time.Second,
}

// sharedClient is the default HTTP client used by executors.
// No per-request Timeout — the executor controls timeouts via context.
var sharedClient = &http.Client{
	Transport: sharedTransport,
	// Timeout is NOT set here; we control timeouts per-request via context.
}

// defaultClient is the fallback for ConnectUpstreamSSE and other callers.
var defaultClient = &http.Client{
	Timeout:   5 * time.Minute,
	Transport: sharedTransport,
}

type ExecuteInput struct {
	Model                string
	Body                 map[string]any
	Stream               bool
	APIKey               string
	AccessToken          string
	ProviderConfig       *config.RegistryEntry
	ClientHeaders        map[string]string
	UpstreamExtraHeaders map[string]string
	DisableStreamOptions bool
}

type ExecuteResult struct {
	StatusCode int
	Headers    http.Header
	Body       io.ReadCloser
	URL        string
}

type Executor interface {
	Execute(ctx context.Context, input ExecuteInput) (*ExecuteResult, error)
}

type BaseExecutor struct {
	Provider string
	Config   *config.RegistryEntry
}

func NewBaseExecutor(provider string, cfg *config.RegistryEntry) *BaseExecutor {
	if cfg == nil {
		cfg = &config.RegistryEntry{
			ID:         provider,
			Format:     "openai",
			AuthType:   "api_key",
			AuthHeader: "bearer",
		}
	}
	return &BaseExecutor{Provider: provider, Config: cfg}
}

func (e *BaseExecutor) GetBaseURLs() []string {
	if len(e.Config.BaseURLs) > 0 {
		return e.Config.BaseURLs
	}
	if e.Config.BaseURL != "" {
		return []string{e.Config.BaseURL}
	}
	return []string{""}
}

func (e *BaseExecutor) GetTimeoutMs() int {
	if e.Config.TimeoutMs > 0 {
		return e.Config.TimeoutMs
	}
	return fetchTimeoutMs
}

func (e *BaseExecutor) BuildURL(model string, stream bool) string {
	baseURLs := e.GetBaseURLs()
	if len(baseURLs) == 0 {
		return ""
	}
	return baseURLs[0]
}

func (e *BaseExecutor) BuildHeaders(apiKey string, stream bool) http.Header {
	headers := http.Header{}
	headers.Set("Content-Type", "application/json")

	// Merge provider-level configured headers
	for k, v := range e.Config.Headers {
		headers.Set(k, v)
	}

	token := apiKey
	if token == "" {
		token = e.Config.AnonymousApiKey
	}
	if token != "" {
		if e.Config.AuthHeader == "x-api-key" {
			headers.Set("X-Api-Key", token)
		} else if e.Config.AuthHeader == "x-goog-api-key" {
			headers.Set("X-Goog-Api-Key", token)
		} else {
			headers.Set("Authorization", "Bearer "+token)
		}
	}

	if stream {
		headers.Set("Accept", "text/event-stream")
	} else {
		headers.Set("Accept", "application/json")
	}

	return headers
}

func (e *BaseExecutor) TransformRequest(model string, body map[string]any, stream bool) map[string]any {
	if body == nil {
		return body
	}
	cloned := make(map[string]any, len(body))
	for k, v := range body {
		cloned[k] = v
	}

	// Remove empty optional params
	delete(cloned, "prompt_cache_retention")
	for _, key := range []string{"user", "stop", "seed", "response_format"} {
		if v, ok := cloned[key]; ok {
			if s, ok := v.(string); ok && s == "" {
				delete(cloned, key)
			}
		}
	}

	// Sanitize tool descriptions
	if tools, ok := cloned["tools"].([]any); ok {
		sanitized := make([]any, 0, len(tools))
		for _, t := range tools {
			if toolMap, ok := t.(map[string]any); ok {
				if fn, ok := toolMap["function"].(map[string]any); ok {
					newFn := make(map[string]any, len(fn))
					for k, v := range fn {
						newFn[k] = v
					}
					if desc, ok := newFn["description"].(string); ok && desc == "" {
						delete(newFn, "description")
					}
					if name, ok := newFn["name"].(string); ok && strings.TrimSpace(name) == "" {
						newFn["name"] = "unnamed_tool"
					}
					toolMap["function"] = newFn
				}
				sanitized = append(sanitized, toolMap)
			} else {
				sanitized = append(sanitized, t)
			}
		}
		cloned["tools"] = sanitized
	}

	return cloned
}

func (e *BaseExecutor) Execute(ctx context.Context, input ExecuteInput) (*ExecuteResult, error) {
	url := e.BuildURL(input.Model, input.Stream)
	if url == "" {
		return nil, fmt.Errorf("no base URL configured for provider %s", e.Provider)
	}

	headers := e.BuildHeaders(input.APIKey, input.Stream)

	// Merge upstream extra headers
	for k, v := range input.UpstreamExtraHeaders {
		headers.Set(k, v)
	}

	transformedBody := e.TransformRequest(input.Model, input.Body, input.Stream)

	bodyJSON, err := json.Marshal(transformedBody)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request body: %w", err)
	}

	var lastErr error
	var lastStatus int

	for attempt := 0; attempt <= maxRetries; attempt++ {
		if attempt > 0 {
			delay := time.Duration(float64(initialRetryDelay) * math.Pow(2, float64(attempt-1)))
			timer := time.NewTimer(delay)
			select {
			case <-ctx.Done():
				timer.Stop()
				return nil, ctx.Err()
			case <-timer.C:
			}
		}

		req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(bodyJSON))
		if err != nil {
			return nil, fmt.Errorf("failed to create HTTP request: %w", err)
		}
		req.Header = headers

		resp, err := sharedClient.Do(req)
		if err != nil {
			lastErr = err
			continue
		}

		lastStatus = resp.StatusCode

		// Success or non-retryable status
		if resp.StatusCode != statusRateLimited && resp.StatusCode < statusServerError {
			return &ExecuteResult{
				StatusCode: resp.StatusCode,
				Headers:    resp.Header,
				Body:       resp.Body,
				URL:        url,
			}, nil
		}

		// Rate limited or server error — read body to free connection, then retry
		io.Copy(io.Discard, resp.Body)
		resp.Body.Close()

		// Respect Retry-After header for 429s
		retryAfter := parseRetryAfter(resp.Header.Get("Retry-After"))
		if retryAfter > 0 {
			timer := time.NewTimer(retryAfter)
			select {
			case <-ctx.Done():
				timer.Stop()
				return nil, ctx.Err()
			case <-timer.C:
			}
		}

		lastErr = fmt.Errorf("upstream returned HTTP %d", resp.StatusCode)
		slog.Warn("executor retry",
			"provider", e.Provider,
			"status", resp.StatusCode,
			"attempt", attempt+1,
			"url", url,
		)
	}

	if lastErr != nil {
		return nil, fmt.Errorf("request to %s failed after %d attempts (last status %d): %w",
			url, maxRetries+1, lastStatus, lastErr)
	}

	return nil, fmt.Errorf("request to %s failed: all retries exhausted", url)
}

// sanitizePath validates a custom API path to prevent path traversal attacks.
func sanitizePath(path string) bool {
	if !strings.HasPrefix(path, "/") {
		return false
	}
	if strings.Contains(path, "\x00") || strings.Contains(path, "..") {
		return false
	}
	if len(path) > 512 {
		return false
	}
	return true
}

func normalizeOpenAIChatURL(baseUrl string) string {
	base := strings.TrimRight(baseUrl, "/")
	if strings.HasSuffix(base, "/chat/completions") {
		return base
	}
	return base + "/v1/chat/completions"
}

// parseRetryAfter parses the Retry-After header value (seconds or HTTP-date).
// Returns 0 if unparseable.
func parseRetryAfter(val string) time.Duration {
	if val == "" {
		return 0
	}
	// Try integer seconds first
	if secs, err := strconv.Atoi(val); err == nil {
		if secs < 0 {
			secs = 0
		}
		if secs > 60 {
			secs = 60 // cap at 60s
		}
		return time.Duration(secs) * time.Second
	}
	// Try HTTP-date
	if t, err := time.Parse(time.RFC1123, val); err == nil {
		d := time.Until(t)
		if d < 0 {
			d = 0
		}
		if d > 60*time.Second {
			d = 60 * time.Second
		}
		return d
	}
	return 0
}
