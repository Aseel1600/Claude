package main

import (
	"bufio"
	"os"
	"strings"
)

// loadDotEnv reads a .env file and sets environment variables for keys that
// are not already set. Lines starting with # and blank lines are ignored.
// Supports KEY=VALUE, KEY="VALUE", and KEY='VALUE'.
func loadDotEnv(path string) {
	f, err := os.Open(path)
	if err != nil {
		return // silently ignore missing .env
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}

		key, value, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		key = strings.TrimSpace(key)
		value = strings.TrimSpace(value)

		// Strip surrounding quotes
		if len(value) >= 2 {
			if (value[0] == '"' && value[len(value)-1] == '"') ||
				(value[0] == '\'' && value[len(value)-1] == '\'') {
				value = value[1 : len(value)-1]
			}
		}

		// Only set if not already in environment (existing env wins)
		if os.Getenv(key) == "" {
			os.Setenv(key, value)
		}
	}
}
