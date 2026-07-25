package config

import (
	"strings"
)

// RoutingStrategy represents a combo routing strategy.
type RoutingStrategy string

const (
	StrategyPriority       RoutingStrategy = "priority"
	StrategyWeighted       RoutingStrategy = "weighted"
	StrategyRoundRobin     RoutingStrategy = "round-robin"
	StrategyContextRelay   RoutingStrategy = "context-relay"
	StrategyFillFirst      RoutingStrategy = "fill-first"
	StrategyP2C            RoutingStrategy = "p2c"
	StrategyRandom         RoutingStrategy = "random"
	StrategyLeastUsed      RoutingStrategy = "least-used"
	StrategyCostOptimized  RoutingStrategy = "cost-optimized"
	StrategyResetAware     RoutingStrategy = "reset-aware"
	StrategyResetWindow    RoutingStrategy = "reset-window"
	StrategyHeadroom       RoutingStrategy = "headroom"
	StrategyStrictRandom   RoutingStrategy = "strict-random"
	StrategyAuto           RoutingStrategy = "auto"
	StrategyLkgp           RoutingStrategy = "lkgp"
	StrategyContextOptimal RoutingStrategy = "context-optimized"
	StrategyCacheOptimized RoutingStrategy = "cache-optimized"
	StrategyFusion         RoutingStrategy = "fusion"
	StrategyPipeline       RoutingStrategy = "pipeline"
)

// Internal-only strategies used by system-generated combos (e.g. quota-share).
// Never exposed in the UI or user-facing API.
const (
	StrategyQuotaShare RoutingStrategy = "quota-share"
)

// allStrategies is the set of valid user-facing strategy values.
var allStrategies = map[RoutingStrategy]bool{
	StrategyPriority:       true,
	StrategyWeighted:       true,
	StrategyRoundRobin:     true,
	StrategyContextRelay:   true,
	StrategyFillFirst:      true,
	StrategyP2C:            true,
	StrategyRandom:         true,
	StrategyLeastUsed:      true,
	StrategyCostOptimized:  true,
	StrategyResetAware:     true,
	StrategyResetWindow:    true,
	StrategyHeadroom:       true,
	StrategyStrictRandom:   true,
	StrategyAuto:           true,
	StrategyLkgp:           true,
	StrategyContextOptimal: true,
	StrategyCacheOptimized: true,
	StrategyFusion:         true,
	StrategyPipeline:       true,
}

// internalStrategies holds values that are valid but never user-facing.
var internalStrategies = map[RoutingStrategy]bool{
	StrategyQuotaShare: true,
}

// AllRoutingStrategies returns every valid user-facing strategy in display order.
func AllRoutingStrategies() []RoutingStrategy {
	return []RoutingStrategy{
		StrategyPriority,
		StrategyWeighted,
		StrategyRoundRobin,
		StrategyContextRelay,
		StrategyFillFirst,
		StrategyP2C,
		StrategyRandom,
		StrategyLeastUsed,
		StrategyCostOptimized,
		StrategyResetAware,
		StrategyResetWindow,
		StrategyHeadroom,
		StrategyStrictRandom,
		StrategyAuto,
		StrategyLkgp,
		StrategyContextOptimal,
		StrategyCacheOptimized,
		StrategyFusion,
		StrategyPipeline,
	}
}

// AccountFallbackStrategies are strategies eligible for account-level fallback.
var AccountFallbackStrategies = []RoutingStrategy{
	StrategyPriority,
	StrategyWeighted,
	StrategyFillFirst,
	StrategyRoundRobin,
	StrategyP2C,
	StrategyRandom,
	StrategyLeastUsed,
	StrategyCostOptimized,
	StrategyStrictRandom,
}

// NormalizeStrategy normalizes a raw string into a valid RoutingStrategy.
// Returns StrategyPriority for unrecognized or empty values.
// Preserves internal-only strategies (e.g. quota-share) verbatim.
func NormalizeStrategy(s string) RoutingStrategy {
	if s == "" {
		return StrategyPriority
	}

	normalized := strings.TrimSpace(strings.ToLower(s))

	// Legacy aliases
	switch normalized {
	case "usage":
		return StrategyLeastUsed
	case "context":
		return StrategyContextOptimal
	case "weekly-reset", "reset-window-order":
		return StrategyResetWindow
	}

	// Internal strategies are preserved as-is (never stripped to priority).
	if internalStrategies[RoutingStrategy(normalized)] {
		return RoutingStrategy(normalized)
	}

	if allStrategies[RoutingStrategy(normalized)] {
		return RoutingStrategy(normalized)
	}

	return StrategyPriority
}
