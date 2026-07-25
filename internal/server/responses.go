package server

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"strings"

	"github.com/omniroute/omniroute/internal/config"
	"github.com/omniroute/omniroute/internal/executor"
	"github.com/omniroute/omniroute/internal/translator"
)

// ResponsesRequest is the OpenAI Responses API format request body.
type ResponsesRequest struct {
	Model  string    `json:"model"`
	Input  any       `json:"input"` // string or []InputItem
	Stream bool      `json:"stream,omitempty"`
	Tools  []any     `json:"tools,omitempty"`
}

type InputItem struct {
	Type    string      `json:"type"`
	Role    string      `json:"role,omitempty"`
	Content interface{} `json:"content,omitempty"`
}

func handleResponses(w http.ResponseWriter, r *http.Request) {
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

	var rawBody map[string]any
	if err := json.NewDecoder(r.Body).Decode(&rawBody); err != nil {
		writeChatError(w, http.StatusBadRequest, "invalid JSON body", "invalid_request_error")
		return
	}

	model, _ := rawBody["model"].(string)
	if model == "" {
		writeChatError(w, http.StatusBadRequest, "model field is required", "invalid_request_error")
		return
	}

	provider := resolveProvider(r, model)
	if provider == "" {
		writeChatError(w, http.StatusBadRequest,
			"no provider found for model "+model,
			"invalid_request_error")
		return
	}

	// Convert Responses API format to Chat Completions format
	chatBody := convertResponsesToChatCompletions(rawBody)

	isStream, _ := rawBody["stream"].(bool)

	slog.Info("responses API request",
		"model", model,
		"provider", provider,
		"stream", isStream,
	)

	// Translate if provider expects non-OpenAI format
	sourceFormat := translator.FormatOpenAIResponses
	targetFormat := resolveTargetFormat(provider)
	if translator.NeedsTranslation(sourceFormat, targetFormat) {
		// Responses API → OpenAI Chat → target format
		if translator.NeedsTranslation(translator.FormatOpenAI, targetFormat) {
			chatBody = translator.TranslateRequest(translator.FormatOpenAI, targetFormat, model, chatBody)
		}
	}

	exec := executor.GetExecutor(provider)
	result, err := exec.Execute(r.Context(), executor.ExecuteInput{
		Model:          model,
		Body:           chatBody,
		Stream:         isStream,
		APIKey:         resolveAPIKey(r, provider),
		ProviderConfig: config.GetRegistryEntry(provider),
	})
	if err != nil {
		slog.Error("executor error", "provider", provider, "model", model, "error", err)
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

	// For non-streaming, convert Chat Completions response back to Responses format
	var upstreamResp map[string]any
	if err := json.Unmarshal(respBody, &upstreamResp); err != nil {
		// Not JSON — forward raw
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("X-Upstream-Provider", provider)
		w.Write(respBody)
		return
	}

	respID := "resp_" + randomHex(12)
	responsesResp := convertChatCompletionsToResponses(upstreamResp, respID, model)

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("X-Upstream-Provider", provider)
	encodeJSON(w, responsesResp)
}

// convertResponsesToChatCompletions converts a Responses API request to a Chat Completions body.
func convertResponsesToChatCompletions(body map[string]any) map[string]any {
	result := map[string]any{
		"model": body["model"],
	}

	// Convert input to messages
	if input, ok := body["input"]; ok {
		messages := convertInputToMessages(input)
		result["messages"] = messages
	}

	// Pass through optional fields
	if v, ok := body["temperature"]; ok {
		result["temperature"] = v
	}
	if v, ok := body["top_p"]; ok {
		result["top_p"] = v
	}
	if v, ok := body["max_output_tokens"]; ok {
		result["max_tokens"] = v
	}
	if v, ok := body["tools"]; ok {
		result["tools"] = v
	}
	if v, ok := body["stream"]; ok {
		result["stream"] = v
		result["stream_options"] = map[string]any{"include_usage": true}
	}
	if v, ok := body["response_format"]; ok {
		result["response_format"] = v
	}

	return result
}

// convertInputToMessages converts Responses API input to Chat Completions messages.
func convertInputToMessages(input any) []map[string]any {
	switch v := input.(type) {
	case string:
		return []map[string]any{
			{"role": "user", "content": v},
		}
	case []any:
		var messages []map[string]any
		for _, item := range v {
			itemMap, ok := item.(map[string]any)
			if !ok {
				continue
			}
			msg := map[string]any{}
			itemType, _ := itemMap["type"].(string)
			switch itemType {
			case "message":
				msg["role"] = itemMap["role"]
				msg["content"] = itemMap["content"]
			case "function_call":
				msg["role"] = "assistant"
				msg["tool_calls"] = []map[string]any{{
					"id":   itemMap["call_id"],
					"type": "function",
					"function": map[string]any{
						"name":      itemMap["name"],
						"arguments": itemMap["arguments"],
					},
				}}
			case "function_call_output":
				msg["role"] = "tool"
				msg["tool_call_id"] = itemMap["call_id"]
				msg["content"] = itemMap["output"]
			default:
				msg["role"] = itemMap["role"]
				msg["content"] = itemMap["content"]
			}
			messages = append(messages, msg)
		}
		return messages
	default:
		return nil
	}
}

// convertChatCompletionsToResponses converts a Chat Completions response to Responses format.
func convertChatCompletionsToResponses(chatResp map[string]any, respID, model string) map[string]any {
	result := map[string]any{
		"id":      respID,
		"object":  "response",
		"created": chatResp["created"],
		"model":   model,
		"status":  "completed",
	}

	// Extract choices and convert to output items
	if choices, ok := chatResp["choices"].([]any); ok && len(choices) > 0 {
		choice, ok := choices[0].(map[string]any)
		if !ok {
			return result
		}

		outputItems := []map[string]any{}

		if msg, ok := choice["message"].(map[string]any); ok {
			// Non-streaming response
			if content, ok := msg["content"].(string); ok && content != "" {
				outputItems = append(outputItems, map[string]any{
					"type": "message",
					"id":   "msg_" + randomHex(12),
					"role": "assistant",
					"content": []map[string]any{{
						"type": "output_text",
						"text": content,
					}},
				})
			}
			if toolCalls, ok := msg["tool_calls"].([]any); ok {
				for _, tc := range toolCalls {
					tcMap, ok := tc.(map[string]any)
					if !ok {
						continue
					}
					fn, ok := tcMap["function"].(map[string]any)
					if !ok {
						continue
					}
					outputItems = append(outputItems, map[string]any{
						"type":    "function_call",
						"id":      "fc_" + randomHex(12),
						"call_id": tcMap["id"],
						"name":    fn["name"],
						"arguments": fn["arguments"],
					})
				}
			}
		}

		if len(outputItems) > 0 {
			result["output"] = outputItems
		}

		// Extract usage
		if usage, ok := chatResp["usage"].(map[string]any); ok {
			result["usage"] = usage
		}
	}

	return result
}
