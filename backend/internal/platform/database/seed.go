package database

import (
	"database/sql"
	"fmt"
	"strings"

	"itms/backend/internal/app"
)

type PasswordHasher func(string) (string, error)

func Seed(db *sql.DB, config app.Config, hashPassword PasswordHasher) error {
	if err := seedEntities(db); err != nil {
		return err
	}
	if err := seedDepartments(db); err != nil {
		return err
	}
	if err := seedRolesAndPermissions(db); err != nil {
		return err
	}
	if err := seedDefaultAdmin(db, config, hashPassword); err != nil {
		return err
	}
	return nil
}

func seedEntities(db *sql.DB) error {
	entities := []struct {
		ShortCode string
		FullName  string
	}{
		{"ZBL", "Zerodha Broking Limited"},
		{"ZC", "Zerodha Commodities"},
		{"ETS", "ETS"},
		{"NKS", "NK Square"},
		{"ZCAP", "Zerodha Capital"},
		{"RM", "Rainmatter"},
		{"ZTEC", "Zerodha Technology"},
	}

	for _, entity := range entities {
		if _, err := db.Exec(`
			INSERT INTO entities (short_code, full_name)
			VALUES ($1, $2)
			ON CONFLICT (short_code) DO UPDATE SET full_name = EXCLUDED.full_name
		`, entity.ShortCode, entity.FullName); err != nil {
			return fmt.Errorf("seed entity %s: %w", entity.ShortCode, err)
		}
	}

	locations := []struct {
		EntityCode    string
		LocationCode  string
		FullName      string
		City          string
		State         string
	}{
		{"ZBL", "ZBL-BLR-HO", "ZBL Head Office, Bangalore", "Bangalore", "Karnataka"},
		{"ZBL", "ZBL-BLR-SO", "ZBL Support Office, Bangalore", "Bangalore", "Karnataka"},
		{"ZBL", "ZBL-BGM-SO", "ZBL Support Office, Belgaum", "Belgaum", "Karnataka"},
	}

	for _, location := range locations {
		if _, err := db.Exec(`
			INSERT INTO locations (entity_id, location_code, full_name, city, state)
			SELECT id, $2, $3, $4, $5
			FROM entities
			WHERE short_code = $1
			ON CONFLICT (location_code) DO UPDATE SET
				full_name = EXCLUDED.full_name,
				city = EXCLUDED.city,
				state = EXCLUDED.state
		`, location.EntityCode, location.LocationCode, location.FullName, location.City, location.State); err != nil {
			return fmt.Errorf("seed location %s: %w", location.LocationCode, err)
		}
	}

	return nil
}

func seedDepartments(db *sql.DB) error {
	canonicalNames := []struct {
		EntityCode   string
		OldName      string
		NewName      string
		NewShortCode string
		Description  string
	}{
		{"ZBL", "IT", "IT Operations", "ITOPS", "Endpoint management, infrastructure, and internal IT services"},
		{"ZBL", "Security", "Security & Compliance", "SECCOMP", "Security operations, compliance reviews, and audit readiness"},
		{"ZBL", "Finance", "Finance & Accounts", "FINACC", "Finance, accounting, procurement, and spend control"},
		{"ZBL", "Human Resources", "People Operations", "PEOPLE", "Hiring, onboarding, employee support, and HR operations"},
		{"ZBL", "Support", "Customer Support", "CS", "Customer issue resolution and support workflows"},
		{"ZBL", "Broking Operations", "Operations", "OPS", "Business operations and service delivery"},
	}

	departments := []struct {
		EntityCode   string
		Name         string
		ShortCode    string
		Description  string
	}{
		{"ZBL", "Engineering", "ENG", "Product engineering and platform delivery"},
		{"ZBL", "IT Operations", "ITOPS", "Endpoint management, infrastructure, and internal IT services"},
		{"ZBL", "Security & Compliance", "SECCOMP", "Security operations, compliance reviews, and audit readiness"},
		{"ZBL", "Operations", "OPS", "Business operations and service delivery"},
		{"ZBL", "Customer Support", "CS", "Customer issue resolution and support workflows"},
		{"ZBL", "Finance & Accounts", "FINACC", "Finance, accounting, procurement, and spend control"},
		{"ZBL", "People Operations", "PEOPLE", "Hiring, onboarding, employee support, and HR operations"},
		{"ZBL", "Risk Management", "RISK", "Operational risk controls and incident governance"},
		{"ZBL", "Compliance", "COMP", "Regulatory compliance monitoring and internal policy adherence"},
		{"ZBL", "Facilities & Admin", "ADMIN", "Facilities, workplace services, and administrative operations"},
	}

	for _, department := range departments {
		if _, err := db.Exec(`
			INSERT INTO departments (entity_id, name, short_code, description)
			SELECT id, $2, $3, $4
			FROM entities
			WHERE short_code = $1
			ON CONFLICT (entity_id, name) DO UPDATE SET
				short_code = EXCLUDED.short_code,
				description = EXCLUDED.description,
				updated_at = NOW()
		`, department.EntityCode, department.Name, department.ShortCode, department.Description); err != nil {
			return fmt.Errorf("seed department %s: %w", department.Name, err)
		}
	}

	for _, canonical := range canonicalNames {
		if err := mergeDepartmentSeed(db, canonical.EntityCode, canonical.OldName, canonical.NewName, canonical.NewShortCode, canonical.Description); err != nil {
			return err
		}
	}

	return nil
}

func mergeDepartmentSeed(db *sql.DB, entityCode string, oldName string, newName string, newShortCode string, description string) error {
	tx, err := db.Begin()
	if err != nil {
		return fmt.Errorf("begin department merge %s: %w", oldName, err)
	}
	defer tx.Rollback()

	var entityID string
	if err := tx.QueryRow(`SELECT id FROM entities WHERE short_code = $1`, entityCode).Scan(&entityID); err != nil {
		return fmt.Errorf("load entity for department merge %s: %w", oldName, err)
	}

	var newID string
	if err := tx.QueryRow(`
		INSERT INTO departments (entity_id, name, short_code, description)
		VALUES ($1::uuid, $2, $3, $4)
		ON CONFLICT (entity_id, name) DO UPDATE SET
			short_code = EXCLUDED.short_code,
			description = EXCLUDED.description
		RETURNING id
	`, entityID, newName, newShortCode, description).Scan(&newID); err != nil {
		return fmt.Errorf("upsert canonical department %s: %w", newName, err)
	}

	var oldID string
	if err := tx.QueryRow(`SELECT id FROM departments WHERE entity_id = $1::uuid AND name = $2`, entityID, oldName).Scan(&oldID); err != nil {
		if err == sql.ErrNoRows {
			return tx.Commit()
		}
		return fmt.Errorf("load legacy department %s: %w", oldName, err)
	}

	if oldID == newID {
		return tx.Commit()
	}

	if _, err := tx.Exec(`UPDATE users SET dept_id = $1::uuid WHERE dept_id = $2::uuid`, newID, oldID); err != nil {
		return fmt.Errorf("reassign users from %s: %w", oldName, err)
	}
	if _, err := tx.Exec(`UPDATE assets SET dept_id = $1::uuid WHERE dept_id = $2::uuid`, newID, oldID); err != nil {
		return fmt.Errorf("reassign assets from %s: %w", oldName, err)
	}
	if _, err := tx.Exec(`DELETE FROM hostname_sequences WHERE entity_id = $1::uuid AND dept_id = $2::uuid`, entityID, oldID); err != nil {
		return fmt.Errorf("cleanup hostname_sequences for %s: %w", oldName, err)
	}
	if _, err := tx.Exec(`DELETE FROM departments WHERE id = $1::uuid`, oldID); err != nil {
		return fmt.Errorf("delete legacy department %s: %w", oldName, err)
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit department merge %s: %w", oldName, err)
	}

	return nil
}

func seedRolesAndPermissions(db *sql.DB) error {
	roles := []struct {
		Name     string
		System   bool
		Perms    []string
	}{
		{
			Name:   "super_admin",
			System: true,
			Perms: []string{
				"assets.view", "assets.edit", "assets.delete", "assets.assign",
				"patches.run", "scripts.run", "terminal.open", "remote.open",
				"users.view", "users.manage", "audit.view",
				"gatepass.create", "gatepass.approve",
				"dept.manage", "location.manage", "entity.manage", "roles.manage",
			},
		},
		{
			Name:   "it_team",
			System: true,
			Perms: []string{
				"assets.view", "assets.edit", "assets.assign",
				"patches.run", "scripts.run", "terminal.open", "remote.open",
				"users.view", "audit.view",
				"gatepass.create", "gatepass.approve",
			},
		},
		{
			Name:   "employee",
			System: true,
			Perms: []string{
				"assets.view", "gatepass.create",
			},
		},
	}

	permissionLabels := map[string]string{
		"assets.view": "View assets",
		"assets.edit": "Edit assets",
		"assets.delete": "Delete assets",
		"assets.assign": "Assign assets",
		"patches.run": "Run patches",
		"scripts.run": "Run scripts",
		"terminal.open": "Open terminal",
		"remote.open": "Open remote sessions",
		"users.view": "View users",
		"users.manage": "Manage users",
		"audit.view": "View audit log",
		"gatepass.create": "Create gatepass",
		"gatepass.approve": "Approve gatepass",
		"dept.manage": "Manage departments",
		"location.manage": "Manage locations",
		"entity.manage": "Manage entities",
		"roles.manage": "Manage roles",
	}

	for key, label := range permissionLabels {
		if _, err := db.Exec(`
			INSERT INTO permissions (key, label)
			VALUES ($1, $2)
			ON CONFLICT (key) DO UPDATE SET label = EXCLUDED.label
		`, key, label); err != nil {
			return fmt.Errorf("seed permission %s: %w", key, err)
		}
	}

	for _, role := range roles {
		if _, err := db.Exec(`
			INSERT INTO roles (name, is_system)
			VALUES ($1, $2)
			ON CONFLICT (name) DO UPDATE SET is_system = EXCLUDED.is_system
		`, role.Name, role.System); err != nil {
			return fmt.Errorf("seed role %s: %w", role.Name, err)
		}

		if _, err := db.Exec(`
			DELETE FROM role_permissions
			WHERE role_id = (SELECT id FROM roles WHERE name = $1)
		`, role.Name); err != nil {
			return fmt.Errorf("clear role permissions %s: %w", role.Name, err)
		}

		for _, key := range role.Perms {
			if _, err := db.Exec(`
				INSERT INTO role_permissions (role_id, permission_id)
				SELECT r.id, p.id
				FROM roles r
				JOIN permissions p ON p.key = $2
				WHERE r.name = $1
			`, role.Name, key); err != nil {
				return fmt.Errorf("map permission %s to %s: %w", key, role.Name, err)
			}
		}
	}

	return nil
}

func seedDefaultAdmin(db *sql.DB, config app.Config, hashPassword PasswordHasher) error {
	var exists bool
	if err := db.QueryRow(`SELECT EXISTS(SELECT 1 FROM users WHERE email = $1)`, strings.ToLower(config.DefaultAdminEmail)).Scan(&exists); err != nil {
		return fmt.Errorf("check default admin: %w", err)
	}
	if exists {
		return nil
	}

	hash, err := hashPassword(config.DefaultAdminPassword)
	if err != nil {
		return fmt.Errorf("hash default admin password: %w", err)
	}

	if _, err := db.Exec(`
		INSERT INTO users (
			emp_id, full_name, email, entity_id, location_id, role_id, password_hash, is_active
		)
		SELECT
			'EMP001',
			$1,
			$2,
			e.id,
			l.id,
			r.id,
			$3,
			TRUE
		FROM entities e
		JOIN roles r ON r.name = 'super_admin'
		LEFT JOIN locations l ON l.location_code = 'ZBL-BLR-HO'
		WHERE e.short_code = 'ZBL'
	`, config.DefaultAdminName, strings.ToLower(config.DefaultAdminEmail), hash); err != nil {
		return fmt.Errorf("insert default admin: %w", err)
	}

	return nil
}