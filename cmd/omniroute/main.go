package main

import (
	"context"
	"flag"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/omniroute/omniroute/internal/config"
	_ "github.com/omniroute/omniroute/internal/config/providers"
	"github.com/omniroute/omniroute/internal/db"
	"github.com/omniroute/omniroute/internal/server"
)

func main() {
	loadDotEnv(".env")

	port := flag.Int("port", 3000, "HTTP server port")
	dataDir := flag.String("data-dir", defaultDataDir(), "Data directory for SQLite DB")
	flag.Parse()

	logger := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo}))
	slog.SetDefault(logger)

	slog.Info("starting omniroute", "port", *port, "data_dir", *dataDir)

	if err := db.Initialize(*dataDir); err != nil {
		slog.Error("failed to initialize database", "error", err)
		os.Exit(1)
	}
	defer db.Close()

	config.LoadRegistry()

	srv := server.New(*port)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	// Use a channel to propagate server errors instead of os.Exit in a goroutine
	// so that defers (db.Close) actually run.
	serverErr := make(chan error, 1)
	go func() {
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			serverErr <- err
		}
	}()

	slog.Info("server listening", "port", *port)

	select {
	case <-ctx.Done():
	case err := <-serverErr:
		slog.Error("server error", "error", err)
	}
	slog.Info("shutting down...")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		slog.Error("shutdown error", "error", err)
	}

	slog.Info("bye")
}

func defaultDataDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		home = "."
	}
	return home + "/.omniroute"
}
