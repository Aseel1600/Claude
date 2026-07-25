package db

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

var migrationFileRe = regexp.MustCompile(`^(\d{3})_(.+)\.sql$`)

// runMigrationsFromDir reads numbered .sql files from dir, checks which have
// already been applied via the _omniroute_migrations table, and applies pending
// ones in order. Each migration runs inside its own transaction.
func runMigrationsFromDir(d *sql.DB, dir string) error {
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil // No migrations directory — fresh install, nothing to do.
		}
		return fmt.Errorf("read migrations dir: %w", err)
	}

	type migrationFile struct {
		version string
		name    string
		path    string
	}

	var files []migrationFile
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		m := migrationFileRe.FindStringSubmatch(e.Name())
		if m == nil {
			continue
		}
		files = append(files, migrationFile{
			version: m[1],
			name:    m[2],
			path:    filepath.Join(dir, e.Name()),
		})
	}

	if len(files) == 0 {
		return nil
	}

	// Sort by version number ascending.
	sort.Slice(files, func(i, j int) bool {
		return files[i].version < files[j].version
	})

	// Fetch already-applied versions.
	applied, err := getAppliedMigrations(d)
	if err != nil {
		return fmt.Errorf("list applied migrations: %w", err)
	}

	for _, f := range files {
		if applied[f.version] {
			continue
		}

		contents, err := os.ReadFile(f.path)
		if err != nil {
			return fmt.Errorf("read migration %s: %w", f.version, err)
		}

		sqlContent := strings.TrimSpace(string(contents))
		if sqlContent == "" {
			continue
		}

		if err := applyMigration(d, f.version, f.name, sqlContent); err != nil {
			return fmt.Errorf("apply migration %s_%s: %w", f.version, f.name, err)
		}
	}
	return nil
}

// getAppliedMigrations returns the set of migration versions already recorded.
func getAppliedMigrations(d *sql.DB) (map[string]bool, error) {
	rows, err := d.Query("SELECT version FROM _omniroute_migrations")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	applied := make(map[string]bool)
	for rows.Next() {
		var version string
		if err := rows.Scan(&version); err != nil {
			return nil, err
		}
		applied[version] = true
	}
	return applied, rows.Err()
}

// applyMigration runs a single migration inside a transaction, records it on success.
func applyMigration(d *sql.DB, version, name, sqlContent string) error {
	tx, err := d.Begin()
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck

	if _, err := tx.Exec(sqlContent); err != nil {
		return fmt.Errorf("exec: %w", err)
	}

	if _, err := tx.Exec(
		"INSERT INTO _omniroute_migrations (version, name) VALUES (?, ?)",
		version, name,
	); err != nil {
		return fmt.Errorf("record migration: %w", err)
	}

	return tx.Commit()
}
