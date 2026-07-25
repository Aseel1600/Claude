package translator

import (
	"fmt"
	"strings"
)

type Format string

const (
	FormatOpenAI          Format = "openai"
	FormatOpenAIResponses Format = "openai-responses"
	FormatClaude          Format = "claude"
	FormatGemini          Format = "gemini"
	FormatAntigravity     Format = "antigravity"
	FormatCodex           Format = "codex"
)

// NeedsTranslation returns true if source and target formats differ.
func NeedsTranslation(source, target Format) bool {
	return source != target
}

// TranslateRequest translates a request body from source format to target format.
// Uses hub-and-spoke via OpenAI as intermediate when no direct translator exists.
func TranslateRequest(source, target Format, model string, body map[string]any) map[string]any {
	if source == target {
		return body
	}

	result := body

	// Check for direct translation path first (e.g., Claude → Gemini)
	if fn := getRequestTranslator(source, target); fn != nil {
		return fn(model, result)
	}

	// Fallback: hub-and-spoke via OpenAI
	// Step 1: source -> OpenAI (if source is not OpenAI)
	if source != FormatOpenAI {
		if fn := getRequestTranslator(source, FormatOpenAI); fn != nil {
			result = fn(model, result)
		}
	}

	// Step 2: OpenAI -> target (if target is not OpenAI)
	if target != FormatOpenAI {
		if fn := getRequestTranslator(FormatOpenAI, target); fn != nil {
			result = fn(model, result)
		}
	}

	return result
}

// TranslateResponse translates a streaming response chunk from target format
// back to source format (the client's expected format).
func TranslateResponse(target, source Format, chunk []byte, state map[string]any) []byte {
	if source == target {
		return chunk
	}

	// Direct translation path
	if fn := getResponseTranslator(target, source); fn != nil {
		return fn(chunk, state)
	}

	// Hub-and-spoke via OpenAI
	// Step 1: target -> OpenAI
	var openaiChunk []byte
	if target != FormatOpenAI {
		if fn := getResponseTranslator(target, FormatOpenAI); fn != nil {
			openaiChunk = fn(chunk, state)
		}
	} else {
		openaiChunk = chunk
	}

	// Step 2: OpenAI -> source
	if source != FormatOpenAI {
		if fn := getResponseTranslator(FormatOpenAI, source); fn != nil {
			return fn(openaiChunk, state)
		}
	}

	return openaiChunk
}

// StateMap is a convenience alias for streaming response state.
type StateMap = map[string]any

// NewStreamState creates a fresh streaming state for the given source format.
func NewStreamState(source Format) StateMap {
	state := StateMap{
		"messageId":      nil,
		"model":          nil,
		"textBlockStarted": false,
		"thinkingBlockStarted": false,
		"inThinkingBlock": false,
		"currentBlockIndex": nil,
		"toolCalls":      map[string]any{},
		"finishReason":   nil,
		"finishReasonSent": false,
		"usage":          nil,
		"contentBlockIndex": -1,
	}
	return state
}

// ---------------------------------------------------------------------------
// Request translator registry
// ---------------------------------------------------------------------------

type RequestTranslator func(model string, body map[string]any) map[string]any

type requestTranslatorKey struct {
	source Format
	target Format
}

var requestTranslators = map[requestTranslatorKey]RequestTranslator{}

func registerRequestTranslator(source, target Format, fn RequestTranslator) {
	requestTranslators[requestTranslatorKey{source, target}] = fn
}

func getRequestTranslator(source, target Format) RequestTranslator {
	return requestTranslators[requestTranslatorKey{source, target}]
}

func isDirectRequestTranslator(source, target Format) bool {
	fn := getRequestTranslator(source, target)
	return fn != nil
}

// ---------------------------------------------------------------------------
// Response translator registry
// ---------------------------------------------------------------------------

type ResponseTranslator func(chunk []byte, state StateMap) []byte

type responseTranslatorKey struct {
	source Format // upstream format
	target Format // client format
}

var responseTranslators = map[responseTranslatorKey]ResponseTranslator{}

func registerResponseTranslator(source, target Format, fn ResponseTranslator) {
	responseTranslators[responseTranslatorKey{source, target}] = fn
}

func getResponseTranslator(source, target Format) ResponseTranslator {
	return responseTranslators[responseTranslatorKey{source, target}]
}

func isDirectResponseTranslator(source, target Format) bool {
	fn := getResponseTranslator(source, target)
	return fn != nil
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func ensureToolCallIDs(body map[string]any) {
	messages, ok := body["messages"].([]any)
	if !ok {
		return
	}
	counter := 0
	for _, msg := range messages {
		msgMap, ok := msg.(map[string]any)
		if !ok {
			continue
		}
		if msgMap["role"] != "assistant" {
			continue
		}
		tcs, ok := msgMap["tool_calls"].([]any)
		if !ok {
			continue
		}
		for _, tc := range tcs {
			tcMap, ok := tc.(map[string]any)
			if !ok {
				continue
			}
			id, _ := tcMap["id"].(string)
			if id == "" {
				tcMap["id"] = generateToolCallID(counter)
				counter++
			}
		}
	}
}

func generateToolCallID(seq int) string {
	return fmt.Sprintf("call_%024d", seq)
}

// normalizeContentToString normalizes content to a plain string.
func normalizeContentToString(content any) string {
	switch c := content.(type) {
	case string:
		return c
	case []any:
		var parts []string
		for _, block := range c {
			if blockMap, ok := block.(map[string]any); ok {
				if blockMap["type"] == "text" {
					if text, ok := blockMap["text"].(string); ok {
						parts = append(parts, text)
					}
				}
			}
		}
		return strings.Join(parts, "\n")
	default:
		return ""
	}
}
