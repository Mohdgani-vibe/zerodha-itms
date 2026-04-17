package main

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"os"

	_ "github.com/jackc/pgx/v5/stdlib"
)

var demoAssetTags = []string{
	"AUTOV52525",
	"HOST53868",
	"Z-IT-1001",
	"Z-IT-1002",
	"Z-IT-1003",
}

var demoRequestTitles = []string{
	"Device enrollment review for AUTOV52525",
	"Device enrollment review for HOST53868",
}

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

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		log.Fatalf("begin transaction: %v", err)
	}
	defer tx.Rollback()

	requestDeleteResult, err := tx.ExecContext(ctx, `DELETE FROM requests WHERE title = ANY($1)`, demoRequestTitles)
	if err != nil {
		log.Fatalf("delete demo requests: %v", err)
	}

	assetDeleteResult, err := tx.ExecContext(ctx, `DELETE FROM assets WHERE asset_tag = ANY($1)`, demoAssetTags)
	if err != nil {
		log.Fatalf("delete demo assets: %v", err)
	}

	if err := tx.Commit(); err != nil {
		log.Fatalf("commit cleanup: %v", err)
	}

	requestRows, _ := requestDeleteResult.RowsAffected()
	assetRows, _ := assetDeleteResult.RowsAffected()

	fmt.Printf("Deleted %d demo requests and %d demo assets\n", requestRows, assetRows)
	if assetRows == 0 && requestRows == 0 {
		fmt.Println("No matching demo rows were present.")
	}
}