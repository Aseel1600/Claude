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

// ImageGenerationRequest is the OpenAI-compatible image generation request body.
type ImageGenerationRequest struct {
	Model          string `json:"model"`
	Prompt         string `json:"prompt"`
	N              int    `json:"n,omitempty"`
	Size           string `json:"size,omitempty"`
	Quality        string `json:"quality,omitempty"`
	Style          string `json:"style,omitempty"`
	ResponseFormat string `json:"response_format,omitempty"`
}

func handleImageGeneration(w http.ResponseWriter, r *http.Request) {
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

	var req ImageGenerationRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeChatError(w, http.StatusBadRequest, "invalid JSON body", "invalid_request_error")
		return
	}

	if req.Model == "" {
		writeChatError(w, http.StatusBadRequest, "model field is required", "invalid_request_error")
		return
	}
	if req.Prompt == "" {
		writeChatError(w, http.StatusBadRequest, "prompt field is required", "invalid_request_error")
		return
	}

	provider := resolveProvider(r, req.Model)
	if provider == "" {
		writeChatError(w, http.StatusBadRequest,
			"no provider found for model "+req.Model,
			"invalid_request_error")
		return
	}

	slog.Info("image generation request",
		"model", req.Model,
		"provider", provider,
		"prompt_len", len(req.Prompt),
	)

	// Build upstream body
	body := map[string]any{
		"model":  req.Model,
		"prompt": req.Prompt,
	}
	if req.N > 0 {
		body["n"] = req.N
	}
	if req.Size != "" {
		body["size"] = req.Size
	}
	if req.Quality != "" {
		body["quality"] = req.Quality
	}
	if req.Style != "" {
		body["style"] = req.Style
	}
	if req.ResponseFormat != "" {
		body["response_format"] = req.ResponseFormat
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

	respBody, err := io.ReadAll(result.Body)
	if err != nil {
		writeChatError(w, http.StatusBadGateway, "failed to read upstream response", "upstream_error")
		return
	}

	// Forward as-is — image responses vary widely between providers
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("X-Upstream-Provider", provider)

	var upstreamResp map[string]any
	if err := json.Unmarshal(respBody, &upstreamResp); err != nil {
		w.Write(respBody)
		return
	}

	encodeJSON(w, upstreamResp)
}
