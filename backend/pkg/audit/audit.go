package audit

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"itms/backend/pkg/middleware"
)

const retentionWindow = 30 * 24 * time.Hour
const systemActorEmail = "system.audit@zerodha.local"
const systemActorName = "System Audit"

var (
	pruneMu        sync.Mutex
	lastPruneRunAt time.Time
)

func PruneExpired(db *sql.DB) {
	if db == nil {
		return
	}

	cutoff := time.Now().UTC().Add(-retentionWindow).Format(time.RFC3339)
	_, _ = db.Exec(`DELETE FROM audit_logs WHERE created_at < ?`, cutoff)
}

func PruneExpiredIfDue(db *sql.DB) {
	if db == nil {
		return
	}

	pruneMu.Lock()
	defer pruneMu.Unlock()

	now := time.Now().UTC()
	if !lastPruneRunAt.IsZero() && now.Sub(lastPruneRunAt) < time.Hour {
		return
	}

	PruneExpired(db)
	lastPruneRunAt = now
}

func Record(db *sql.DB, actor middleware.Identity, action string, entityType string, entityID string, summary string, subjectUserID string, metadata map[string]any) {
	if db == nil || actor.ID == "" || action == "" || entityType == "" || entityID == "" || summary == "" {
		return
	}

	PruneExpiredIfDue(db)

	metadataJSON := ""
	if len(metadata) > 0 {
		if payload, err := json.Marshal(metadata); err == nil {
			metadataJSON = string(payload)
		}
	}

	_, _ = db.Exec(
		`INSERT INTO audit_logs (id, actor_id, subject_user_id, entity_type, entity_id, action, summary, metadata, created_at) VALUES (?, ?, NULLIF(?, ''), ?, ?, ?, ?, NULLIF(?, ''), ?)`,
		middleware.RandomID(), actor.ID, subjectUserID, entityType, entityID, action, summary, metadataJSON, time.Now().UTC().Format(time.RFC3339),
	)
}

func SystemIdentity(db *sql.DB) (middleware.Identity, error) {
	if db == nil {
		return middleware.Identity{}, fmt.Errorf("database is required")
	}

	var userID string
	var roleName string
	err := db.QueryRow(`
		SELECT u.id, COALESCE(r.name, 'System')
		FROM users u
		LEFT JOIN roles r ON r.id = u.role_id
		WHERE lower(u.email) = lower(?)
	`, systemActorEmail).Scan(&userID, &roleName)
	if err == nil {
		return middleware.Identity{ID: userID, Email: systemActorEmail, Name: systemActorName, Role: roleName}, nil
	}
	if err != sql.ErrNoRows {
		return middleware.Identity{}, err
	}

	now := time.Now().UTC().Format(time.RFC3339)
	roleID, err := ensureSystemRole(db, now)
	if err != nil {
		return middleware.Identity{}, err
	}

	columns := []string{"id", "email", "full_name", "role_id"}
	args := []any{middleware.RandomID(), systemActorEmail, systemActorName, roleID}
	if tableHasColumn(db, "users", "password") {
		columns = append(columns, "password")
		args = append(args, "system-disabled")
	}
	if tableHasColumn(db, "users", "password_hash") {
		columns = append(columns, "password_hash")
		args = append(args, "system-disabled")
	}
	if tableHasColumn(db, "users", "status") {
		columns = append(columns, "status")
		args = append(args, "active")
	}
	if tableHasColumn(db, "users", "created_at") {
		columns = append(columns, "created_at")
		args = append(args, now)
	}

	placeholders := make([]string, len(columns))
	for index := range placeholders {
		placeholders[index] = "?"
	}

	query := fmt.Sprintf(`INSERT INTO users (%s) VALUES (%s)`, join(columns), join(placeholders))
	if _, err := db.Exec(query, args...); err != nil {
		return middleware.Identity{}, err
	}

	if err := db.QueryRow(`SELECT id FROM users WHERE lower(email) = lower(?)`, systemActorEmail).Scan(&userID); err != nil {
		return middleware.Identity{}, err
	}

	return middleware.Identity{ID: userID, Email: systemActorEmail, Name: systemActorName, Role: "System"}, nil
}

func ensureSystemRole(db *sql.DB, now string) (string, error) {
	var roleID string
	err := db.QueryRow(`SELECT id FROM roles WHERE name = 'System'`).Scan(&roleID)
	if err == nil {
		return roleID, nil
	}
	if err != sql.ErrNoRows {
		return "", err
	}

	roleID = middleware.RandomID()
	if tableHasColumn(db, "roles", "created_at") {
		_, err = db.Exec(`INSERT INTO roles (id, name, created_at) VALUES (?, ?, ?)`, roleID, "System", now)
	} else {
		_, err = db.Exec(`INSERT INTO roles (id, name) VALUES (?, ?)`, roleID, "System")
	}
	if err != nil {
		return "", err
	}
	return roleID, nil
}

func tableHasColumn(db *sql.DB, table string, column string) bool {
	rows, err := db.Query(fmt.Sprintf(`PRAGMA table_info(%s)`, table))
	if err != nil {
		return false
	}
	defer rows.Close()

	for rows.Next() {
		var cid int
		var name string
		var dataType string
		var notNull int
		var defaultValue sql.NullString
		var pk int
		if err := rows.Scan(&cid, &name, &dataType, &notNull, &defaultValue, &pk); err != nil {
			return false
		}
		if name == column {
			return true
		}
	}

	return false
}

func join(items []string) string {
	if len(items) == 0 {
		return ""
	}
	result := items[0]
	for _, item := range items[1:] {
		result += ", " + item
	}
	return result
}
