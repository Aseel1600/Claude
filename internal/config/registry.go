package config

import (
	"strings"
	"sync"
)

// RegistryModel describes a single model within a provider registry entry.
type RegistryModel struct {
	ID                string   `json:"id"`
	Name              string   `json:"name,omitempty"`
	Aliases           []string `json:"aliases,omitempty"`
	ToolCalling       bool     `json:"toolCalling,omitempty"`
	SupportsReasoning bool     `json:"supportsReasoning,omitempty"`
	SupportsVision    bool     `json:"supportsVision,omitempty"`
	MaxOutputTokens   int      `json:"maxOutputTokens,omitempty"`
	ContextLength     int      `json:"contextLength,omitempty"`
	TargetFormat      string   `json:"targetFormat,omitempty"`
	UnsupportedParams []string `json:"unsupportedParams,omitempty"`
}

// RegistryEntry describes a single LLM provider.
type RegistryEntry struct {
	ID                      string            `json:"id"`
	Alias                   string            `json:"alias,omitempty"`
	Format                  string            `json:"format"`
	Executor                string            `json:"executor,omitempty"`
	BaseURL                 string            `json:"baseUrl,omitempty"`
	BaseURLs                []string          `json:"baseUrls,omitempty"`
	ResponsesURL            string            `json:"responsesBaseUrl,omitempty"`
	MessagesURL             string            `json:"messagesUrl,omitempty"`
	URLSuffix               string            `json:"urlSuffix,omitempty"`
	ChatPath                string            `json:"chatPath,omitempty"`
	AuthType                string            `json:"authType"`
	AuthHeader              string            `json:"authHeader"`
	Headers                 map[string]string `json:"headers,omitempty"`
	OAuth                   *RegistryOAuth    `json:"oauth,omitempty"`
	Models                  []RegistryModel   `json:"models,omitempty"`
	ModelsURL               string            `json:"modelsUrl,omitempty"`
	TimeoutMs               int               `json:"timeoutMs,omitempty"`
	PassthroughModels       bool              `json:"passthroughModels,omitempty"`
	DefaultContextLength    int               `json:"defaultContextLength,omitempty"`
	UnsupportedParams       []string          `json:"unsupportedParams,omitempty"`
	AnonymousApiKey         string            `json:"anonymousApiKey,omitempty"`
	ModelIDPrefix           string            `json:"modelIdPrefix,omitempty"`
	AcceptedModelIDPrefixes []string          `json:"acceptedModelIdPrefixes,omitempty"`
}

// RegistryOAuth holds OAuth-related metadata for providers that use OAuth.
type RegistryOAuth struct {
	ClientIDEnv     string `json:"clientIdEnv,omitempty"`
	ClientIDDefault string `json:"clientIdDefault,omitempty"`
	ClientSecretEnv string `json:"clientSecretEnv,omitempty"`
	TokenURL        string `json:"tokenUrl,omitempty"`
	RefreshURL      string `json:"refreshUrl,omitempty"`
	AuthURL         string `json:"authUrl,omitempty"`
}

// REASONING_UNSUPPORTED lists parameters rejected by reasoning models.
var REASONING_UNSUPPORTED = []string{
	"temperature",
	"top_p",
	"frequency_penalty",
	"presence_penalty",
	"logprobs",
	"top_logprobs",
	"n",
}

// GPT56Capabilities is the shared capability set for GPT-5.6 family models.
var GPT56Capabilities = RegistryModel{
	TargetFormat:      "openai-responses",
	ToolCalling:       true,
	SupportsReasoning: true,
	SupportsVision:    true,
	ContextLength:     1050000,
	MaxOutputTokens:   128000,
}

var (
	mu              sync.RWMutex
	byID            = make(map[string]*RegistryEntry)
	byAlias         = make(map[string]*RegistryEntry)
	unsupportedOnce sync.Once
	unsupportedMap  map[string][]string
)

// LoadRegistry initializes the global registry. Provider entries are added by
// the providers sub-package via init() -> RegisterProvider(). Call this once
// after all provider imports are resolved.
func LoadRegistry() {
	// init() functions in the providers package run before main and call
	// RegisterProvider, so by the time this is called the map is populated.
	// This function exists as a synchronization point and a place to run
	// post-registration validation.
	mu.RLock()
	defer mu.RUnlock()
}

// RegisterProvider adds or overwrites a provider entry in the global registry.
// Intended to be called by provider init() functions.
func RegisterProvider(entry *RegistryEntry) {
	mu.Lock()
	defer mu.Unlock()

	byID[entry.ID] = entry
	if entry.Alias != "" && entry.Alias != entry.ID {
		byAlias[entry.Alias] = entry
	}
}

// GetRegistryEntry returns a registry entry by provider ID or alias.
// Returns nil if not found.
func GetRegistryEntry(provider string) *RegistryEntry {
	mu.RLock()
	defer mu.RUnlock()

	if e, ok := byID[provider]; ok {
		return e
	}
	if e, ok := byAlias[provider]; ok {
		return e
	}
	return nil
}

// GetRegisteredIDs returns all registered provider IDs.
func GetRegisteredIDs() []string {
	mu.RLock()
	defer mu.RUnlock()

	ids := make([]string, 0, len(byID))
	for id := range byID {
		ids = append(ids, id)
	}
	return ids
}

// GetUnsupportedParams returns the unsupported parameters for a specific model.
// Uses O(1) precomputed lookup. Handles prefixed model IDs (e.g. "openai/o3").
func GetUnsupportedParams(provider, modelID string) []string {
	unsupportedOnce.Do(buildUnsupportedCache)

	mu.RLock()
	defer mu.RUnlock()

	// 1. Check provider's own registry entry (exact model match).
	if e, ok := byID[provider]; ok {
		for _, m := range e.Models {
			if m.ID == modelID && len(m.UnsupportedParams) > 0 {
				return m.UnsupportedParams
			}
		}
	}

	// 2. O(1) lookup in precomputed map (cross-provider routing).
	if cached, ok := unsupportedMap[modelID]; ok {
		return cached
	}

	// 3. Handle prefixed model IDs ("openai/o3" -> "o3").
	if i := strings.LastIndex(modelID, "/"); i >= 0 {
		bare := modelID[i+1:]
		if cached, ok := unsupportedMap[bare]; ok {
			return cached
		}
	}

	// 4. Provider-wide fallback.
	if e, ok := byID[provider]; ok && len(e.UnsupportedParams) > 0 {
		return e.UnsupportedParams
	}

	return nil
}

// GetPassthroughProviders returns the set of provider IDs with passthroughModels enabled.
func GetPassthroughProviders() map[string]bool {
	mu.RLock()
	defer mu.RUnlock()

	out := make(map[string]bool)
	for _, e := range byID {
		if e.PassthroughModels {
			out[e.ID] = true
		}
	}
	return out
}

// NeedsTranslation returns true when sourceFormat and targetFormat differ,
// indicating that request/response translation is required.
func NeedsTranslation(sourceFormat, targetFormat string) bool {
	if sourceFormat == targetFormat {
		return false
	}
	if isOpenAIFamily(sourceFormat) && isOpenAIFamily(targetFormat) {
		return false
	}
	return true
}

func isOpenAIFamily(f string) bool {
	return f == "openai" || f == "openai-responses"
}

func buildUnsupportedCache() {
	mu.RLock()
	defer mu.RUnlock()

	unsupportedMap = make(map[string][]string)
	for _, e := range byID {
		for _, m := range e.Models {
			if len(m.UnsupportedParams) > 0 {
				if _, exists := unsupportedMap[m.ID]; !exists {
					unsupportedMap[m.ID] = m.UnsupportedParams
				}
			}
		}
	}
}
