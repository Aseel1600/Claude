package server

import (
	"bufio"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/omniroute/omniroute/internal/config"
	"github.com/omniroute/omniroute/internal/db"
	"github.com/omniroute/omniroute/internal/executor"
	"github.com/omniroute/omniroute/internal/middleware"
	"github.com/omniroute/omniroute/internal/translator"
)

// ─── Request / Response types ───────────────────────────────────────────────

type ChatCompletionRequest struct {
	Model       string    `json:"model"`
	Messages    []Message `json:"messages"`
	Stream      bool      `json:"stream"`
	Temperature float64   `json:"temperature,omitempty"`
	TopP        float64   `json:"top_p,omitempty"`
	MaxTokens   int       `json:"max_tokens,omitempty"`
	N           int       `json:"n,omitempty"`
	Stop        any       `json:"stop,omitempty"`
	Tools       []any     `json:"tools,omitempty"`
}

type Message struct {
	Role    string      `json:"role"`
	Content interface{} `json:"content,omitempty"`
	Name    string      `json:"name,omitempty"`
}

type ChatCompletionResponse struct {
	ID      string   `json:"id"`
	Object  string   `json:"object"`
	Created int64    `json:"created"`
	Model   string   `json:"model"`
	Choices []Choice `json:"choices"`
	Usage   *Usage   `json:"usage,omitempty"`
}

type Choice struct {
	Index        int      `json:"index"`
	Message      *Message `json:"message,omitempty"`
	Delta        *Message `json:"delta,omitempty"`
	FinishReason *string  `json:"finish_reason,omitempty"`
}

type Usage struct {
	PromptTokens     int `json:"prompt_tokens"`
	CompletionTokens int `json:"completion_tokens"`
	TotalTokens      int `json:"total_tokens"`
}

type chatError struct {
	Error struct {
		Message string `json:"message"`
		Type    string `json:"type"`
		Code    string `json:"code,omitempty"`
	} `json:"error"`
}

// ─── Handler ────────────────────────────────────────────────────────────────

const maxRequestBodyBytes = 10 << 20

func handleChatCompletions(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeChatError(w, http.StatusMethodNotAllowed, "method not allowed", "invalid_request_error")
		return
	}

	ct := r.Header.Get("Content-Type")
	if ct == "" || !strings.HasPrefix(strings.TrimSpace(strings.SplitN(ct, ";", 2)[0]), "application/json") {
		writeChatError(w, http.StatusUnsupportedMediaType, "Content-Type must be application/json", "unsupported_media_type")
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxRequestBodyBytes)

	var req ChatCompletionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeChatError(w, http.StatusBadRequest, "invalid JSON body: "+err.Error(), "invalid_request_error")
		return
	}

	if len(req.Messages) == 0 {
		writeChatError(w, http.StatusBadRequest, "messages array is required", "invalid_request_error")
		return
	}
	if req.Model == "" {
		writeChatError(w, http.StatusBadRequest, "model field is required", "invalid_request_error")
		return
	}

	corrID := getCorrelationID(r)
	reqID := generateRequestID()

	provider := resolveProvider(r, req.Model)
	if provider == "" {
		writeChatError(w, http.StatusBadRequest,
			fmt.Sprintf("no provider found for model %q — set X-Provider header or register the model", req.Model),
			"invalid_request_error")
		return
	}

	slog.Info("chat completion",
		"model", req.Model,
		"provider", provider,
		"stream", req.Stream,
		"messages", len(req.Messages),
		"corr_id", corrID,
	)

	exec := executor.GetExecutor(provider)

	if req.Stream {
		handleStreamingChat(w, r, &req, reqID, provider, exec)
		return
	}
	handleNonStreamingChat(w, r, &req, reqID, provider, exec)
}

// ─── Provider resolution ────────────────────────────────────────────────────

func resolveProvider(r *http.Request, model string) string {
	// 1. Explicit X-Provider header — trusted even if not in registry (passthrough)
	if p := r.Header.Get("X-Provider"); p != "" {
		return p
	}

	// 2. Check if model string itself is a known provider ID
	if config.GetRegistryEntry(model) != nil {
		return model
	}

	// 3. Scan registry for a model match
	for _, id := range config.GetRegisteredIDs() {
		entry := config.GetRegistryEntry(id)
		if entry == nil {
			continue
		}
		for _, m := range entry.Models {
			if m.ID == model {
				return id
			}
			for _, alias := range m.Aliases {
				if alias == model {
					return id
				}
			}
		}
	}

	// 4. Provider prefix in model string (e.g. "openai/gpt-4")
	if i := strings.Index(model, "/"); i > 0 {
		prefix := model[:i]
		if config.GetRegistryEntry(prefix) != nil {
			return prefix
		}
	}

	// 5. Passthrough fallback: find first provider with PassthroughModels enabled
	for _, id := range config.GetRegisteredIDs() {
		entry := config.GetRegistryEntry(id)
		if entry != nil && entry.PassthroughModels {
			return id
		}
	}

	return ""
}

// ─── Non-streaming ──────────────────────────────────────────────────────────

func handleNonStreamingChat(w http.ResponseWriter, r *http.Request, req *ChatCompletionRequest, reqID, provider string, exec executor.Executor) {
	start := time.Now()
	body := buildUpstreamBody(req)

	// Translate request if provider uses a non-OpenAI format
	sourceFormat := translator.FormatOpenAI
	targetFormat := resolveTargetFormat(provider)
	if translator.NeedsTranslation(sourceFormat, targetFormat) {
		body = translator.TranslateRequest(sourceFormat, targetFormat, req.Model, body)
	}

	result, err := exec.Execute(r.Context(), executor.ExecuteInput{
		Model:          req.Model,
		Body:           body,
		Stream:         false,
		APIKey:         resolveAPIKey(r, provider),
		ProviderConfig: config.GetRegistryEntry(provider),
	})
	if err != nil {
		slog.Error("executor error", "provider", provider, "model", req.Model, "error", err)
		writeChatError(w, http.StatusBadGateway, "upstream error", "upstream_error")
		return
	}
	defer result.Body.Close()

	if result.StatusCode < 200 || result.StatusCode >= 300 {
		errBody, _ := io.ReadAll(io.LimitReader(result.Body, 4096))
		slog.Error("upstream error response",
			"provider", provider,
			"status", result.StatusCode,
			"body", string(errBody),
		)
		writeChatError(w, result.StatusCode, sanitizeUpstreamError(result.StatusCode, errBody), "upstream_error")
		return
	}

	respBody, err := io.ReadAll(result.Body)
	if err != nil {
		writeChatError(w, http.StatusBadGateway, "failed to read upstream response", "upstream_error")
		return
	}

	// Try to parse as JSON for response translation and ID injection
	var upstreamResp map[string]any
	if err := json.Unmarshal(respBody, &upstreamResp); err != nil {
		// Not JSON — forward raw
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("X-Request-Id", reqID)
		w.Header().Set("X-Upstream-Provider", provider)
		w.Write(respBody)
		return
	}

	// Translate response back to client format if needed
	if translator.NeedsTranslation(targetFormat, sourceFormat) {
		state := translator.NewStreamState(targetFormat)
		translated := translator.TranslateResponse(targetFormat, sourceFormat, respBody, state)
		if translated != nil {
			if err := json.Unmarshal(translated, &upstreamResp); err == nil {
				// Use the translated version
			}
		}
	}

	// Ensure our response ID and model are set
	upstreamResp["id"] = reqID
	if _, ok := upstreamResp["model"]; !ok {
		upstreamResp["model"] = req.Model
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("X-Request-Id", reqID)
	w.Header().Set("X-Upstream-Provider", provider)
	encodeJSON(w, upstreamResp)

	// Record usage asynchronously
	go recordUsageAsync(r, provider, req.Model, reqID, upstreamResp, time.Since(start), nil)
}

// ─── Streaming (SSE) ────────────────────────────────────────────────────────

func handleStreamingChat(w http.ResponseWriter, r *http.Request, req *ChatCompletionRequest, reqID, provider string, exec executor.Executor) {
	start := time.Now()
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.Header().Set("X-Request-Id", reqID)
	w.Header().Set("X-Upstream-Provider", provider)

	flusher, ok := w.(http.Flusher)
	if !ok {
		writeChatError(w, http.StatusInternalServerError, "streaming not supported", "internal_error")
		return
	}

	ctx := r.Context()
	body := buildUpstreamBody(req)

	// Translate request if provider uses a non-OpenAI format
	sourceFormat := translator.FormatOpenAI
	targetFormat := resolveTargetFormat(provider)
	if translator.NeedsTranslation(sourceFormat, targetFormat) {
		body = translator.TranslateRequest(sourceFormat, targetFormat, req.Model, body)
	}

	result, err := exec.Execute(ctx, executor.ExecuteInput{
		Model:          req.Model,
		Body:           body,
		Stream:         true,
		APIKey:         resolveAPIKey(r, provider),
		ProviderConfig: config.GetRegistryEntry(provider),
	})
	if err != nil {
		slog.Error("executor error (stream)", "provider", provider, "model", req.Model, "error", err)
		writeChatError(w, http.StatusBadGateway, "upstream error", "upstream_error")
		return
	}
	defer result.Body.Close()

	if result.StatusCode < 200 || result.StatusCode >= 300 {
		errBody, _ := io.ReadAll(io.LimitReader(result.Body, 4096))
		slog.Error("upstream error response (stream)",
			"provider", provider,
			"status", result.StatusCode,
			"body", string(errBody),
		)
		writeChatError(w, result.StatusCode, sanitizeUpstreamError(result.StatusCode, errBody), "upstream_error")
		return
	}

	// Keepalive goroutine
	keepaliveDone := make(chan struct{})
	var keepaliveWg sync.WaitGroup
	keepaliveWg.Add(1)
	go func() {
		defer keepaliveWg.Done()
		ticker := time.NewTicker(15 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				if ctx.Err() != nil {
					return
				}
				fmt.Fprint(w, ": keepalive\n\n")
				flusher.Flush()
			case <-keepaliveDone:
				return
			case <-ctx.Done():
				return
			}
		}
	}()

	// If response translation is needed, use a transforming pipe
	if translator.NeedsTranslation(targetFormat, sourceFormat) {
		state := translator.NewStreamState(targetFormat)
		err = pipeSSEStreamTranslated(w, flusher, result.Body, reqID, targetFormat, sourceFormat, state)
	} else {
		err = pipeSSEStream(w, flusher, result.Body, reqID)
	}
	if err != nil && ctx.Err() == nil {
		slog.Error("SSE pipe error (upstream drop)", "provider", provider, "model", req.Model, "error", err)
		sendSSEError(w, flusher, "upstream connection lost: "+err.Error())
	}

	close(keepaliveDone)
	keepaliveWg.Wait()

	// Record usage asynchronously (streaming: tokens unknown, latency only)
	go recordUsageAsync(r, provider, req.Model, reqID, nil, time.Since(start), nil)
}

// ─── Upstream body builder ──────────────────────────────────────────────────

func buildUpstreamBody(req *ChatCompletionRequest) map[string]any {
	body := map[string]any{
		"model":    req.Model,
		"messages": req.Messages,
	}

	if req.Temperature > 0 {
		body["temperature"] = req.Temperature
	}
	if req.TopP > 0 {
		body["top_p"] = req.TopP
	}
	if req.MaxTokens > 0 {
		body["max_tokens"] = req.MaxTokens
	}
	if req.N > 0 {
		body["n"] = req.N
	}
	if req.Stop != nil {
		body["stop"] = req.Stop
	}
	if len(req.Tools) > 0 {
		body["tools"] = req.Tools
	}

	return body
}

// ─── API key resolution ─────────────────────────────────────────────────────

func resolveAPIKey(r *http.Request, provider string) string {
	// 1. X-API-Key header (provider-specific)
	if k := r.Header.Get("X-API-Key"); k != "" {
		return k
	}

	// 2. Authorization: Bearer <key>
	if auth := r.Header.Get("Authorization"); auth != "" {
		const prefix = "Bearer "
		if strings.HasPrefix(auth, prefix) {
			return strings.TrimSpace(auth[len(prefix):])
		}
	}

	// 3. Provider-specific env vars
	envMap := map[string][]string{
		"openai":    {"OPENAI_API_KEY"},
		"anthropic": {"ANTHROPIC_API_KEY"},
		"deepseek":  {"DEEPSEEK_API_KEY"},
		"groq":      {"GROQ_API_KEY"},
		"gemini":    {"GEMINI_API_KEY", "GOOGLE_API_KEY"},
		"mistral":   {"MISTRAL_API_KEY"},
		"cohere":    {"COHERE_API_KEY"},
		"together":  {"TOGETHER_API_KEY"},
		"fireworks": {"FIREWORKS_API_KEY"},
		"cerebras":  {"CEREBRAS_API_KEY"},
		"nvidia":    {"NVIDIA_API_KEY"},
		"xai":       {"XAI_API_KEY"},
		"huggingface": {"HUGGINGFACE_API_KEY", "HF_TOKEN"},
		"openrouter":  {"OPENROUTER_API_KEY"},
		"sambanova":   {"SAMBANOVA_API_KEY"},
	}

	if keys, ok := envMap[provider]; ok {
		for _, env := range keys {
			if v := strings.TrimSpace(r.Header.Get("X-Env-" + env)); v != "" {
				return v
			}
		}
	}

	return ""
}

// ─── SSE pipe ───────────────────────────────────────────────────────────────

func pipeSSEStream(dst io.Writer, flusher http.Flusher, src io.Reader, reqID string) error {
	scanner := bufio.NewScanner(src)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)

	for scanner.Scan() {
		line := scanner.Text()

		if strings.HasPrefix(line, "data: ") {
			data := strings.TrimPrefix(line, "data: ")

			if data == "[DONE]" {
				fmt.Fprint(dst, "data: [DONE]\n\n")
				flusher.Flush()
				return nil
			}

			// Forward upstream SSE data directly
			fmt.Fprintf(dst, "data: %s\n\n", data)
			flusher.Flush()
			continue
		}

		// Forward non-data lines (event:, id:, comments, blank lines)
		if line == "" {
			fmt.Fprint(dst, "\n")
		} else {
			fmt.Fprintf(dst, "%s\n", line)
		}
	}

	return scanner.Err()
}

// ─── Helpers ────────────────────────────────────────────────────────────────

func writeChatError(w http.ResponseWriter, status int, message, errType string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	resp := chatError{}
	resp.Error.Message = message
	resp.Error.Type = errType
	encodeJSON(w, resp)
}

func generateRequestID() string {
	return "chatcmpl-" + time.Now().Format("20060102150405") + "-" + randomHex(8)
}

func randomHex(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic("crypto/rand failed: " + err.Error())
	}
	return hex.EncodeToString(b)
}

func getCorrelationID(r *http.Request) string {
	if id := r.Header.Get("X-Correlation-Id"); id != "" {
		return id
	}
	return r.Header.Get("X-Request-Id")
}

// ConnectUpstreamSSE makes a POST to the upstream provider and returns the
// response body for SSE processing. Used for manual upstream connections.
func ConnectUpstreamSSE(ctx context.Context, url string, headers map[string]string, body io.Reader) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, body)
	if err != nil {
		return nil, fmt.Errorf("build upstream request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "text/event-stream")
	for k, v := range headers {
		req.Header.Set(k, v)
	}

	client := &http.Client{Timeout: 5 * time.Minute}
	return client.Do(req)
}

// resolveTargetFormat maps a provider ID to the request format it expects.
func resolveTargetFormat(provider string) translator.Format {
	entry := config.GetRegistryEntry(provider)
	if entry == nil {
		return translator.FormatOpenAI
	}
	switch entry.Format {
	case "claude":
		return translator.FormatClaude
	case "gemini":
		return translator.FormatGemini
	case "antigravity":
		return translator.FormatAntigravity
	case "openai-responses":
		return translator.FormatOpenAIResponses
	default:
		return translator.FormatOpenAI
	}
}

// sanitizeUpstreamError returns a safe error message to send to clients,
// stripping provider-internal details like token counts, model names,
// and request internals.
func sanitizeUpstreamError(status int, body []byte) string {
	// Try to parse a structured error from common upstream formats
	var errResp struct {
		Error struct {
			Message string `json:"message"`
			Type    string `json:"type"`
			Code    string `json:"code"`
		} `json:"error"`
		ErrorMsg string `json:"error_message"`
		Message  string `json:"message"`
	}
	if err := json.Unmarshal(body, &errResp); err == nil {
		msg := errResp.Error.Message
		if msg == "" {
			msg = errResp.ErrorMsg
		}
		if msg == "" {
			msg = errResp.Message
		}
		if msg != "" {
			// Truncate long messages
			if len(msg) > 200 {
				msg = msg[:200] + "..."
			}
			return msg
		}
	}
	return fmt.Sprintf("upstream provider returned HTTP %d", status)
}

// sendSSEError sends an SSE error event to the client and a [DONE] sentinel.
func sendSSEError(w io.Writer, flusher http.Flusher, message string) {
	errJSON, _ := json.Marshal(map[string]any{
		"error": map[string]any{
			"message": message,
			"type":    "upstream_error",
		},
	})
	fmt.Fprintf(w, "data: %s\n\n", errJSON)
	fmt.Fprint(w, "data: [DONE]\n\n")
	flusher.Flush()
}

// recordUsageAsync inserts a usage record into the DB. Should be called as a goroutine.
func recordUsageAsync(r *http.Request, provider, model, reqID string, upstreamResp map[string]any, latency time.Duration, err error) {
	defer func() {
		if r := recover(); r != nil {
			slog.Error("usage recording panic", "error", r)
		}
	}()

	data := map[string]interface{}{
		"provider":  provider,
		"model":     model,
		"status":    "success",
		"success":   true,
		"latencyMs": int(latency.Milliseconds()),
		"timestamp": time.Now().UTC().Format(time.RFC3339),
	}

	// Extract API key metadata from context
	if meta := middleware.APIKeyFromContext(r.Context()); meta != nil {
		if id, ok := meta["id"].(string); ok {
			data["apiKeyId"] = id
		}
		if name, ok := meta["name"].(string); ok {
			data["apiKeyName"] = name
		}
	}

	// Extract token usage from non-streaming response
	if upstreamResp != nil {
		if usage, ok := upstreamResp["usage"].(map[string]any); ok {
			if v, ok := usage["prompt_tokens"].(float64); ok {
				data["tokensInput"] = int(v)
			}
			if v, ok := usage["completion_tokens"].(float64); ok {
				data["tokensOutput"] = int(v)
			}
			if v, ok := usage["cache_read_input_tokens"].(float64); ok {
				data["tokensCacheRead"] = int(v)
			}
			if v, ok := usage["cache_creation_input_tokens"].(float64); ok {
				data["tokensCacheCreation"] = int(v)
			}
			if v, ok := usage["prompt_tokens_details"].(map[string]any); ok {
				if r, ok := v["cached_tokens"].(float64); ok {
					data["tokensCacheRead"] = int(r)
				}
			}
			if v, ok := usage["completion_tokens_details"].(map[string]any); ok {
				if r, ok := v["reasoning_tokens"].(float64); ok {
					data["tokensReasoning"] = int(r)
				}
			}
		}
	}

	if err != nil {
		data["success"] = false
		data["status"] = "error"
		data["errorCode"] = err.Error()
	}

	if dbErr := db.RecordUsage(data); dbErr != nil {
		slog.Error("failed to record usage", "error", dbErr)
	}
}

// pipeSSEStreamTranslated pipes SSE from upstream to client, translating each
// chunk from targetFormat back to sourceFormat.
func pipeSSEStreamTranslated(dst io.Writer, flusher http.Flusher, src io.Reader, reqID string, targetFormat, sourceFormat translator.Format, state translator.StateMap) error {
	scanner := bufio.NewScanner(src)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)

	for scanner.Scan() {
		line := scanner.Text()

		if strings.HasPrefix(line, "data: ") {
			data := strings.TrimPrefix(line, "data: ")

			if data == "[DONE]" {
				fmt.Fprint(dst, "data: [DONE]\n\n")
				flusher.Flush()
				return nil
			}

			// Translate the SSE data payload
			translated := translator.TranslateResponse(targetFormat, sourceFormat, []byte(data), state)
			if translated != nil {
				fmt.Fprintf(dst, "data: %s\n\n", translated)
			} else {
				// Fallback: forward raw
				fmt.Fprintf(dst, "data: %s\n\n", data)
			}
			flusher.Flush()
			continue
		}

		if line == "" {
			fmt.Fprint(dst, "\n")
		} else {
			fmt.Fprintf(dst, "%s\n", line)
		}
	}

	return scanner.Err()
}
