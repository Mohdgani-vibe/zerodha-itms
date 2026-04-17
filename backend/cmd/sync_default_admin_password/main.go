package main

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"strings"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"

	"itms/backend/internal/platform/authn"
)

func main() {
	databaseURL := strings.TrimSpace(os.Getenv("DATABASE_URL"))
	if databaseURL == "" {
		fail("DATABASE_URL is required")
	}

	adminEmail := strings.ToLower(strings.TrimSpace(os.Getenv("DEFAULT_ADMIN_EMAIL")))
	if adminEmail == "" {
		fail("DEFAULT_ADMIN_EMAIL is required")
	}

	adminPassword := os.Getenv("DEFAULT_ADMIN_PASSWORD")
	if err := authn.ValidatePasswordStrength(adminPassword); err != nil {
		fail("DEFAULT_ADMIN_PASSWORD is invalid: %v", err)
	}

	passwordHash, err := authn.HashPassword(adminPassword)
	if err != nil {
		fail("hash admin password: %v", err)
	}

	db, err := sql.Open("pgx", databaseURL)
	if err != nil {
		fail("open database: %v", err)
	}
	defer db.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := db.PingContext(ctx); err != nil {
		fail("ping database: %v", err)
	}

	result, err := db.ExecContext(ctx, `
		UPDATE users
		SET password_hash = $1,
		    updated_at = NOW()
		WHERE lower(email) = lower($2)
	`, passwordHash, adminEmail)
	if err != nil {
		fail("update admin password: %v", err)
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		fail("read update result: %v", err)
	}
	if rowsAffected == 0 {
		fail("no user found for %s", adminEmail)
	}

	fmt.Printf("Updated password hash for %s.\n", adminEmail)
}

func fail(format string, args ...any) {
	fmt.Fprintf(os.Stderr, format+"\n", args...)
	os.Exit(1)
}
