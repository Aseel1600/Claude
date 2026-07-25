package server

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"strings"

	"github.com/omniroute/omniroute/internal/config"
	"github.com/omniroute/omniroute/internal/executor"
)

// EmbeddingRequest is the OpenAI-compatible embeddings request body.
type EmbeddingRequest struct {
	Model string   `json:"model"`
	Input any      `json:"input"` // string or []string
	EncodingFormat string `json:"encoding_format,omitempty"`
}

// EmbeddingResponse is the OpenAI-compatible embeddings response body.
type EmbeddingResponse struct {
	Object string            `json:"object"`
	Data   []EmbeddingData   `json:"data"`
	Model  string            `json:"model"`
	Usage  *EmbeddingUsage   `json:"usage,omitempty"`
}

type EmbeddingData struct {
	Object    string    `json:"object"`
	Embedding []float64 `json:"embedding"`
	Index     int       `json:"index"`
}

type EmbeddingUsage struct {
	PromptTokens int `json:"prompt_tokens"`
	TotalTokens  int `json:"total_tokens"`
}

func handleEmbeddings(w http.ResponseWriter, r *http.Request) {
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

	var req EmbeddingRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeChatError(w, http.StatusBadRequest, "invalid JSON body", "invalid_request_error")
		return
	}

	if req.Model == "" {
		writeChatError(w, http.StatusBadRequest, "model field is required", "invalid_request_error")
		return
	}

	// Normalize input to []string
	inputs := normalizeEmbeddingInput(req.Input)
	if len(inputs) == 0 {
		writeChatError(w, http.StatusBadRequest, "input field is required", "invalid_request_error")
		return
	}

	provider := resolveProvider(r, req.Model)
	if provider == "" {
		writeChatError(w, http.StatusBadRequest,
			"no provider found for model "+req.Model,
			"invalid_request_error")
		return
	}

	slog.Info("embedding request",
		"model", req.Model,
		"provider", provider,
		"inputs", len(inputs),
	)

	// Build upstream body
	body := map[string]any{
		"model": req.Model,
		"input": inputs,
	}
	if req.EncodingFormat != "" {
		body["encoding_format"] = req.EncodingFormat
	}

	exec := executor.GetExecutor(provider)
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

	// Read and forward the upstream response
	respBody, err := io.ReadAll(result.Body)
	if err != nil {
		writeChatError(w, http.StatusBadGateway, "failed to read upstream response", "upstream_error")
		return
	}

	// Try to parse and inject our own model field
	var upstreamResp map[string]any
	if err := json.Unmarshal(respBody, &upstreamResp); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("X-Upstream-Provider", provider)
		w.Write(respBody)
		return
	}

	if _, ok := upstreamResp["model"]; !ok {
		upstreamResp["model"] = req.Model
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("X-Upstream-Provider", provider)
	encodeJSON(w, upstreamResp)
}

// normalizeEmbeddingInput converts the input field (string or []string) to []string.
func normalizeEmbeddingInput(input any) []string {
	switch v := input.(type) {
	case string:
		return []string{v}
	case []any:
		var out []string
		for _, item := range v {
			if s, ok := item.(string); ok {
				out = append(out, s)
			}
		}
		return out
	default:
		return nil
	}
}
