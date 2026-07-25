package executor

import (
	"net/http"
	"regexp"
	"strings"

	"github.com/omniroute/omniroute/internal/config"
)

var (
	openaiModelPattern = regexp.MustCompile(`(?i)^(?:openai/)?(?:o1|o3|o4|gpt-5)`)
)

type DefaultExecutor struct {
	BaseExecutor
}

func NewDefaultExecutor(provider string, cfg *config.RegistryEntry) *DefaultExecutor {
	if cfg == nil {
		cfg = &config.RegistryEntry{
			ID:         provider,
			Format:     "openai",
			AuthType:   "api_key",
			AuthHeader: "bearer",
		}
	}
	return &DefaultExecutor{
		BaseExecutor: BaseExecutor{Provider: provider, Config: cfg},
	}
}

func (e *DefaultExecutor) BuildURL(model string, stream bool) string {
	provider := e.Provider

	// openai-compatible-* providers: use providerSpecificData or default to openai
	if strings.HasPrefix(provider, "openai-compatible-") {
		normalized := strings.TrimRight(e.Config.BaseURL, "/")
		if normalized == "" {
			normalized = "https://api.openai.com/v1"
		}
		return normalized + "/chat/completions"
	}

	// anthropic-compatible-* providers
	if strings.HasPrefix(provider, "anthropic-compatible-") {
		normalized := strings.TrimRight(e.Config.BaseURL, "/")
		if normalized == "" {
			normalized = "https://api.anthropic.com/v1"
		}
		customPath := e.Config.ChatPath
		if customPath != "" && sanitizePath(customPath) {
			return normalized + customPath
		}
		return normalized + "/messages"
	}

	switch provider {
	case "openai":
		if e.Config.BaseURL != "" {
			return e.Config.BaseURL
		}
		return "https://api.openai.com/v1/chat/completions"

	case "gemini":
		if e.Config.BaseURL != "" {
			path := "streamGenerateContent?alt=sse"
			if !stream {
				path = "generateContent"
			}
			return strings.TrimRight(e.Config.BaseURL, "/") + "/" + model + ":" + path
		}
		return ""

	case "claude", "anthropic", "glm", "glmt", "kimi-coding", "minimax", "minimax-cn":
		if e.Config.BaseURL != "" {
			return strings.TrimRight(e.Config.BaseURL, "/") + "?beta=true"
		}
		return ""

	case "azure-ai":
		base := strings.TrimRight(e.Config.BaseURL, "/")
		if base == "" {
			return ""
		}
		apiVersion := "2024-12-01-preview"
		return base + "/chat/completions?api-version=" + apiVersion

	default:
		// Fall back to base URL + optional urlSuffix
		if e.Config.BaseURL != "" {
			return e.Config.BaseURL + e.Config.URLSuffix
		}
		return e.Config.URLSuffix
	}
}

func (e *DefaultExecutor) BuildHeaders(apiKey string, stream bool) http.Header {
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

	provider := e.Provider
	switch {
	case provider == "gemini" || provider == "antigravity":
		if token != "" {
			headers.Set("X-Goog-Api-Key", token)
		} else if e.Config.BaseURL != "" {
			headers.Set("Authorization", "Bearer ")
		}

	case provider == "claude" || provider == "anthropic":
		if token != "" {
			headers.Set("X-Api-Key", token)
		}

	case provider == "azure-ai":
		if token != "" {
			headers.Set("api-key", token)
		}
		headers.Del("Authorization")

	case provider == "snowflake":
		rawToken := token
		isPAT := strings.HasPrefix(rawToken, "pat/")
		bearerToken := rawToken
		if isPAT {
			bearerToken = rawToken[4:]
		}
		headers.Set("Authorization", "Bearer "+bearerToken)
		if isPAT {
			headers.Set("X-Snowflake-Authorization-Token-Type", "PROGRAMMATIC_ACCESS_TOKEN")
		} else {
			headers.Set("X-Snowflake-Authorization-Token-Type", "KEYPAIR_JWT")
		}

	case provider == "maritalk":
		if token != "" {
			headers.Set("Authorization", "Key "+token)
		}

	case provider == "clarifai":
		if token != "" {
			headers.Set("Authorization", "Key "+token)
		}

	case strings.HasPrefix(provider, "anthropic-compatible-"):
		if token != "" {
			headers.Set("X-Api-Key", token)
		}
		if !hasHeaderKey(headers, "anthropic-version") {
			headers.Set("anthropic-version", "2023-06-01")
		}

	case strings.HasPrefix(provider, "glm") || provider == "kimi-coding" || provider == "zai" || provider == "glm-coding-apikey":
		if token != "" {
			headers.Set("X-Api-Key", token)
		}

	default:
		// Use registry authHeader if available, otherwise default to bearer
		entry := config.GetRegistryEntry(provider)
		authHeader := "bearer"
		if entry != nil && entry.AuthHeader != "" {
			authHeader = entry.AuthHeader
		}

		if token != "" {
			switch authHeader {
			case "x-api-key":
				headers.Set("X-Api-Key", token)
			case "x-goog-api-key":
				headers.Set("X-Goog-Api-Key", token)
			default:
				headers.Set("Authorization", "Bearer "+token)
			}
		}
	}

	if stream {
		headers.Set("Accept", "text/event-stream")
	} else {
		headers.Set("Accept", "application/json")
	}

	return headers
}

func (e *DefaultExecutor) TransformRequest(model string, body map[string]any, stream bool) map[string]any {
	// Apply base transformation
	result := e.BaseExecutor.TransformRequest(model, body, stream)
	if result == nil {
		return result
	}

	// Remove client_metadata for providers that don't support it
	switch e.Provider {
	case "cerebras", "mistral", "nvidia":
		delete(result, "client_metadata")
	}

	// Strip reasoning_content from messages for Mistral
	if e.Provider == "mistral" {
		if messages, ok := result["messages"].([]any); ok {
			cleaned := make([]any, 0, len(messages))
			for _, msg := range messages {
				if msgMap, ok := msg.(map[string]any); ok {
					if _, hasRC := msgMap["reasoning_content"]; hasRC {
						newMap := make(map[string]any, len(msgMap)-1)
						for k, v := range msgMap {
							if k != "reasoning_content" {
								newMap[k] = v
							}
						}
						cleaned = append(cleaned, newMap)
						continue
					}
				}
				cleaned = append(cleaned, msg)
			}
			result["messages"] = cleaned
		}
	}

	// stream_options handling
	if _, isObj := result["model"]; isObj || result != nil {
		if _, isObj := any(result).(map[string]any); isObj {
			if strings.HasPrefix(e.Provider, "anthropic-compatible-") {
				delete(result, "stream_options")
			} else if stream && e.Config.Format != "claude" {
				// Inject stream_options.include_usage for OpenAI-format streaming
				if _, hasStreamOpts := result["stream_options"]; !hasStreamOpts {
					result["stream_options"] = map[string]any{
						"include_usage": true,
					}
				}
			} else if !stream {
				delete(result, "stream_options")
			}
		}
	}

	// Map max_tokens → max_completion_tokens for recent OpenAI models
	if openaiModelPattern.MatchString(model) {
		if mt, ok := result["max_tokens"]; ok {
			result["max_completion_tokens"] = mt
			delete(result, "max_tokens")
		}
	}

	// Apply modelIdPrefix from registry
	entry := config.GetRegistryEntry(e.Provider)
	if entry != nil && entry.ModelIDPrefix != "" {
		if modelStr, ok := result["model"].(string); ok {
			alreadyQualified := strings.HasPrefix(modelStr, entry.ModelIDPrefix)
			if !alreadyQualified {
				for _, prefix := range entry.AcceptedModelIDPrefixes {
					if strings.HasPrefix(modelStr, prefix) {
						alreadyQualified = true
						break
					}
				}
			}
			if !alreadyQualified {
				result["model"] = entry.ModelIDPrefix + modelStr
			}
		}
	}

	return result
}

func hasKey(headers http.Header, key string) bool {
	lower := strings.ToLower(key)
	for k := range headers {
		if strings.ToLower(k) == lower {
			return true
		}
	}
	return false
}

func hasHeaderKey(headers http.Header, key string) bool {
	return hasKey(headers, key)
}
