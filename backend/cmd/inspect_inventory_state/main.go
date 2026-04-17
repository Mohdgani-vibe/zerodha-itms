package main

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"os"

	_ "github.com/jackc/pgx/v5/stdlib"
)

func main() {
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		log.Fatal("DATABASE_URL is required")
	}

	ctx := context.Background()
	db, err := sql.Open("pgx", databaseURL)
	if err != nil {
		log.Fatalf("open database: %v", err)
	}
	defer db.Close()

	if err := db.PingContext(ctx); err != nil {
		log.Fatalf("ping database: %v", err)
	}

	fmt.Println("Recent inventory sync runs:")
	runs, err := db.QueryContext(ctx, `
		SELECT source_type, status, started_at, COALESCE(records_seen, 0), COALESCE(records_upserted, 0), COALESCE(error_text, '')
		FROM inventory_sync_runs
		ORDER BY started_at DESC
		LIMIT 10
	`)
	if err != nil {
		log.Fatalf("query runs: %v", err)
	}
	defer runs.Close()

	for runs.Next() {
		var sourceType string
		var status string
		var startedAt string
		var seen int
		var upserted int
		var errorText string
		if err := runs.Scan(&sourceType, &status, &startedAt, &seen, &upserted, &errorText); err != nil {
			log.Fatalf("scan run: %v", err)
		}
		fmt.Printf("- %s | %s | seen=%d upserted=%d | %s", startedAt, sourceType, seen, upserted, status)
		if errorText != "" {
			fmt.Printf(" | error=%s", errorText)
		}
		fmt.Println()
	}
	if err := runs.Err(); err != nil {
		log.Fatalf("iterate runs: %v", err)
	}

	fmt.Println()
	fmt.Println("Current assets:")
	assets, err := db.QueryContext(ctx, `
		SELECT asset_tag, COALESCE(hostname, ''), COALESCE(name, ''), COALESCE(status, '')
		FROM assets
		ORDER BY asset_tag ASC
	`)
	if err != nil {
		log.Fatalf("query assets: %v", err)
	}
	defer assets.Close()

	for assets.Next() {
		var assetTag string
		var hostname string
		var name string
		var status string
		if err := assets.Scan(&assetTag, &hostname, &name, &status); err != nil {
			log.Fatalf("scan asset: %v", err)
		}
		fmt.Printf("- %s | hostname=%s | name=%s | status=%s\n", assetTag, hostname, name, status)
	}
	if err := assets.Err(); err != nil {
		log.Fatalf("iterate assets: %v", err)
	}
}