package inventorysync

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"
	"unicode"
)

const (
	maxFetchedInventoryBytes = 8 << 20
	maxFetchedInventoryAssets = 5000
)

type Config struct {
	Enabled           bool
	SourceType        string
	SourceURL         string
	SourceToken       string
	IngestToken       string
	Interval          time.Duration
	RunOnStartup      bool
	DefaultEntityID   string
	DefaultDeptID     string
	DefaultLocationID string
}

type Service struct {
	db     *sql.DB
	config Config
	client *http.Client

	mu        sync.RWMutex
	running   bool
	nextRunAt time.Time
}

type Status struct {
	Enabled    bool       `json:"enabled"`
	SourceType string     `json:"sourceType"`
	Interval   string     `json:"interval"`
	Running    bool       `json:"running"`
	NextRunAt  *time.Time `json:"nextRunAt,omitempty"`
	LastRun    *RunStatus `json:"lastRun,omitempty"`
	Configured bool       `json:"configured"`
}

type RunStatus struct {
	Status          string     `json:"status"`
	StartedAt       time.Time  `json:"startedAt"`
	FinishedAt      *time.Time `json:"finishedAt,omitempty"`
	RecordsSeen     int        `json:"recordsSeen"`
	RecordsUpserted int        `json:"recordsUpserted"`
	Error           string     `json:"error,omitempty"`
}

type sourcePayload struct {
	Assets []sourceAsset `json:"assets"`
}

type Payload struct {
	Assets []Asset `json:"assets"`
}

type Asset = sourceAsset

type sourceAsset struct {
	AssetTag          string           `json:"asset_tag"`
	Name              string           `json:"name"`
	Hostname          string           `json:"hostname"`
	Category          string           `json:"category"`
	IsCompute         bool             `json:"is_compute"`
	SerialNumber      string           `json:"serial_number"`
	Manufacturer      string           `json:"manufacturer"`
	Model             string           `json:"model"`
	EntityID          string           `json:"entity_id"`
	DeptID            string           `json:"dept_id"`
	LocationID        string           `json:"location_id"`
	AssignedToEmail   string           `json:"assigned_to_email"`
	AssignedToName    string           `json:"assigned_to_name"`
	EmployeeCode      string           `json:"employee_code"`
	DepartmentName    string           `json:"department_name"`
	PurchaseDate      string           `json:"purchase_date"`
	WarrantyUntil     string           `json:"warranty_until"`
	Status            string           `json:"status"`
	Condition         string           `json:"condition"`
	GLPIID            *int             `json:"glpi_id"`
	SourceFingerprint string           `json:"source_fingerprint"`
	SaltMinionID      string           `json:"salt_minion_id"`
	WazuhAgentID      string           `json:"wazuh_agent_id"`
	Notes             string           `json:"notes"`
	ComputeDetails    *computeDetails  `json:"compute_details"`
	InstalledSoftware []softwareRecord `json:"installed_software"`
}

type computeDetails struct {
	Processor      string `json:"processor"`
	RAM            string `json:"ram"`
	Storage        string `json:"storage"`
	GPU            string `json:"gpu"`
	Display        string `json:"display"`
	BIOSVersion    string `json:"bios_version"`
	MACAddress     string `json:"mac_address"`
	OSName         string `json:"os_name"`
	OSVersion      string `json:"os_version"`
	Kernel         string `json:"kernel"`
	Architecture   string `json:"architecture"`
	OSBuild        string `json:"os_build"`
	LastBoot       string `json:"last_boot"`
	LastSeen       string `json:"last_seen"`
	PendingUpdates int    `json:"pending_updates"`
}

type softwareRecord struct {
	Name        string `json:"name"`
	Version     string `json:"version"`
	InstallDate string `json:"install_date"`
}

func NewService(db *sql.DB, config Config) *Service {
	if config.Interval <= 0 {
		config.Interval = 24 * time.Hour
	}
	if config.SourceType == "" {
		config.SourceType = "json"
	}
	return &Service{
		db:     db,
		config: config,
		client: &http.Client{
			Timeout: 60 * time.Second,
			CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
				return errors.New("inventory sync source redirects are not allowed")
			},
		},
	}
}

func (service *Service) Start(ctx context.Context) {
	if !service.config.Enabled {
		return
	}

	service.setNextRun(time.Now().UTC().Add(service.config.Interval))

	go func() {
		if service.config.RunOnStartup {
			_, _ = service.RunOnce(ctx)
		}

		ticker := time.NewTicker(service.config.Interval)
		defer ticker.Stop()

		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				_, _ = service.RunOnce(ctx)
			}
		}
	}()
}

func (service *Service) RunOnce(ctx context.Context) (RunStatus, error) {
	service.mu.Lock()
	if service.running {
		service.mu.Unlock()
		return RunStatus{}, errors.New("inventory sync is already running")
	}
	service.running = true
	service.mu.Unlock()

	defer func() {
		service.mu.Lock()
		service.running = false
		service.nextRunAt = time.Now().UTC().Add(service.config.Interval)
		service.mu.Unlock()
	}()

	startedAt := time.Now().UTC()
	runID, err := service.insertRun(ctx, startedAt)
	if err != nil {
		return RunStatus{}, err
	}

	assets, err := service.fetchAssets(ctx)
	if err != nil {
		_ = service.finishRun(ctx, runID, startedAt, 0, 0, err)
		return RunStatus{Status: "failed", StartedAt: startedAt, Error: err.Error()}, err
	}

	upserted, runErr := service.syncAssets(ctx, assets)
	if finishErr := service.finishRun(ctx, runID, startedAt, len(assets), upserted, runErr); finishErr != nil && runErr == nil {
		runErr = finishErr
	}
	if runErr != nil {
		return RunStatus{Status: "failed", StartedAt: startedAt, RecordsSeen: len(assets), RecordsUpserted: upserted, Error: runErr.Error()}, runErr
	}

	finishedAt := time.Now().UTC()
	return RunStatus{Status: "completed", StartedAt: startedAt, FinishedAt: &finishedAt, RecordsSeen: len(assets), RecordsUpserted: upserted}, nil
}

func (service *Service) IngestToken() string {
	return strings.TrimSpace(service.config.IngestToken)
}

func (service *Service) DecodePayload(body []byte) ([]Asset, error) {
	var wrapped Payload
	if err := json.Unmarshal(body, &wrapped); err == nil && len(wrapped.Assets) > 0 {
		return wrapped.Assets, nil
	}

	var direct []Asset
	if err := json.Unmarshal(body, &direct); err != nil {
		return nil, fmt.Errorf("decode inventory payload: %w", err)
	}
	return direct, nil
}

func (service *Service) Ingest(ctx context.Context, assets []Asset) (RunStatus, error) {
	startedAt := time.Now().UTC()
	runID, err := service.insertRunWithSource(ctx, "push", startedAt)
	if err != nil {
		return RunStatus{}, err
	}

	upserted, runErr := service.syncAssets(ctx, assets)
	if finishErr := service.finishRun(ctx, runID, startedAt, len(assets), upserted, runErr); finishErr != nil && runErr == nil {
		runErr = finishErr
	}
	if runErr != nil {
		return RunStatus{Status: "failed", StartedAt: startedAt, RecordsSeen: len(assets), RecordsUpserted: upserted, Error: runErr.Error()}, runErr
	}

	finishedAt := time.Now().UTC()
	return RunStatus{Status: "completed", StartedAt: startedAt, FinishedAt: &finishedAt, RecordsSeen: len(assets), RecordsUpserted: upserted}, nil
}

func (service *Service) Status(ctx context.Context) (Status, error) {
	service.mu.RLock()
	nextRunAt := service.nextRunAt
	running := service.running
	service.mu.RUnlock()

	status := Status{
		Enabled:    service.config.Enabled,
		SourceType: service.config.SourceType,
		Interval:   service.config.Interval.String(),
		Running:    running,
		Configured: strings.TrimSpace(service.config.SourceURL) != "",
	}
	if !nextRunAt.IsZero() {
		status.NextRunAt = &nextRunAt
	}

	row := service.db.QueryRowContext(ctx, `
		SELECT status, started_at, finished_at, records_seen, records_upserted, COALESCE(error_text, '')
		FROM inventory_sync_runs
		ORDER BY started_at DESC
		LIMIT 1
	`)
	var run RunStatus
	var finishedAt sql.NullTime
	if err := row.Scan(&run.Status, &run.StartedAt, &finishedAt, &run.RecordsSeen, &run.RecordsUpserted, &run.Error); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return status, nil
		}
		return Status{}, err
	}
	if finishedAt.Valid {
		run.FinishedAt = &finishedAt.Time
	}
	status.LastRun = &run
	return status, nil
}

func (service *Service) insertRun(ctx context.Context, startedAt time.Time) (string, error) {
	return service.insertRunWithSource(ctx, service.config.SourceType, startedAt)
}

func (service *Service) insertRunWithSource(ctx context.Context, sourceType string, startedAt time.Time) (string, error) {
	var id string
	err := service.db.QueryRowContext(ctx, `
		INSERT INTO inventory_sync_runs (source_type, status, started_at)
		VALUES ($1, 'running', $2)
		RETURNING id
	`, sourceType, startedAt).Scan(&id)
	return id, err
}

func (service *Service) finishRun(ctx context.Context, runID string, startedAt time.Time, recordsSeen int, recordsUpserted int, runErr error) error {
	status := "completed"
	errorText := ""
	if runErr != nil {
		status = "failed"
		errorText = runErr.Error()
	}
	_, err := service.db.ExecContext(ctx, `
		UPDATE inventory_sync_runs
		SET status = $2,
			finished_at = $3,
			records_seen = $4,
			records_upserted = $5,
			error_text = NULLIF($6, '')
		WHERE id = $1::uuid
	`, runID, status, time.Now().UTC(), recordsSeen, recordsUpserted, errorText)
	return err
}

func (service *Service) fetchAssets(ctx context.Context) ([]sourceAsset, error) {
	if strings.TrimSpace(service.config.SourceURL) == "" {
		return nil, errors.New("inventory sync source URL is not configured")
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, service.config.SourceURL, nil)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(service.config.SourceToken) != "" {
		req.Header.Set("Authorization", "Bearer "+service.config.SourceToken)
	}
	req.Header.Set("Accept", "application/json")

	resp, err := service.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("inventory sync source returned %s", resp.Status)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxFetchedInventoryBytes+1))
	if err != nil {
		return nil, fmt.Errorf("read inventory sync payload: %w", err)
	}
	if len(body) > maxFetchedInventoryBytes {
		return nil, fmt.Errorf("inventory sync payload exceeds %d bytes", maxFetchedInventoryBytes)
	}

	assets, err := service.DecodePayload(body)
	if err != nil {
		return nil, fmt.Errorf("decode inventory sync payload: %w", err)
	}
	if len(assets) > maxFetchedInventoryAssets {
		return nil, fmt.Errorf("inventory sync payload includes too many assets")
	}
	return assets, nil
}

func (service *Service) syncAssets(ctx context.Context, assets []sourceAsset) (int, error) {
	tx, err := service.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	upserted := 0
	for _, asset := range assets {
		if strings.TrimSpace(asset.AssetTag) == "" {
			return upserted, errors.New("inventory sync payload requires asset_tag for every asset")
		}

		entityID, err := service.resolveEntityID(ctx, tx, asset.EntityID)
		if err != nil {
			return upserted, fmt.Errorf("resolve entity for %s: %w", asset.AssetTag, err)
		}
		deptID := coalesceString(asset.DeptID, service.config.DefaultDeptID)
		locationID := coalesceString(asset.LocationID, service.config.DefaultLocationID)
		assignedToUserID, err := service.resolveAssignedUserID(ctx, tx, asset, entityID, deptID, locationID)
		if err != nil {
			return upserted, fmt.Errorf("resolve assigned user for %s: %w", asset.AssetTag, err)
		}

		assetID, err := service.upsertAsset(ctx, tx, asset, entityID, deptID, locationID, assignedToUserID)
		if err != nil {
			return upserted, fmt.Errorf("upsert asset %s: %w", asset.AssetTag, err)
		}

		if asset.IsCompute || asset.ComputeDetails != nil {
			if err := service.upsertComputeDetails(ctx, tx, assetID, asset.ComputeDetails); err != nil {
				return upserted, fmt.Errorf("upsert compute details %s: %w", asset.AssetTag, err)
			}
		}

		if err := service.replaceSoftwareInventory(ctx, tx, assetID, asset.InstalledSoftware); err != nil {
			return upserted, fmt.Errorf("replace software inventory %s: %w", asset.AssetTag, err)
		}
		upserted += 1
	}

	if err := tx.Commit(); err != nil {
		return upserted, err
	}
	return upserted, nil
}

func (service *Service) resolveEntityID(ctx context.Context, tx *sql.Tx, candidate string) (string, error) {
	entityID := coalesceString(candidate, service.config.DefaultEntityID)
	if entityID != "" {
		return entityID, nil
	}
	var firstEntityID string
	err := tx.QueryRowContext(ctx, `SELECT id::text FROM entities ORDER BY created_at ASC LIMIT 1`).Scan(&firstEntityID)
	if err != nil {
		return "", err
	}
	return firstEntityID, nil
}

func (service *Service) resolveAssignedUserID(ctx context.Context, tx *sql.Tx, asset sourceAsset, entityID string, deptID string, locationID string) (string, error) {
	matchByField := func(query string, value string) (string, error) {
		if strings.TrimSpace(value) == "" {
			return "", nil
		}
		var userID string
		err := tx.QueryRowContext(ctx, query, strings.TrimSpace(value)).Scan(&userID)
		if errors.Is(err, sql.ErrNoRows) {
			return "", nil
		}
		if err != nil {
			return "", err
		}
		return userID, nil
	}

	emailUserID, err := matchByField(`SELECT id::text FROM users WHERE lower(email) = lower($1) LIMIT 1`, asset.AssignedToEmail)
	if err != nil {
		return "", err
	}

	empIDUserID, err := matchByField(`SELECT id::text FROM users WHERE lower(emp_id) = lower($1) LIMIT 1`, asset.EmployeeCode)
	if err != nil {
		return "", err
	}

	if emailUserID != "" && empIDUserID != "" && emailUserID != empIDUserID {
		return "", fmt.Errorf("install identity conflict: email %q and employee code %q resolve to different users", strings.TrimSpace(asset.AssignedToEmail), strings.TrimSpace(asset.EmployeeCode))
	}

	matchedUserID := coalesceString(emailUserID, empIDUserID)
	if matchedUserID != "" {
		return service.reconcileInstalledUser(ctx, tx, matchedUserID, asset, entityID, deptID, locationID)
	}

	if strings.TrimSpace(asset.AssignedToName) == "" {
		return "", nil
	}

	rows, err := tx.QueryContext(ctx, `SELECT id::text FROM users WHERE lower(full_name) = lower($1)`, strings.TrimSpace(asset.AssignedToName))
	if err != nil {
		return "", err
	}
	defer rows.Close()

	matchedIDs := make([]string, 0, 2)
	for rows.Next() {
		var userID string
		if err := rows.Scan(&userID); err != nil {
			return "", err
		}
		matchedIDs = append(matchedIDs, userID)
		if len(matchedIDs) > 1 {
			return "", nil
		}
	}
	if err := rows.Err(); err != nil {
		return "", err
	}
	if len(matchedIDs) == 1 {
		return service.reconcileInstalledUser(ctx, tx, matchedIDs[0], asset, entityID, deptID, locationID)
	}

	return service.provisionAssignedUser(ctx, tx, asset, entityID, deptID, locationID)
}

func (service *Service) provisionAssignedUser(ctx context.Context, tx *sql.Tx, asset sourceAsset, entityID string, deptID string, locationID string) (string, error) {
	email := strings.ToLower(strings.TrimSpace(asset.AssignedToEmail))
	fullName := strings.TrimSpace(asset.AssignedToName)
	empID := strings.TrimSpace(asset.EmployeeCode)
	if email == "" || fullName == "" || empID == "" {
		return "", nil
	}
	if !strings.HasSuffix(email, "@zerodha.com") {
		return "", nil
	}

	if existingUserID, err := service.findExistingUserID(ctx, tx, email, empID); err != nil {
		return "", err
	} else if existingUserID != "" {
		return service.reconcileInstalledUser(ctx, tx, existingUserID, asset, entityID, deptID, locationID)
	}

	resolvedDeptID, err := service.resolveInstalledDepartmentID(ctx, tx, entityID, deptID, asset.DepartmentName)
	if err != nil {
		return "", err
	}

	var userID string
	err = tx.QueryRowContext(ctx, `
		INSERT INTO users (emp_id, full_name, email, entity_id, dept_id, location_id, role_id, is_active)
		SELECT $1, $2, $3, NULLIF($4, '')::uuid, NULLIF($5, '')::uuid, NULLIF($6, '')::uuid, r.id, TRUE
		FROM roles r
		WHERE r.name = 'employee'
		RETURNING id::text
	`, empID, fullName, email, strings.TrimSpace(entityID), resolvedDeptID, strings.TrimSpace(locationID)).Scan(&userID)
	if err != nil {
		return "", err
	}

	if strings.TrimSpace(entityID) != "" {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO user_entity_access (user_id, entity_id)
			VALUES ($1::uuid, $2::uuid)
			ON CONFLICT DO NOTHING
		`, userID, strings.TrimSpace(entityID)); err != nil {
			return "", err
		}
	}

	return userID, nil
}

func (service *Service) resolveDepartmentIDByName(ctx context.Context, tx *sql.Tx, entityID string, departmentName string) (string, error) {
	if strings.TrimSpace(departmentName) == "" {
		return "", nil
	}

	var deptID string
	err := tx.QueryRowContext(ctx, `
		SELECT id::text
		FROM departments
		WHERE lower(name) = lower($1)
		  AND (NULLIF($2, '') IS NULL OR entity_id = NULLIF($2, '')::uuid)
		ORDER BY created_at ASC
		LIMIT 1
	`, strings.TrimSpace(departmentName), strings.TrimSpace(entityID)).Scan(&deptID)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return deptID, nil
}

func (service *Service) resolveInstalledDepartmentID(ctx context.Context, tx *sql.Tx, entityID string, deptID string, departmentName string) (string, error) {
	if strings.TrimSpace(departmentName) != "" {
		return service.ensureDepartmentIDByName(ctx, tx, entityID, departmentName)
	}
	return strings.TrimSpace(deptID), nil
}

func (service *Service) ensureDepartmentIDByName(ctx context.Context, tx *sql.Tx, entityID string, departmentName string) (string, error) {
	departmentName = strings.TrimSpace(departmentName)
	entityID = strings.TrimSpace(entityID)
	if departmentName == "" {
		return "", nil
	}

	if deptID, err := service.resolveDepartmentIDByName(ctx, tx, entityID, departmentName); err != nil || deptID != "" {
		return deptID, err
	}

	if entityID == "" {
		return "", nil
	}

	baseCode := buildDepartmentShortCode(departmentName)
	for attempt := 0; attempt < 100; attempt++ {
		candidateCode := baseCode
		if attempt > 0 {
			suffix := fmt.Sprintf("-%d", attempt+1)
			maxBaseLen := 20 - len(suffix)
			if maxBaseLen < 1 {
				maxBaseLen = 1
			}
			if len(candidateCode) > maxBaseLen {
				candidateCode = candidateCode[:maxBaseLen]
			}
			candidateCode += suffix
		}

		var deptID string
		err := tx.QueryRowContext(ctx, `
			INSERT INTO departments (entity_id, name, short_code, description)
			VALUES ($1::uuid, $2, $3, $4)
			ON CONFLICT (entity_id, name) DO UPDATE SET updated_at = NOW()
			RETURNING id::text
		`, entityID, departmentName, candidateCode, fmt.Sprintf("Auto-created from installer enrollment for %s", departmentName)).Scan(&deptID)
		if err == nil {
			return deptID, nil
		}
	}

	return service.resolveDepartmentIDByName(ctx, tx, entityID, departmentName)
}

func (service *Service) findExistingUserID(ctx context.Context, tx *sql.Tx, email string, empID string) (string, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	empID = strings.TrimSpace(empID)

	var matchedUserID string
	if email != "" {
		var emailUserID string
		err := tx.QueryRowContext(ctx, `SELECT id::text FROM users WHERE lower(email) = lower($1) LIMIT 1`, email).Scan(&emailUserID)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return "", err
		}
		if err == nil {
			matchedUserID = emailUserID
		}
	}

	if empID != "" {
		var empUserID string
		err := tx.QueryRowContext(ctx, `SELECT id::text FROM users WHERE lower(emp_id) = lower($1) LIMIT 1`, empID).Scan(&empUserID)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return "", err
		}
		if err == nil {
			if matchedUserID != "" && matchedUserID != empUserID {
				return "", fmt.Errorf("install identity conflict: email %q and employee code %q resolve to different users", email, empID)
			}
			matchedUserID = empUserID
		}
	}

	return matchedUserID, nil
}

func (service *Service) reconcileInstalledUser(ctx context.Context, tx *sql.Tx, userID string, asset sourceAsset, entityID string, deptID string, locationID string) (string, error) {
	var currentEmail, currentEmpID, currentFullName, currentEntityID, currentDeptID, currentLocationID string
	if err := tx.QueryRowContext(ctx, `
		SELECT COALESCE(email, ''), COALESCE(emp_id, ''), COALESCE(full_name, ''), COALESCE(entity_id::text, ''), COALESCE(dept_id::text, ''), COALESCE(location_id::text, '')
		FROM users
		WHERE id = $1::uuid
	`, userID).Scan(&currentEmail, &currentEmpID, &currentFullName, &currentEntityID, &currentDeptID, &currentLocationID); err != nil {
		return "", err
	}

	emailCandidate := strings.ToLower(strings.TrimSpace(asset.AssignedToEmail))
	if emailCandidate != "" && !strings.HasSuffix(emailCandidate, "@zerodha.com") {
		emailCandidate = ""
	}
	empIDCandidate := strings.TrimSpace(asset.EmployeeCode)
	fullNameCandidate := strings.TrimSpace(asset.AssignedToName)
	entityCandidate := coalesceString(entityID, currentEntityID)
	deptCandidate, err := service.resolveInstalledDepartmentID(ctx, tx, entityCandidate, deptID, asset.DepartmentName)
	if err != nil {
		return "", err
	}
	if deptCandidate == "" {
		deptCandidate = currentDeptID
	}
	locationCandidate := coalesceString(locationID, currentLocationID)

	if emailCandidate != "" && !strings.EqualFold(emailCandidate, currentEmail) {
		var existingUserID string
		err := tx.QueryRowContext(ctx, `SELECT id::text FROM users WHERE lower(email) = lower($1) LIMIT 1`, emailCandidate).Scan(&existingUserID)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return "", err
		}
		if err == nil && existingUserID != userID {
			return "", fmt.Errorf("email %q is already assigned to another user", emailCandidate)
		}
		currentEmail = emailCandidate
	}

	if empIDCandidate != "" && !strings.EqualFold(empIDCandidate, currentEmpID) {
		var existingUserID string
		err := tx.QueryRowContext(ctx, `SELECT id::text FROM users WHERE lower(emp_id) = lower($1) LIMIT 1`, empIDCandidate).Scan(&existingUserID)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return "", err
		}
		if err == nil && existingUserID != userID {
			return "", fmt.Errorf("employee code %q is already assigned to another user", empIDCandidate)
		}
		currentEmpID = empIDCandidate
	}

	if fullNameCandidate != "" {
		currentFullName = fullNameCandidate
	}

	_, err = tx.ExecContext(ctx, `
		UPDATE users
		SET email = $2,
			emp_id = $3,
			full_name = $4,
			entity_id = NULLIF($5, '')::uuid,
			dept_id = NULLIF($6, '')::uuid,
			location_id = NULLIF($7, '')::uuid,
			is_active = TRUE,
			updated_at = NOW()
		WHERE id = $1::uuid
	`, userID, currentEmail, currentEmpID, currentFullName, entityCandidate, deptCandidate, locationCandidate)
	if err != nil {
		return "", err
	}

	if entityCandidate != "" {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO user_entity_access (user_id, entity_id)
			VALUES ($1::uuid, $2::uuid)
			ON CONFLICT DO NOTHING
		`, userID, entityCandidate); err != nil {
			return "", err
		}
	}

	return userID, nil
}

func (service *Service) upsertAsset(ctx context.Context, tx *sql.Tx, asset sourceAsset, entityID string, deptID string, locationID string, assignedToUserID string) (string, error) {
	var id string
	status := strings.ToLower(strings.TrimSpace(asset.Status))
	if status == "" {
		status = "in_use"
	}
	condition := strings.ToLower(strings.TrimSpace(asset.Condition))
	if condition == "" {
		condition = "good"
	}
	name := strings.TrimSpace(asset.Name)
	if name == "" {
		name = coalesceString(asset.Hostname, asset.AssetTag)
	}
	category := strings.ToLower(strings.TrimSpace(asset.Category))
	if category == "" {
		if asset.IsCompute {
			category = "laptop"
		} else {
			category = "accessory"
		}
	}
	glpiID := 0
	if asset.GLPIID != nil {
		glpiID = *asset.GLPIID
	}

	hostname := strings.ToLower(strings.TrimSpace(asset.Hostname))
	sourceFingerprint := normalizeFingerprint(asset.SourceFingerprint)
	saltMinionID := strings.TrimSpace(asset.SaltMinionID)
	serialNumber := strings.TrimSpace(asset.SerialNumber)
	manufacturer := strings.TrimSpace(asset.Manufacturer)
	model := strings.TrimSpace(asset.Model)
	notes := strings.TrimSpace(asset.Notes)

	var existingAssetID string
	err := tx.QueryRowContext(ctx, `
		SELECT id::text
		FROM assets
		WHERE (NULLIF($1, '') IS NOT NULL AND source_fingerprint = NULLIF($1, ''))
		   OR (NULLIF($2, '') IS NOT NULL AND salt_minion_id = NULLIF($2, ''))
		   OR (NULLIF($3, '') IS NOT NULL AND serial_number = NULLIF($3, ''))
		   OR asset_tag = $4
		   OR (NULLIF($5, '') IS NOT NULL AND hostname = NULLIF($5, ''))
		LIMIT 1
	`, sourceFingerprint, saltMinionID, serialNumber, asset.AssetTag, hostname).Scan(&existingAssetID)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return "", err
	}

	if existingAssetID != "" {
		err = tx.QueryRowContext(ctx, `
			UPDATE assets SET
				asset_tag = $2,
				name = $3,
				hostname = NULLIF($4, ''),
				category = $5,
				is_compute = $6,
				serial_number = NULLIF($7, ''),
				manufacturer = NULLIF($8, ''),
				model = NULLIF($9, ''),
				entity_id = $10::uuid,
				assigned_to = NULLIF($11, '')::uuid,
				dept_id = NULLIF($12, '')::uuid,
				location_id = NULLIF($13, '')::uuid,
				purchase_date = NULLIF($14, '')::date,
				warranty_until = NULLIF($15, '')::date,
				status = $16,
				condition = $17,
				glpi_id = NULLIF($18, 0),
				source_fingerprint = NULLIF($19, ''),
				salt_minion_id = NULLIF($20, ''),
				wazuh_agent_id = NULLIF($21, ''),
				notes = NULLIF($22, ''),
				updated_at = NOW()
			WHERE id = $1::uuid
			RETURNING id::text
		`, existingAssetID, asset.AssetTag, name, hostname, category, asset.IsCompute, serialNumber, manufacturer, model, entityID, assignedToUserID, deptID, locationID, strings.TrimSpace(asset.PurchaseDate), strings.TrimSpace(asset.WarrantyUntil), status, condition, glpiID, sourceFingerprint, saltMinionID, strings.TrimSpace(asset.WazuhAgentID), notes).Scan(&id)
		return id, err
	}

	err = tx.QueryRowContext(ctx, `
		INSERT INTO assets (
			asset_tag, name, hostname, category, is_compute, serial_number, manufacturer, model, entity_id, assigned_to,
			dept_id, location_id, purchase_date, warranty_until, status, condition, glpi_id, source_fingerprint, salt_minion_id, wazuh_agent_id, notes, updated_at
		) VALUES (
			$1, $2, NULLIF($3, ''), $4, $5, NULLIF($6, ''), NULLIF($7, ''), NULLIF($8, ''), $9::uuid, NULLIF($10, '')::uuid,
			NULLIF($11, '')::uuid, NULLIF($12, '')::uuid, NULLIF($13, '')::date, NULLIF($14, '')::date, $15, $16, NULLIF($17, 0), NULLIF($18, ''), NULLIF($19, ''), NULLIF($20, ''), NULLIF($21, ''), NOW()
		)
		ON CONFLICT (asset_tag) DO UPDATE SET
			name = EXCLUDED.name,
			hostname = COALESCE(EXCLUDED.hostname, assets.hostname),
			category = EXCLUDED.category,
			is_compute = EXCLUDED.is_compute,
			serial_number = COALESCE(EXCLUDED.serial_number, assets.serial_number),
			manufacturer = COALESCE(EXCLUDED.manufacturer, assets.manufacturer),
			model = COALESCE(EXCLUDED.model, assets.model),
			entity_id = EXCLUDED.entity_id,
			assigned_to = COALESCE(EXCLUDED.assigned_to, assets.assigned_to),
			dept_id = COALESCE(EXCLUDED.dept_id, assets.dept_id),
			location_id = COALESCE(EXCLUDED.location_id, assets.location_id),
			purchase_date = COALESCE(EXCLUDED.purchase_date, assets.purchase_date),
			warranty_until = COALESCE(EXCLUDED.warranty_until, assets.warranty_until),
			status = EXCLUDED.status,
			condition = EXCLUDED.condition,
			glpi_id = COALESCE(EXCLUDED.glpi_id, assets.glpi_id),
			source_fingerprint = COALESCE(EXCLUDED.source_fingerprint, assets.source_fingerprint),
			salt_minion_id = EXCLUDED.salt_minion_id,
			wazuh_agent_id = EXCLUDED.wazuh_agent_id,
			notes = COALESCE(EXCLUDED.notes, assets.notes),
			updated_at = NOW()
		RETURNING id
	`, asset.AssetTag, name, hostname, category, asset.IsCompute, serialNumber, manufacturer, model, entityID, assignedToUserID, deptID, locationID, strings.TrimSpace(asset.PurchaseDate), strings.TrimSpace(asset.WarrantyUntil), status, condition, glpiID, sourceFingerprint, saltMinionID, strings.TrimSpace(asset.WazuhAgentID), notes).Scan(&id)
	return id, err
}

func (service *Service) upsertComputeDetails(ctx context.Context, tx *sql.Tx, assetID string, details *computeDetails) error {
	if details == nil {
		details = &computeDetails{}
	}
	_, err := tx.ExecContext(ctx, `
		INSERT INTO asset_compute_details (
			asset_id, processor, ram, storage, gpu, display, bios_version, mac_address, os_name, os_version, kernel, architecture, os_build, last_boot, last_seen, pending_updates, updated_at
		) VALUES (
			$1::uuid, NULLIF($2, ''), NULLIF($3, ''), NULLIF($4, ''), NULLIF($5, ''), NULLIF($6, ''), NULLIF($7, ''), NULLIF($8, ''), NULLIF($9, ''), NULLIF($10, ''), NULLIF($11, ''), NULLIF($12, ''), NULLIF($13, ''), NULLIF($14, '')::timestamptz, NULLIF($15, '')::timestamptz, $16, NOW()
		)
		ON CONFLICT (asset_id) DO UPDATE SET
			processor = COALESCE(EXCLUDED.processor, asset_compute_details.processor),
			ram = COALESCE(EXCLUDED.ram, asset_compute_details.ram),
			storage = COALESCE(EXCLUDED.storage, asset_compute_details.storage),
			gpu = COALESCE(EXCLUDED.gpu, asset_compute_details.gpu),
			display = COALESCE(EXCLUDED.display, asset_compute_details.display),
			bios_version = COALESCE(EXCLUDED.bios_version, asset_compute_details.bios_version),
			mac_address = COALESCE(EXCLUDED.mac_address, asset_compute_details.mac_address),
			os_name = COALESCE(EXCLUDED.os_name, asset_compute_details.os_name),
			os_version = COALESCE(EXCLUDED.os_version, asset_compute_details.os_version),
			kernel = COALESCE(EXCLUDED.kernel, asset_compute_details.kernel),
			architecture = COALESCE(EXCLUDED.architecture, asset_compute_details.architecture),
			os_build = COALESCE(EXCLUDED.os_build, asset_compute_details.os_build),
			last_boot = COALESCE(EXCLUDED.last_boot, asset_compute_details.last_boot),
			last_seen = COALESCE(EXCLUDED.last_seen, asset_compute_details.last_seen),
			pending_updates = EXCLUDED.pending_updates,
			updated_at = NOW()
	`, assetID, strings.TrimSpace(details.Processor), strings.TrimSpace(details.RAM), strings.TrimSpace(details.Storage), strings.TrimSpace(details.GPU), strings.TrimSpace(details.Display), strings.TrimSpace(details.BIOSVersion), strings.TrimSpace(details.MACAddress), strings.TrimSpace(details.OSName), strings.TrimSpace(details.OSVersion), strings.TrimSpace(details.Kernel), strings.TrimSpace(details.Architecture), strings.TrimSpace(details.OSBuild), strings.TrimSpace(details.LastBoot), strings.TrimSpace(details.LastSeen), details.PendingUpdates)
	return err
}

func (service *Service) replaceSoftwareInventory(ctx context.Context, tx *sql.Tx, assetID string, software []softwareRecord) error {
	if _, err := tx.ExecContext(ctx, `DELETE FROM asset_software_inventory WHERE asset_id = $1::uuid`, assetID); err != nil {
		return err
	}
	for _, application := range software {
		if strings.TrimSpace(application.Name) == "" {
			continue
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO asset_software_inventory (asset_id, name, version, install_date)
			VALUES ($1::uuid, $2, NULLIF($3, ''), NULLIF($4, '')::date)
		`, assetID, strings.TrimSpace(application.Name), strings.TrimSpace(application.Version), strings.TrimSpace(application.InstallDate)); err != nil {
			return err
		}
	}
	return nil
}

func (service *Service) setNextRun(nextRunAt time.Time) {
	service.mu.Lock()
	defer service.mu.Unlock()
	service.nextRunAt = nextRunAt
}

func coalesceString(value string, fallback string) string {
	if strings.TrimSpace(value) != "" {
		return strings.TrimSpace(value)
	}
	return strings.TrimSpace(fallback)
}

func normalizeFingerprint(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

func buildDepartmentShortCode(name string) string {
	var builder strings.Builder
	for _, r := range strings.TrimSpace(name) {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			builder.WriteRune(unicode.ToUpper(r))
		}
		if builder.Len() >= 20 {
			break
		}
	}
	if builder.Len() == 0 {
		return "DEPT"
	}
	return builder.String()
}
