package config

// ---------------------------------------------------------------------------
// Timeout defaults (milliseconds)
// ---------------------------------------------------------------------------

const (
	// FetchTimeoutMs is the timeout for receiving the initial upstream response.
	FetchTimeoutMs = 600_000

	// StreamIdleTimeoutMs is the idle timeout for SSE streams.
	StreamIdleTimeoutMs = 600_000

	// StreamReadinessTimeoutMs is the timeout for the first non-ping SSE event.
	StreamReadinessTimeoutMs = 80_000

	// StreamReadinessMaxTimeoutMs is the upper bound for adaptive stream readiness.
	StreamReadinessMaxTimeoutMs = 180_000

	// SSEHeartbeatIntervalMs is the keepalive heartbeat interval for SSE streams.
	SSEHeartbeatIntervalMs = 15_000

	// FetchConnectTimeoutMs is the TCP connect timeout for upstream fetches.
	FetchConnectTimeoutMs = 30_000

	// MaxTimerTimeoutMs is the maximum value a Node-style timer can hold.
	MaxTimerTimeoutMs = 2_147_483_647
)

// ---------------------------------------------------------------------------
// HTTP status codes
// ---------------------------------------------------------------------------

const (
	HTTPBadRequest      = 400
	HTTPUnauthorized    = 401
	HTTPPaymentRequired = 402
	HTTPForbidden       = 403
	HTTPNotFound        = 404
	HTTPNotAcceptable   = 406
	HTTPRequestTimeout  = 408
	HTTPRateLimited     = 429
	HTTPServerError     = 500
	HTTPBadGateway      = 502
	HTTPServiceUnavail  = 503
	HTTPGatewayTimeout  = 504
)

// ---------------------------------------------------------------------------
// Backoff and cooldown (milliseconds)
// ---------------------------------------------------------------------------

// BackoffStepsMs defines the exponential backoff steps for rate limits.
// 1min -> 2min -> 5min -> 10min -> 20min
var BackoffStepsMs = []int{
	60_000,
	120_000,
	300_000,
	600_000,
	1_200_000,
}

// BackoffConfig holds exponential backoff parameters.
type BackoffConfig struct {
	Base     int
	Max      int
	MaxLevel int
}

const DefaultBackoffConfigBase = 1000
const DefaultBackoffConfigMax = 2 * 60 * 1000
const DefaultBackoffConfigMaxLevel = 15

// ---------------------------------------------------------------------------
// Cooldown durations (milliseconds)
// ---------------------------------------------------------------------------

const (
	TransientCooldownMs    = 5_000
	CooldownUnauthorized   = 2 * 60 * 1000
	CooldownPaymentReq     = 2 * 60 * 1000
	CooldownNotFound       = 2 * 60 * 1000
	CooldownNotFoundLocal  = 5_000
	CooldownTransientMax   = 60 * 1000
	CooldownRequestNotAllowed = 5_000
	CooldownRateLimit      = 2 * 60 * 1000
	CooldownServiceUnavail = 2 * 1000
	CooldownAuthExpired    = 2 * 60 * 1000
)

// ---------------------------------------------------------------------------
// Default max tokens
// ---------------------------------------------------------------------------

const (
	// DefaultMaxTokens is the default maximum output tokens.
	DefaultMaxTokens = 64_000

	// DefaultMinTokens is the minimum max tokens for tool calling.
	DefaultMinTokens = 32_000

	// DefaultProviderMaxTokens is the fallback per-provider max tokens.
	DefaultProviderMaxTokens = 32_000

	// MaxToolsLimit is the maximum number of tools allowed in a request.
	MaxToolsLimit = 128
)

// ProviderMaxTokens maps provider IDs to their hard output token limits.
var ProviderMaxTokens = map[string]int{
	"groq":       16384,
	"openai":     16384,
	"anthropic":  65536,
	"gemini":     65536,
	"sensenova":  65536,
}

// ---------------------------------------------------------------------------
// Provider resilience profiles
// ---------------------------------------------------------------------------

// ResilienceProfile holds circuit-breaker and cooldown settings for a provider
// category (oauth / apikey / local).
type ResilienceProfile struct {
	TransientCooldown      int
	RateLimitCooldown      int
	MaxBackoffLevel        int
	CircuitBreakerThreshold int
	CircuitBreakerResetMs  int
	ProviderFailureThreshold int
	ProviderFailureWindowMs  int
	ProviderCooldownMs       int
	DegradationThreshold     int
	MaxBackoffMultiplier     int
	BackoffEscalationCount   int
}

var OAuthProfile = ResilienceProfile{
	TransientCooldown:       5000,
	RateLimitCooldown:       60000,
	MaxBackoffLevel:         8,
	CircuitBreakerThreshold: 8,
	CircuitBreakerResetMs:   60000,
	ProviderFailureThreshold: 10,
	ProviderFailureWindowMs:  900000,
	ProviderCooldownMs:       300000,
	DegradationThreshold:     5,
	MaxBackoffMultiplier:     8,
	BackoffEscalationCount:   2,
}

var APIKeyProfile = ResilienceProfile{
	TransientCooldown:       3000,
	RateLimitCooldown:       0,
	MaxBackoffLevel:         5,
	CircuitBreakerThreshold: 12,
	CircuitBreakerResetMs:   30000,
	ProviderFailureThreshold: 15,
	ProviderFailureWindowMs:  1800000,
	ProviderCooldownMs:       600000,
	DegradationThreshold:     7,
	MaxBackoffMultiplier:     4,
	BackoffEscalationCount:   3,
}

var LocalProfile = ResilienceProfile{
	TransientCooldown:       2000,
	RateLimitCooldown:       5000,
	MaxBackoffLevel:         3,
	CircuitBreakerThreshold: 2,
	CircuitBreakerResetMs:   15000,
	ProviderFailureThreshold: 2,
	ProviderFailureWindowMs:  300000,
	ProviderCooldownMs:       60000,
}

// GetProviderProfile returns the resilience profile for a provider category.
func GetProviderProfile(authType string) ResilienceProfile {
	switch authType {
	case "oauth":
		return OAuthProfile
	case "local":
		return LocalProfile
	default:
		return APIKeyProfile
	}
}

// ---------------------------------------------------------------------------
// Rate limit defaults (API key providers)
// ---------------------------------------------------------------------------

type APILimits struct {
	RequestsPerMinute       int
	MinTimeBetweenRequests int
	ConcurrentRequests     int
}

var DefaultAPILimits = APILimits{
	RequestsPerMinute:       60,
	MinTimeBetweenRequests: 350,
	ConcurrentRequests:     6,
}

// ---------------------------------------------------------------------------
// Rate limit reasons
// ---------------------------------------------------------------------------

const (
	RateLimitQuotaExhausted  = "quota_exhausted"
	RateLimitExceeded        = "rate_limit_exceeded"
	RateLimitModelCapacity   = "model_capacity"
	RateLimitServerError     = "server_error"
	RateLimitAuthError       = "auth_error"
	RateLimitUnknown         = "unknown"
)

// ---------------------------------------------------------------------------
// Stream recovery
// ---------------------------------------------------------------------------

type StreamRecoveryConfig struct {
	HolbackMs    int
	BufferMaxBytes int
	EarlyRetryMax int
}

var DefaultStreamRecovery = StreamRecoveryConfig{
	HolbackMs:      750,
	BufferMaxBytes: 65536,
	EarlyRetryMax:  4,
}

// ---------------------------------------------------------------------------
// Skip patterns
// ---------------------------------------------------------------------------

// SkipPatterns contains request text patterns that bypass provider filtering.
var SkipPatterns = []string{
	"Please write a 5-10 word title for the following conversation:",
}

// ---------------------------------------------------------------------------
// Error types (OpenAI-compatible)
// ---------------------------------------------------------------------------

type ErrorInfo struct {
	Type string
	Code string
}

var HTTPErrors = map[int]ErrorInfo{
	400: {Type: "invalid_request_error", Code: "bad_request"},
	401: {Type: "authentication_error", Code: "invalid_api_key"},
	402: {Type: "billing_error", Code: "payment_required"},
	403: {Type: "permission_error", Code: "insufficient_quota"},
	404: {Type: "invalid_request_error", Code: "model_not_found"},
	406: {Type: "invalid_request_error", Code: "model_not_supported"},
	429: {Type: "rate_limit_error", Code: "rate_limit_exceeded"},
	500: {Type: "server_error", Code: "internal_server_error"},
	502: {Type: "server_error", Code: "bad_gateway"},
	503: {Type: "server_error", Code: "service_unavailable"},
	504: {Type: "server_error", Code: "gateway_timeout"},
}

var DefaultErrorMessages = map[int]string{
	400: "Bad request",
	401: "Invalid API key provided",
	402: "Payment required",
	403: "You exceeded your current quota",
	404: "Model not found",
	406: "Model not supported",
	429: "Rate limit exceeded",
	500: "Internal server error",
	502: "Bad gateway - upstream provider error",
	503: "Service temporarily unavailable",
	504: "Gateway timeout",
}

// ---------------------------------------------------------------------------
// System prompts
// ---------------------------------------------------------------------------

const (
	ClaudeSystemPrompt = "You are Claude Code, Anthropic's official CLI for Claude."
)
