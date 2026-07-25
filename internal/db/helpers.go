package db

import (
	"encoding/json"
	"strconv"
	"strings"
)

// joinConditions joins SQL conditions with AND.
func joinConditions(conds []string) string {
	return strings.Join(conds, " AND ")
}

// toInt extracts an int from an interface{} value.
func toInt(v interface{}) int {
	switch n := v.(type) {
	case int:
		return n
	case int64:
		return int(n)
	case float64:
		return int(n)
	case json.Number:
		i, _ := n.Int64()
		return int(i)
	case string:
		i, _ := strconv.Atoi(n)
		return i
	default:
		return 0
	}
}

// toBoolDefault extracts a bool, returning def if nil or not convertible.
func toBoolDefault(v interface{}, def bool) bool {
	if v == nil {
		return def
	}
	switch b := v.(type) {
	case bool:
		return b
	case int:
		return b != 0
	case int64:
		return b != 0
	case float64:
		return b != 0
	case string:
		return b == "true" || b == "1"
	default:
		return def
	}
}

// toStringPtr returns a *string from an interface{}, nil if empty or not a string.
func toStringPtr(v interface{}) *string {
	s, ok := v.(string)
	if !ok || s == "" {
		return nil
	}
	return &s
}

// jsonString marshals v to a JSON string, or returns "null" on error.
func jsonString(v interface{}) string {
	if v == nil {
		return "null"
	}
	b, err := json.Marshal(v)
	if err != nil {
		return "null"
	}
	return string(b)
}

// jsonStringOrEmpty marshals v to a JSON string, or returns "" if nil.
func jsonStringOrEmpty(v interface{}) string {
	if v == nil {
		return ""
	}
	b, err := json.Marshal(v)
	if err != nil {
		return ""
	}
	return string(b)
}

// coalesceString returns the first non-empty string from the arguments.
func coalesceString(vals ...string) string {
	for _, s := range vals {
		if s != "" {
			return s
		}
	}
	return ""
}
