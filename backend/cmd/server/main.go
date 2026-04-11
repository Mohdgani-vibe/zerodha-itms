package main

import (
	"context"
	"log"
	"net/http"
	"os/signal"
	"syscall"
	"time"

	"itms/backend/internal/api"
	"itms/backend/internal/app"
	"itms/backend/internal/inventorysync"
	"itms/backend/internal/platform/authn"
	"itms/backend/internal/platform/database"
)

func main() {
	config, err := app.LoadConfig()
	if err != nil {
		log.Fatal(err)
	}

	db, err := database.Open(config.DatabaseURL)
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	if err := database.Migrate(db, config.MigrationDir); err != nil {
		log.Fatal(err)
	}

	if err := database.Seed(db, config, authn.HashPassword); err != nil {
		log.Fatal(err)
	}
	for _, warning := range config.SecurityWarnings() {
		log.Printf("security warning: %s", warning)
	}
	if errors := config.SecurityErrors(); len(errors) > 0 {
		for _, securityError := range errors {
			log.Printf("security error: %s", securityError)
		}
		log.Fatal("refusing to start with insecure configuration while ITMS_ENFORCE_SECURITY=true")
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	syncService := inventorysync.NewService(db, inventorysync.Config{
		Enabled:           config.InventorySyncEnabled,
		SourceType:        config.InventorySyncSourceType,
		SourceURL:         config.InventorySyncSourceURL,
		SourceToken:       config.InventorySyncSourceToken,
		IngestToken:       config.InventoryIngestToken,
		Interval:          config.InventorySyncInterval,
		RunOnStartup:      config.InventorySyncRunOnStartup,
		DefaultEntityID:   config.InventorySyncDefaultEntityID,
		DefaultDeptID:     config.InventorySyncDefaultDeptID,
		DefaultLocationID: config.InventorySyncDefaultLocationID,
	})
	syncService.Start(ctx)

	router := api.NewRouter(db, config, syncService)
	log.Printf("backend listening on %s", config.Address)

	server := &http.Server{
		Addr:              config.Address,
		Handler:           router,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	errCh := make(chan error, 1)
	go func() {
		errCh <- server.ListenAndServe()
	}()

	select {
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		if err := server.Shutdown(shutdownCtx); err != nil {
			log.Fatal(err)
		}
	case err := <-errCh:
		if err != nil && err != http.ErrServerClosed {
			log.Fatal(err)
		}
	}
}
