package executor

import (
	"strings"
	"sync"

	"github.com/omniroute/omniroute/internal/config"
)

var (
	executorMu sync.RWMutex
	executors  = make(map[string]Executor)
)

// GetExecutor returns the appropriate executor for a provider.
// Currently returns DefaultExecutor for all providers; provider-specific
// executors can be added via RegisterExecutor.
func GetExecutor(provider string) Executor {
	executorMu.RLock()
	if exec, ok := executors[provider]; ok {
		executorMu.RUnlock()
		return exec
	}
	executorMu.RUnlock()

	cfg := config.GetRegistryEntry(provider)
	if cfg == nil {
		cfg = &config.RegistryEntry{
			ID:         provider,
			Format:     "openai",
			AuthType:   "api_key",
			AuthHeader: "bearer",
		}
	}

	return newDefaultOrSpecialized(provider, cfg)
}

// RegisterExecutor registers a custom executor for a provider.
func RegisterExecutor(provider string, exec Executor) {
	executorMu.Lock()
	defer executorMu.Unlock()
	executors[provider] = exec
}

func newDefaultOrSpecialized(provider string, cfg *config.RegistryEntry) Executor {
	// Provider-specific executors go here as the Go port grows.
	// For now, all providers use DefaultExecutor.
	return NewDefaultExecutor(provider, cfg)
}

// IsOpenAICompatible returns true if the provider uses OpenAI chat completions format.
func IsOpenAICompatible(provider string) bool {
	if strings.HasPrefix(provider, "openai-compatible-") {
		return true
	}
	cfg := config.GetRegistryEntry(provider)
	if cfg == nil {
		return false
	}
	return cfg.Format == "openai" || cfg.Format == ""
}

// IsClaudeCodeCompatible returns true if the provider supports Claude Code protocol.
func IsClaudeCodeCompatible(provider string) bool {
	return strings.HasPrefix(provider, "anthropic-compatible-cc-")
}
