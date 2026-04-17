package main

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"

	"itms/backend/internal/app"
	"itms/backend/internal/platform/authn"
	"itms/backend/internal/platform/database"
)

var resetTables = []string{
	"announcement_reads",
	"announcements",
	"chat_messages",
	"chat_members",
	"chat_channels",
	"request_comments",
	"requests",
	"alerts",
	"gatepasses",
	"stock_items",
	"asset_alerts",
	"asset_history",
	"asset_network_snapshots",
	"asset_software_inventory",
	"asset_compute_details",
	"assets",
	"inventory_sync_runs",
	"refresh_tokens",
	"audit_log",
	"user_entity_access",
	"hostname_sequences",
	"users",
}

func main() {
	config, err := app.LoadConfig()
	if err != nil {
		log.Fatalf("load config: %v", err)
	}

	db, err := sql.Open("pgx", config.DatabaseURL)
	if err != nil {
		log.Fatalf("open database: %v", err)
	}
	defer db.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if err := db.PingContext(ctx); err != nil {
		log.Fatalf("ping database: %v", err)
	}

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		log.Fatalf("begin transaction: %v", err)
	}
	defer tx.Rollback()

	for _, tableName := range resetTables {
		if _, err := tx.ExecContext(ctx, fmt.Sprintf("TRUNCATE TABLE %s RESTART IDENTITY CASCADE", tableName)); err != nil {
			log.Fatalf("truncate %s: %v", tableName, err)
		}
	}

	if err := tx.Commit(); err != nil {
		log.Fatalf("commit reset transaction: %v", err)
	}

	if err := database.Seed(db, config, authn.HashPassword); err != nil {
		log.Fatalf("seed database: %v", err)
	}

	fmt.Printf("Reset operational data and recreated default admin %s\n", config.DefaultAdminEmail)
}
