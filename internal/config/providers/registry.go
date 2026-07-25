// Package providers registers the core LLM provider entries with the config
// registry. Each provider's init() calls config.RegisterProvider so they are
// available before main() runs. Import this package with a blank identifier
// to ensure all providers are loaded:
//
//	import _ "github.com/omniroute/omniroute/internal/config/providers"
package providers

import (
	"github.com/omniroute/omniroute/internal/config"
)

func init() {
	registerOpenAI()
	registerAnthropic()
	registerDeepSeek()
	registerGroq()
	registerGemini()
	registerMistral()
	registerCohere()
	registerTogether()
	registerFireworks()
	registerCerebras()
	registerNvidia()
	registerXAI()
	registerHuggingFace()
	registerOpenRouter()
	registerSambaNova()
}

// ---------------------------------------------------------------------------
// OpenAI
// ---------------------------------------------------------------------------

func registerOpenAI() {
	config.RegisterProvider(&config.RegistryEntry{
		ID:        "openai",
		Alias:     "openai",
		Format:    "openai",
		Executor:  "default",
		BaseURL:   "https://api.openai.com/v1/chat/completions",
		AuthType:  "apikey",
		AuthHeader: "bearer",
		DefaultContextLength: 128000,
		Models: []config.RegistryModel{
			{
				ID: "gpt-5.6", Name: "GPT-5.6",
				TargetFormat: "openai-responses", ToolCalling: true,
				SupportsReasoning: true, SupportsVision: true,
				ContextLength: 1050000, MaxOutputTokens: 128000,
			},
			{
				ID: "gpt-5.6-sol", Name: "GPT-5.6 Sol",
				TargetFormat: "openai-responses", ToolCalling: true,
				SupportsReasoning: true, SupportsVision: true,
				ContextLength: 1050000, MaxOutputTokens: 128000,
			},
			{
				ID: "gpt-5.6-terra", Name: "GPT-5.6 Terra",
				TargetFormat: "openai-responses", ToolCalling: true,
				SupportsReasoning: true, SupportsVision: true,
				ContextLength: 1050000, MaxOutputTokens: 128000,
			},
			{
				ID: "gpt-5.6-luna", Name: "GPT-5.6 Luna",
				TargetFormat: "openai-responses", ToolCalling: true,
				SupportsReasoning: true, SupportsVision: true,
				ContextLength: 1050000, MaxOutputTokens: 128000,
			},
			{ID: "gpt-5.5", Name: "GPT-5.5", ContextLength: 1050000},
			{
				ID: "gpt-5.5-pro", Name: "GPT-5.5 Pro",
				ContextLength: 1050000, TargetFormat: "openai-responses",
			},
			{ID: "gpt-5.4", Name: "GPT-5.4", ContextLength: 1050000},
			{
				ID: "gpt-5.4-pro", Name: "GPT-5.4 Pro",
				ContextLength: 1050000, TargetFormat: "openai-responses",
			},
			{ID: "gpt-5.4-mini", Name: "GPT-5.4 Mini", ContextLength: 400000},
			{ID: "gpt-5.4-nano", Name: "GPT-5.4 Nano", ContextLength: 400000},
			{ID: "gpt-4.1", Name: "GPT-4.1", ContextLength: 1047576},
			{ID: "gpt-4.1-mini", Name: "GPT-4.1 Mini", ContextLength: 1047576},
			{ID: "gpt-4.1-nano", Name: "GPT-4.1 Nano", ContextLength: 1047576},
			{ID: "gpt-4o", Name: "GPT-4o", ContextLength: 128000},
			{ID: "gpt-4o-mini", Name: "GPT-4o Mini", ContextLength: 128000},
			{
				ID: "o3", Name: "O3", ContextLength: 200000,
				UnsupportedParams: config.REASONING_UNSUPPORTED,
			},
			{
				ID: "o3-mini", Name: "O3 Mini", ContextLength: 200000,
				UnsupportedParams: config.REASONING_UNSUPPORTED,
			},
			{
				ID: "o4-mini", Name: "O4 Mini", ContextLength: 200000,
				UnsupportedParams: config.REASONING_UNSUPPORTED,
			},
		},
	})
}

// ---------------------------------------------------------------------------
// Anthropic
// ---------------------------------------------------------------------------

func registerAnthropic() {
	config.RegisterProvider(&config.RegistryEntry{
		ID:        "anthropic",
		Alias:     "anthropic",
		Format:    "claude",
		Executor:  "default",
		BaseURL:   "https://api.anthropic.com/v1/messages",
		URLSuffix: "?beta=true",
		AuthType:  "apikey",
		AuthHeader: "x-api-key",
		DefaultContextLength: 200000,
		Headers: map[string]string{
			"Anthropic-Version": "2023-06-01",
			"Anthropic-Beta": "claude-code-20250219,interleaved-thinking-2025-05-14," +
				"context-management-2025-06-27,prompt-caching-scope-2026-01-05," +
				"advanced-tool-use-2025-11-20,effort-2025-11-24," +
				"structured-outputs-2025-12-15,fast-mode-2026-02-01," +
				"redact-thinking-2026-02-12,token-efficient-tools-2026-03-28," +
				"advisor-tool-2026-03-01,extended-cache-ttl-2025-04-11," +
				"cache-diagnosis-2026-04-07",
		},
		Models: []config.RegistryModel{
			{
				ID: "claude-fable-5", Name: "Claude Fable 5", ContextLength: 1048576,
				UnsupportedParams: []string{"temperature", "top_p", "top_k"},
			},
			{
				ID: "claude-opus-5", Name: "Claude Opus 5",
				ContextLength: 1000000, MaxOutputTokens: 128000,
				UnsupportedParams: []string{"temperature", "top_p", "top_k"},
			},
			{
				ID: "claude-opus-4.7", Name: "Claude Opus 4.7",
				UnsupportedParams: []string{"temperature", "top_p", "top_k"},
			},
			{
				ID: "claude-opus-4.8", Name: "Claude Opus 4.8", ContextLength: 1048576,
				UnsupportedParams: []string{"temperature", "top_p", "top_k"},
			},
			{ID: "claude-opus-4.6", Name: "Claude Opus 4.6"},
			{ID: "claude-opus-4.5", Name: "Claude Opus 4.5"},
			{
				ID: "claude-sonnet-5", Name: "Claude Sonnet 5", ContextLength: 1048576,
				UnsupportedParams: []string{"temperature", "top_p", "top_k"},
			},
			{ID: "claude-sonnet-4.6", Name: "Claude Sonnet 4.6"},
			{ID: "claude-sonnet-4.5", Name: "Claude Sonnet 4.5"},
			{ID: "claude-haiku-4.5", Name: "Claude Haiku 4.5"},
		},
	})
}

// ---------------------------------------------------------------------------
// DeepSeek
// ---------------------------------------------------------------------------

func registerDeepSeek() {
	config.RegisterProvider(&config.RegistryEntry{
		ID:        "deepseek",
		Alias:     "ds",
		Format:    "openai",
		Executor:  "default",
		BaseURL:   "https://api.deepseek.com/v1/chat/completions",
		AuthType:  "apikey",
		AuthHeader: "bearer",
		Models: []config.RegistryModel{
			{ID: "deepseek-v4-pro", Name: "DeepSeek V4 Pro", SupportsReasoning: true},
			{ID: "deepseek-v4-flash", Name: "DeepSeek V4 Flash", SupportsReasoning: true},
		},
	})
}

// ---------------------------------------------------------------------------
// Groq
// ---------------------------------------------------------------------------

func registerGroq() {
	config.RegisterProvider(&config.RegistryEntry{
		ID:        "groq",
		Alias:     "groq",
		Format:    "openai",
		Executor:  "default",
		BaseURL:   "https://api.groq.com/openai/v1/chat/completions",
		AuthType:  "apikey",
		AuthHeader: "bearer",
		Models: []config.RegistryModel{
			{
				ID: "meta-llama/llama-4-scout-17b-16e-instruct",
				Name: "Llama 4 Scout", SupportsReasoning: false,
			},
			{
				ID: "llama-3.3-70b-versatile",
				Name: "Llama 3.3 70B", SupportsReasoning: false,
			},
			{ID: "openai/gpt-oss-120b", Name: "GPT-OSS 120B"},
			{ID: "openai/gpt-oss-20b", Name: "GPT-OSS 20B"},
			{ID: "qwen/qwen3-32b", Name: "Qwen3 32B"},
			{ID: "qwen/qwen3.6-27b", Name: "Qwen3.6 27B"},
			{ID: "openai/gpt-oss-safeguard-20b", Name: "GPT-OSS Safeguard 20B"},
		},
	})
}

// ---------------------------------------------------------------------------
// Gemini
// ---------------------------------------------------------------------------

func registerGemini() {
	config.RegisterProvider(&config.RegistryEntry{
		ID:        "gemini",
		Alias:     "gemini",
		Format:    "gemini",
		Executor:  "default",
		BaseURL:   "https://generativelanguage.googleapis.com/v1beta/models",
		AuthType:  "apikey",
		AuthHeader: "x-goog-api-key",
		DefaultContextLength: 1048576,
		Models: []config.RegistryModel{
			{
				ID: "gemini-3.1-pro-preview", Name: "Gemini 3.1 Pro Preview",
				ToolCalling: true, SupportsVision: true,
			},
			{
				ID: "gemini-3-flash-preview", Name: "Gemini 3 Flash Preview",
				ToolCalling: true, SupportsVision: true,
			},
			{
				ID: "gemini-3.1-flash-lite", Name: "Gemini 3.1 Flash Lite",
				ToolCalling: true, SupportsVision: true,
			},
			{
				ID: "gemini-3.5-flash", Name: "Gemini 3.5 Flash",
				ToolCalling: true, SupportsVision: true,
			},
			{ID: "gemini-3.1-flash-tts-preview", Name: "Gemini 3.1 Flash TTS"},
			{
				ID: "gemini-2.5-pro", Name: "Gemini 2.5 Pro",
				ToolCalling: true, SupportsVision: true,
			},
			{
				ID: "gemini-2.5-flash", Name: "Gemini 2.5 Flash",
				ToolCalling: true, SupportsVision: true,
			},
			{
				ID: "gemini-2.5-flash-lite", Name: "Gemini 2.5 Flash Lite",
				ToolCalling: true, SupportsVision: true,
			},
		},
	})
}

// ---------------------------------------------------------------------------
// Mistral
// ---------------------------------------------------------------------------

func registerMistral() {
	config.RegisterProvider(&config.RegistryEntry{
		ID:        "mistral",
		Alias:     "mistral",
		Format:    "openai",
		Executor:  "default",
		BaseURL:   "https://api.mistral.ai/v1/chat/completions",
		AuthType:  "apikey",
		AuthHeader: "bearer",
		Models: []config.RegistryModel{
			{ID: "mistral-large-latest", Name: "Mistral Large 3"},
			{ID: "mistral-medium-3-5", Name: "Mistral Medium 3.5"},
			{ID: "mistral-small-latest", Name: "Mistral Small 4"},
			{ID: "devstral-latest", Name: "Devstral 2"},
			{ID: "codestral-latest", Name: "Codestral"},
		},
	})
}

// ---------------------------------------------------------------------------
// Cohere
// ---------------------------------------------------------------------------

func registerCohere() {
	config.RegisterProvider(&config.RegistryEntry{
		ID:        "cohere",
		Alias:     "cohere",
		Format:    "openai",
		Executor:  "default",
		BaseURL:   "https://api.cohere.com/compatibility/v1/chat/completions",
		ModelsURL: "https://api.cohere.com/compatibility/v1/models",
		AuthType:  "apikey",
		AuthHeader: "bearer",
		Models: []config.RegistryModel{
			{ID: "command-a-reasoning-08-2025", Name: "Command A Reasoning (Aug 2025)"},
			{ID: "command-a-vision-07-2025", Name: "Command A Vision (Jul 2025)"},
			{ID: "command-a-03-2025", Name: "Command A (Mar 2025)"},
			{ID: "command-r7b-12-2024", Name: "Command R7B (Dec 2024)"},
			{ID: "command-r-plus-08-2024", Name: "Command R Plus (Aug 2024)"},
			{ID: "command-r-08-2024", Name: "Command R (Aug 2024)"},
		},
	})
}

// ---------------------------------------------------------------------------
// Together
// ---------------------------------------------------------------------------

func registerTogether() {
	config.RegisterProvider(&config.RegistryEntry{
		ID:        "together",
		Alias:     "together",
		Format:    "openai",
		Executor:  "default",
		BaseURL:   "https://api.together.xyz/v1/chat/completions",
		AuthType:  "apikey",
		AuthHeader: "bearer",
		Models: []config.RegistryModel{
			{ID: "meta-llama/Llama-3.3-70B-Instruct-Turbo-Free", Name: "Llama 3.3 70B Turbo (Free)"},
			{ID: "meta-llama/Llama-Vision-Free", Name: "Llama Vision (Free)"},
			{ID: "deepseek-ai/DeepSeek-R1-Distill-Llama-70B-Free", Name: "DeepSeek R1 Distill 70B (Free)"},
			{ID: "meta-llama/Llama-3.3-70B-Instruct-Turbo", Name: "Llama 3.3 70B Turbo"},
			{ID: "deepseek-ai/DeepSeek-R1", Name: "DeepSeek R1"},
			{ID: "Qwen/Qwen3-235B-A22B", Name: "Qwen3 235B"},
			{ID: "meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8", Name: "Llama 4 Maverick"},
		},
	})
}

// ---------------------------------------------------------------------------
// Fireworks
// ---------------------------------------------------------------------------

func registerFireworks() {
	config.RegisterProvider(&config.RegistryEntry{
		ID:        "fireworks",
		Alias:     "fireworks",
		Format:    "openai",
		Executor:  "default",
		BaseURL:   "https://api.fireworks.ai/inference/v1/chat/completions",
		ModelsURL: "https://api.fireworks.ai/v1/accounts/fireworks/models?filter=supports_serverless=true",
		AuthType:  "apikey",
		AuthHeader: "bearer",
		Models: []config.RegistryModel{
			{ID: "deepseek-v4-flash", Name: "DeepSeek V4 Flash", SupportsReasoning: true},
			{ID: "deepseek-v4-pro", Name: "DeepSeek V4 Pro", SupportsReasoning: true},
			{ID: "glm-5p1", Name: "GLM 5.1"},
			{ID: "gpt-oss-120b", Name: "OpenAI gpt-oss-120b"},
			{ID: "gpt-oss-20b", Name: "OpenAI gpt-oss-20b"},
			{ID: "kimi-k2p5", Name: "Kimi K2.5"},
			{ID: "kimi-k2p6", Name: "Kimi K2.6"},
			{ID: "minimax-m2p5", Name: "MiniMax M2.5"},
			{ID: "minimax-m2p7", Name: "MiniMax M2.7"},
			{ID: "qwen3p6-plus", Name: "Qwen3.6 Plus"},
		},
	})
}

// ---------------------------------------------------------------------------
// Cerebras
// ---------------------------------------------------------------------------

func registerCerebras() {
	config.RegisterProvider(&config.RegistryEntry{
		ID:        "cerebras",
		Alias:     "cerebras",
		Format:    "openai",
		Executor:  "default",
		BaseURL:   "https://api.cerebras.ai/v1/chat/completions",
		AuthType:  "apikey",
		AuthHeader: "bearer",
		Models: []config.RegistryModel{
			{ID: "zai-glm-4.7", Name: "GLM 4.7"},
			{ID: "gemma-4-31b", Name: "Gemma 4 31B"},
			{ID: "gpt-oss-120b", Name: "GPT OSS 120B"},
		},
	})
}

// ---------------------------------------------------------------------------
// NVIDIA
// ---------------------------------------------------------------------------

func registerNvidia() {
	config.RegisterProvider(&config.RegistryEntry{
		ID:                 "nvidia",
		Alias:              "nvidia",
		Format:             "openai",
		Executor:           "default",
		BaseURL:            "https://integrate.api.nvidia.com/v1/chat/completions",
		AuthType:           "apikey",
		AuthHeader:         "bearer",
		PassthroughModels:  true,
		Models: []config.RegistryModel{
			{ID: "z-ai/glm-5.2", Name: "GLM 5.2"},
			{ID: "minimaxai/minimax-m2.7", Name: "MiniMax M2.7"},
			{ID: "google/gemma-4-31b-it", Name: "Gemma 4 31B"},
			{ID: "mistralai/mistral-small-4-119b-2603", Name: "Mistral Small 4 2603"},
			{ID: "mistralai/mistral-large-3-675b-instruct-2512", Name: "Mistral Large 3 675B"},
			{ID: "mistralai/devstral-2-123b-instruct-2512", Name: "Devstral 2 123B"},
			{ID: "qwen/qwen3.5-397b-a17b", Name: "Qwen3.5-397B-A17B"},
			{ID: "qwen/qwen3.5-122b-a10b", Name: "Qwen3.5-122B-A10B"},
			{ID: "stepfun-ai/step-3.5-flash", Name: "Step 3.5 Flash"},
			{ID: "stepfun-ai/step-3.7-flash", Name: "Step 3.7 Flash"},
			{ID: "deepseek-ai/deepseek-v4-pro", Name: "DeepSeek V4 Pro", SupportsReasoning: true},
			{ID: "deepseek-ai/deepseek-v4-flash", Name: "DeepSeek V4 Flash", SupportsReasoning: true},
			{ID: "moonshotai/kimi-k2.6", Name: "Kimi K2.6"},
			{ID: "openai/gpt-oss-120b", Name: "GPT OSS 120B", ToolCalling: false},
			{ID: "openai/gpt-oss-20b", Name: "GPT OSS 20B", ToolCalling: false},
			{ID: "nvidia/nemotron-3-super-120b-a12b", Name: "Nemotron 3 Super 120B A12B"},
			{ID: "nvidia/nemotron-3-ultra-550b-a55b", Name: "Nemotron 3 Ultra 550B"},
			{ID: "abacusai/dracarys-llama-3.1-70b-instruct", Name: "Dracarys Llama 3.1 70B Instruct"},
			{ID: "google/gemma-2-2b-it", Name: "Gemma 2 2B IT"},
			{ID: "google/gemma-3n-e2b-it", Name: "Gemma 3n E2B IT"},
			{ID: "meta/llama-3.1-8b-instruct", Name: "Llama 3.1 8B Instruct", ToolCalling: false},
			{ID: "meta/llama-3.2-11b-vision-instruct", Name: "Llama 3.2 11B Vision Instruct", SupportsVision: true},
			{ID: "meta/llama-3.2-1b-instruct", Name: "Llama 3.2 1B Instruct"},
			{ID: "meta/llama-3.2-3b-instruct", Name: "Llama 3.2 3B Instruct", ToolCalling: false},
			{ID: "meta/llama-3.2-90b-vision-instruct", Name: "Llama 3.2 90B Vision Instruct", SupportsVision: true},
			{ID: "meta/llama-4-maverick-17b-128e-instruct", Name: "Llama 4 Maverick 17B 128E Instruct"},
			{ID: "meta/llama-guard-4-12b", Name: "Llama Guard 4 12B", ToolCalling: false},
			{ID: "mistralai/ministral-14b-instruct-2512", Name: "Ministral 14B Instruct 2512"},
			{ID: "mistralai/mistral-medium-3.5-128b", Name: "Mistral Medium 3.5 128B"},
			{ID: "mistralai/mistral-nemotron", Name: "Mistral Nemotron"},
			{ID: "mistralai/mixtral-8x7b-instruct-v0.1", Name: "Mixtral 8x7B Instruct v0.1"},
			{ID: "nvidia/ising-calibration-1-35b-a3b", Name: "Ising Calibration 1 35B A3B", SupportsReasoning: true},
			{ID: "nvidia/llama-3.1-nemoguard-8b-content-safety", Name: "Llama 3.1 Nemoguard 8B Content Safety"},
			{ID: "nvidia/llama-3.1-nemoguard-8b-topic-control", Name: "Llama 3.1 Nemoguard 8B Topic Control"},
			{ID: "nvidia/llama-3.1-nemotron-nano-8b-v1", Name: "Llama 3.1 Nemotron Nano 8B v1"},
			{
				ID: "nvidia/llama-3.1-nemotron-nano-vl-8b-v1",
				Name: "Llama 3.1 Nemotron Nano VL 8B v1", SupportsVision: true,
			},
			{ID: "nvidia/llama-3.1-nemotron-safety-guard-8b-v3", Name: "Llama 3.1 Nemotron Safety Guard 8B v3"},
			{ID: "nvidia/llama-3.3-nemotron-super-49b-v1", Name: "Llama 3.3 Nemotron Super 49B v1"},
			{ID: "nvidia/llama-3.3-nemotron-super-49b-v1.5", Name: "Llama 3.3 Nemotron Super 49B v1.5"},
			{ID: "nvidia/nemotron-3-content-safety", Name: "Nemotron 3 Content Safety"},
			{
				ID: "nvidia/nemotron-3-nano-30b-a3b",
				Name: "Nemotron 3 Nano 30B A3B", SupportsReasoning: true,
			},
			{
				ID: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
				Name: "Nemotron 3 Nano Omni 30B A3B Reasoning",
				SupportsReasoning: true, SupportsVision: true,
			},
			{ID: "nvidia/nemotron-3.5-content-safety", Name: "Nemotron 3.5 Content Safety"},
			{ID: "nvidia/nemotron-mini-4b-instruct", Name: "Nemotron Mini 4B Instruct"},
			{
				ID: "nvidia/nemotron-nano-12b-v2-vl",
				Name: "Nemotron Nano 12B v2 VL",
				SupportsReasoning: true, SupportsVision: true,
			},
			{
				ID: "nvidia/nvidia-nemotron-nano-9b-v2",
				Name: "NVIDIA Nemotron Nano 9B v2", SupportsReasoning: true,
			},
			{ID: "nvidia/riva-translate-4b-instruct-v1.1", Name: "Riva Translate 4B Instruct v1.1"},
			{
				ID: "qwen/qwen3-next-80b-a3b-instruct",
				Name: "Qwen3 Next 80B A3B Instruct", SupportsReasoning: true,
			},
			{ID: "sarvamai/sarvam-m", Name: "Sarvam M"},
			{ID: "stockmark/stockmark-2-100b-instruct", Name: "Stockmark 2 100B Instruct"},
			{ID: "upstage/solar-10.7b-instruct", Name: "Solar 10.7B Instruct"},
		},
	})
}

// ---------------------------------------------------------------------------
// xAI
// ---------------------------------------------------------------------------

func registerXAI() {
	config.RegisterProvider(&config.RegistryEntry{
		ID:           "xai",
		Alias:        "xai",
		Format:       "openai",
		Executor:     "xai",
		BaseURL:      "https://api.x.ai/v1/chat/completions",
		ResponsesURL: "https://api.x.ai/v1/responses",
		AuthType:     "apikey",
		AuthHeader:   "bearer",
		Models: []config.RegistryModel{
			{ID: "grok-4.3", Name: "Grok 4.3"},
			{ID: "grok-build-0.1", Name: "Grok Build 0.1", ContextLength: 256000},
			{
				ID: "grok-4.20-multi-agent-0309", Name: "Grok 4.20 Multi Agent",
				TargetFormat: "openai-responses",
			},
			{ID: "grok-4.20-0309-reasoning", Name: "Grok 4.20 Reasoning"},
			{ID: "grok-4.20-0309-non-reasoning", Name: "Grok 4.20"},
		},
	})
}

// ---------------------------------------------------------------------------
// HuggingFace
// ---------------------------------------------------------------------------

func registerHuggingFace() {
	config.RegisterProvider(&config.RegistryEntry{
		ID:        "huggingface",
		Alias:     "hf",
		Format:    "openai",
		Executor:  "default",
		BaseURL:   "https://router.huggingface.co/v1/chat/completions",
		ModelsURL: "https://router.huggingface.co/v1/models",
		AuthType:  "apikey",
		AuthHeader: "bearer",
		Models: []config.RegistryModel{
			{ID: "meta-llama/llama-3.1-8b-instruct", Name: "Llama 3.1 8B"},
			{ID: "meta-llama/llama-3.2-11b-instruct", Name: "Llama 3.2 11B"},
			{ID: "mistralai/mistral-7b-instruct", Name: "Mistral 7B"},
			{ID: "google/gemma-2-9b-it", Name: "Gemma 2 9B"},
			{ID: "Qwen/Qwen2.5-7B-Instruct", Name: "Qwen 2.5 7B"},
			{ID: "deepseek-ai/DeepSeek-V3", Name: "DeepSeek V3"},
		},
	})
}

// ---------------------------------------------------------------------------
// OpenRouter
// ---------------------------------------------------------------------------

func registerOpenRouter() {
	config.RegisterProvider(&config.RegistryEntry{
		ID:        "openrouter",
		Alias:     "openrouter",
		Format:    "openai",
		Executor:  "default",
		BaseURL:   "https://openrouter.ai/api/v1/chat/completions",
		AuthType:  "apikey",
		AuthHeader: "bearer",
		DefaultContextLength: 128000,
		Headers: map[string]string{
			"HTTP-Referer": "https://endpoint-proxy.local",
			"X-Title":      "Endpoint Proxy",
		},
		Models: []config.RegistryModel{
			{ID: "auto", Name: "Auto (Best Available)"},
		},
	})
}

// ---------------------------------------------------------------------------
// SambaNova
// ---------------------------------------------------------------------------

func registerSambaNova() {
	config.RegisterProvider(&config.RegistryEntry{
		ID:        "sambanova",
		Alias:     "samba",
		Format:    "openai",
		Executor:  "default",
		BaseURL:   "https://api.sambanova.ai/v1/chat/completions",
		AuthType:  "apikey",
		AuthHeader: "bearer",
		Models: []config.RegistryModel{
			{ID: "MiniMax-M2.7", Name: "MiniMax M2.7"},
			{ID: "DeepSeek-V3.2", Name: "DeepSeek V3.2"},
			{ID: "Llama-4-Maverick-17B-128E-Instruct", Name: "Llama 4 Maverick"},
			{ID: "Meta-Llama-3.3-70B-Instruct", Name: "Meta Llama 3.3 70B Instruct"},
			{ID: "gpt-oss-120b", Name: "GPT OSS 120B"},
		},
	})
}
