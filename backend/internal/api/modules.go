package api

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"

	"itms/backend/internal/platform/authn"
	"itms/backend/internal/platform/httpx"
	"itms/backend/internal/platform/middleware"
)

func (server *apiServer) healthCheck(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 2*time.Second)
	defer cancel()

	status := "ok"
	databaseStatus := "up"
	if err := server.db.PingContext(ctx); err != nil {
		status = "degraded"
		databaseStatus = "down"
	}

	httpx.JSON(c, http.StatusOK, gin.H{
		"status":   status,
		"database": databaseStatus,
		"time":     time.Now().UTC(),
	})
}

func (server *apiServer) listAlerts(c *gin.Context) {
	claims := middleware.CurrentClaims(c)
	if claims == nil {
		httpx.Error(c, http.StatusUnauthorized, "unauthorized")
		return
	}
	server.listAlertsByOwner(c, claims.Role == "employee", claims.UserID)
}

func (server *apiServer) listMyAlerts(c *gin.Context) {
	claims := middleware.CurrentClaims(c)
	if claims == nil {
		httpx.Error(c, http.StatusUnauthorized, "unauthorized")
		return
	}
	server.listAlertsByOwner(c, true, claims.UserID)
}

func alertSourceKeyExpr(column string) string {
	return `CASE
		WHEN lower(` + column + `) IN ('salt', 'salt_patch', 'patch') THEN 'patch'
		WHEN lower(` + column + `) IN ('openscap', 'open_scap', 'hardening') THEN 'openscap'
		WHEN lower(` + column + `) IN ('clamav', 'clam', 'clamwin', 'clamscan') THEN 'clamav'
		WHEN lower(` + column + `) IN ('terminal', 'terminal_session') THEN 'terminal'
		ELSE lower(` + column + `)
	END`
}

func alertSourceLabelExpr(column string) string {
	return `CASE
		WHEN lower(` + column + `) IN ('salt', 'salt_patch', 'patch') THEN 'Patch'
		WHEN lower(` + column + `) IN ('openscap', 'open_scap', 'hardening') THEN 'OpenSCAP Hardening'
		WHEN lower(` + column + `) IN ('clamav', 'clam', 'clamwin', 'clamscan') THEN 'ClamAV'
		WHEN lower(` + column + `) IN ('terminal', 'terminal_session') THEN 'Terminal'
		ELSE initcap(replace(lower(` + column + `), '_', ' '))
	END`
}

func (server *apiServer) listAlertsByOwner(c *gin.Context, restrict bool, userID string) {
	page, pageSize, paginate := parsePaginationRequest(c, 20)
	searchQuery := strings.ToLower(strings.TrimSpace(c.Query("search")))
	sourceFilter := strings.ToLower(strings.TrimSpace(c.Query("source")))
	sourceKeyExpr := alertSourceKeyExpr("al.source")
	sourceLabelExpr := alertSourceLabelExpr("al.source")
	departmentExpr := `COALESCE(NULLIF(ad.name, ''), NULLIF(ud.name, ''), 'Unassigned')`
	searchExpr := `lower(concat_ws(' ', al.title, COALESCE(al.detail, ''), COALESCE(a.asset_tag, ''), COALESCE(a.name, ''), COALESCE(a.hostname, ''), COALESCE(u.full_name, ''), COALESCE(u.email, ''), ` + departmentExpr + `, al.source, ` + sourceLabelExpr + `))`
	baseFrom := `
		FROM alerts al
		LEFT JOIN assets a ON a.id = al.device_id
		LEFT JOIN users u ON u.id = al.user_id
		LEFT JOIN departments ad ON ad.id = a.dept_id
		LEFT JOIN departments ud ON ud.id = u.dept_id
	`
	whereClauses := []string{"1 = 1"}
	args := []any{}
	argIndex := 1
	if restrict {
		whereClauses = append(whereClauses, fmt.Sprintf("al.user_id = $%d::uuid", argIndex))
		args = append(args, userID)
		argIndex++
	}
	if sourceFilter != "" && sourceFilter != "all" {
		whereClauses = append(whereClauses, fmt.Sprintf("%s = $%d", sourceKeyExpr, argIndex))
		args = append(args, sourceFilter)
		argIndex++
	}
	if searchQuery != "" {
		whereClauses = append(whereClauses, fmt.Sprintf("%s LIKE $%d", searchExpr, argIndex))
		args = append(args, "%"+searchQuery+"%")
		argIndex++
	}
	whereSQL := strings.Join(whereClauses, " AND ")

	queryArgs := append([]any{}, args...)
	query := `
		SELECT al.id,
			COALESCE(a.id::text, ''), COALESCE(a.asset_tag, ''), COALESCE(a.name, ''), COALESCE(a.hostname, ''),
			COALESCE(u.id::text, ''), COALESCE(u.full_name, ''), COALESCE(u.email, ''),
			` + departmentExpr + `,
			` + sourceKeyExpr + ` AS source_key,
			` + sourceLabelExpr + ` AS source_label,
			COALESCE(al.source, ''), al.severity, al.title, COALESCE(al.detail, ''), al.acknowledged, al.resolved, al.created_at
	` + baseFrom + `
		WHERE ` + whereSQL + `
		ORDER BY al.created_at DESC`
	if paginate {
		query += fmt.Sprintf(" LIMIT $%d OFFSET $%d", argIndex, argIndex+1)
		queryArgs = append(queryArgs, pageSize, (page-1)*pageSize)
	}

	rows, err := server.db.Query(query, queryArgs...)
	if err != nil {
		httpx.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()

	result := make([]gin.H, 0)
	for rows.Next() {
		var id, assetID, assetTag, assetName, hostname, alertUserID, alertUserName, alertUserEmail, departmentName string
		var sourceKey, sourceLabel, rawSource, severity, title, detail string
		var acknowledged, resolved bool
		var createdAt time.Time
		if err := rows.Scan(&id, &assetID, &assetTag, &assetName, &hostname, &alertUserID, &alertUserName, &alertUserEmail, &departmentName, &sourceKey, &sourceLabel, &rawSource, &severity, &title, &detail, &acknowledged, &resolved, &createdAt); err != nil {
			httpx.Error(c, http.StatusInternalServerError, err.Error())
			return
		}

		result = append(result, gin.H{
			"id":           id,
			"assetId":      emptyToNil(assetID),
			"assetTag":     emptyToNil(assetTag),
			"assetName":    emptyToNil(assetName),
			"hostname":     emptyToNil(hostname),
			"deviceId":     firstNonEmpty(assetTag, hostname, assetID),
			"userId":       emptyToNil(alertUserID),
			"userName":     emptyToNil(alertUserName),
			"userEmail":    emptyToNil(alertUserEmail),
			"department":   departmentName,
			"source":       sourceKey,
			"sourceLabel":  sourceLabel,
			"sourceRaw":    rawSource,
			"severity":     severity,
			"title":        title,
			"detail":       detail,
			"acknowledged": acknowledged,
			"resolved":     resolved,
			"createdAt":    createdAt,
		})
	}

	if !paginate {
		httpx.JSON(c, http.StatusOK, result)
		return
	}

	var total, openCount, acknowledgedCount, resolvedCount int
	if err := server.db.QueryRow(`
		SELECT COUNT(*),
			COUNT(*) FILTER (WHERE NOT al.resolved),
			COUNT(*) FILTER (WHERE al.acknowledged),
			COUNT(*) FILTER (WHERE al.resolved)
		`+baseFrom+`
		WHERE `+whereSQL,
		args...,
	).Scan(&total, &openCount, &acknowledgedCount, &resolvedCount); err != nil {
		httpx.Error(c, http.StatusInternalServerError, err.Error())
		return
	}

	sourceRows, err := server.db.Query(`
		SELECT source_name, source_label, source_count
		FROM (
			SELECT `+sourceKeyExpr+` AS source_name, `+sourceLabelExpr+` AS source_label, COUNT(*) AS source_count
			`+baseFrom+`
			WHERE `+whereSQL+`
			GROUP BY source_name, source_label
		) source_counts
		ORDER BY source_count DESC, source_label ASC
	`, args...)
	if err != nil {
		httpx.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	defer sourceRows.Close()
	sourceSummary := make([]gin.H, 0)
	for sourceRows.Next() {
		var name, label string
		var count int
		if err := sourceRows.Scan(&name, &label, &count); err != nil {
			httpx.Error(c, http.StatusInternalServerError, err.Error())
			return
		}
		sourceSummary = append(sourceSummary, gin.H{"name": name, "label": label, "count": count})
	}
	if err := sourceRows.Err(); err != nil {
		httpx.Error(c, http.StatusInternalServerError, err.Error())
		return
	}

	httpx.JSON(c, http.StatusOK, gin.H{
		"items":    result,
		"total":    total,
		"page":     page,
		"pageSize": pageSize,
		"summary": gin.H{
			"open":         openCount,
			"acknowledged": acknowledgedCount,
			"resolved":     resolvedCount,
			"sourceCounts": sourceSummary,
		},
	})
}

func (server *apiServer) acknowledgeAlert(c *gin.Context) {
	claims := middleware.CurrentClaims(c)
	if claims == nil {
		httpx.Error(c, http.StatusUnauthorized, "unauthorized")
		return
	}

	query := `UPDATE alerts SET acknowledged = TRUE WHERE id = $1::uuid`
	args := []any{c.Param("id")}
	if claims.Role == "employee" {
		query += ` AND user_id = $2::uuid`
		args = append(args, claims.UserID)
	}
	query += ` RETURNING title, user_id`

	var title, userID string
	if err := server.db.QueryRow(query, args...).Scan(&title, &userID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			httpx.Error(c, http.StatusNotFound, "alert not found")
			return
		}
		httpx.Error(c, http.StatusInternalServerError, err.Error())
		return
	}

	middleware.TagAudit(c, middleware.AuditMeta{Action: "alert_acknowledged", TargetType: "alert", TargetID: c.Param("id"), Detail: gin.H{"title": title, "user_id": userID}})
	httpx.JSON(c, http.StatusOK, gin.H{"status": "acknowledged"})
}

func (server *apiServer) resolveAlert(c *gin.Context) {
	if !server.requireRoles(c, "super_admin", "it_team") {
		return
	}
	var title, userID string
	if err := server.db.QueryRow(`UPDATE alerts SET resolved = TRUE, acknowledged = TRUE WHERE id = $1::uuid RETURNING title, user_id`, c.Param("id")).Scan(&title, &userID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			httpx.Error(c, http.StatusNotFound, "alert not found")
			return
		}
		httpx.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	middleware.TagAudit(c, middleware.AuditMeta{Action: "alert_resolved", TargetType: "alert", TargetID: c.Param("id"), Detail: gin.H{"title": title, "user_id": userID}})
	httpx.JSON(c, http.StatusOK, gin.H{"status": "resolved"})
}

func (server *apiServer) listAnnouncements(c *gin.Context) {
	page, pageSize, paginate := parsePaginationRequest(c, 12)
	audienceFilters := c.QueryArray("audience")
	normalizedAudiences := make([]string, 0, len(audienceFilters))
	audienceLookup := map[string]struct{}{}
	for _, audience := range audienceFilters {
		audience = strings.TrimSpace(audience)
		if audience != "" {
			if _, exists := audienceLookup[audience]; exists {
				continue
			}
			audienceLookup[audience] = struct{}{}
			normalizedAudiences = append(normalizedAudiences, audience)
		}
	}
	whereClauses := make([]string, 0, 1)
	args := make([]any, 0, len(normalizedAudiences)+2)
	argIndex := 1
	if len(normalizedAudiences) > 0 {
		placeholders := make([]string, 0, len(normalizedAudiences))
		for _, audience := range normalizedAudiences {
			placeholders = append(placeholders, fmt.Sprintf("$%d", argIndex))
			args = append(args, audience)
			argIndex++
		}
		whereClauses = append(whereClauses, "a.audience IN ("+strings.Join(placeholders, ", ")+")")
	}
	whereSQL := ""
	if len(whereClauses) > 0 {
		whereSQL = " WHERE " + strings.Join(whereClauses, " AND ")
	}

	baseFrom := `
		FROM announcements a
		JOIN users u ON u.id = a.author_id
	`

	var total int
	if err := server.db.QueryRow(`SELECT COUNT(*) `+baseFrom+whereSQL, args...).Scan(&total); err != nil {
		httpx.Error(c, http.StatusInternalServerError, err.Error())
		return
	}

	queryArgs := append([]any{}, args...)
	query := `
		SELECT a.id, a.title, a.body, a.audience, a.urgent, a.created_at, u.full_name
		` + baseFrom + whereSQL + `
		ORDER BY a.created_at DESC
	`
	if paginate {
		query += fmt.Sprintf(" LIMIT $%d OFFSET $%d", argIndex, argIndex+1)
		queryArgs = append(queryArgs, pageSize, (page-1)*pageSize)
	}

	rows, err := server.db.Query(query, queryArgs...)
	if err != nil {
		httpx.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()

	result := make([]gin.H, 0)
	for rows.Next() {
		var id, title, body, audience, authorName string
		var urgent bool
		var createdAt time.Time
		if err := rows.Scan(&id, &title, &body, &audience, &urgent, &createdAt, &authorName); err != nil {
			httpx.Error(c, http.StatusInternalServerError, err.Error())
			return
		}

		result = append(result, gin.H{
			"id":         id,
			"title":      title,
			"body":       body,
			"audience":   audience,
			"urgent":     urgent,
			"createdAt":  createdAt,
			"authorName": authorName,
		})
	}
	if err := rows.Err(); err != nil {
		httpx.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	if !paginate {
		httpx.JSON(c, http.StatusOK, result)
		return
	}
	httpx.JSON(c, http.StatusOK, gin.H{"items": result, "total": total, "page": page, "pageSize": pageSize})
}

func (server *apiServer) createAnnouncement(c *gin.Context) {
	if !server.requireRoles(c, "super_admin", "it_team") {
		return
	}
	claims := middleware.CurrentClaims(c)
	var input struct {
		Title    string `json:"title"`
		Body     string `json:"body"`
		Audience string `json:"audience"`
		Urgent   bool   `json:"urgent"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		httpx.Error(c, http.StatusBadRequest, "invalid announcement payload")
		return
	}
	if strings.TrimSpace(input.Title) == "" || strings.TrimSpace(input.Body) == "" {
		httpx.Error(c, http.StatusBadRequest, "title and body are required")
		return
	}
	if strings.TrimSpace(input.Audience) == "" {
		input.Audience = "All Employees"
	}
	var id string
	if err := server.db.QueryRow(`
		INSERT INTO announcements (author_id, title, body, audience, urgent)
		VALUES ($1::uuid, $2, $3, $4, $5)
		RETURNING id
	`, claims.UserID, strings.TrimSpace(input.Title), strings.TrimSpace(input.Body), strings.TrimSpace(input.Audience), input.Urgent).Scan(&id); err != nil {
		httpx.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	server.announcements.publish(strings.TrimSpace(input.Audience), announcementEnvelope{
		Type:      "announcement_published",
		ID:        id,
		Title:     strings.TrimSpace(input.Title),
		Audience:  strings.TrimSpace(input.Audience),
		Urgent:    input.Urgent,
		CreatedAt: time.Now().UTC().Format(time.RFC3339Nano),
	})
	middleware.TagAudit(c, middleware.AuditMeta{Action: "announcement_published", TargetType: "announcement", TargetID: id, Detail: input})
	httpx.Created(c, gin.H{"id": id})
}

func announcementAudiencesForRole(role string) []string {
	switch role {
	case "super_admin", "it_team":
		return []string{"All Employees", "IT Team", "Super Admin"}
	default:
		return []string{"All Employees"}
	}
}

func (server *apiServer) announcementWebsocket(c *gin.Context) {
	rawToken := extractWebSocketBearerToken(c.Request)
	if rawToken == "" {
		httpx.Error(c, http.StatusBadRequest, "token is required")
		return
	}
	if !server.websocketOriginAllowed(c.GetHeader("Origin")) {
		httpx.Error(c, http.StatusForbidden, "origin not allowed")
		return
	}
	claims, err := server.auth.ParseToken(rawToken)
	if err != nil {
		httpx.Error(c, http.StatusUnauthorized, "invalid token")
		return
	}
	responseHeader := http.Header{}
	if protocol := selectAnnouncementSubprotocol(c.Request); protocol != "" {
		responseHeader.Set("Sec-WebSocket-Protocol", protocol)
	}
	upgrader := websocket.Upgrader{CheckOrigin: func(request *http.Request) bool {
		return server.websocketOriginAllowed(request.Header.Get("Origin"))
	}}
	conn, err := upgrader.Upgrade(c.Writer, c.Request, responseHeader)
	if err != nil {
		return
	}
	audiences := announcementAudiencesForRole(claims.Role)
	for _, audience := range audiences {
		server.announcements.subscribe(audience, conn)
	}
	defer func() {
		for _, audience := range audiences {
			server.announcements.unsubscribe(audience, conn)
		}
		_ = conn.Close()
	}()
	for {
		if _, _, err := conn.ReadMessage(); err != nil {
			return
		}
	}
}

func (server *apiServer) markAnnouncementRead(c *gin.Context) {
	claims := middleware.CurrentClaims(c)
	if claims == nil {
		httpx.Error(c, http.StatusUnauthorized, "unauthorized")
		return
	}
	_, err := server.db.Exec(`
		INSERT INTO announcement_reads (announcement_id, user_id)
		VALUES ($1::uuid, $2::uuid)
		ON CONFLICT (announcement_id, user_id) DO UPDATE SET read_at = NOW()
	`, c.Param("id"), claims.UserID)
	if err != nil {
		httpx.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	middleware.TagAudit(c, middleware.AuditMeta{Action: "announcement_read", TargetType: "announcement", TargetID: c.Param("id")})
	httpx.Created(c, gin.H{"status": "read"})
}

func (server *apiServer) createGatepass(c *gin.Context) {
	claims := middleware.CurrentClaims(c)
	if claims == nil {
		httpx.Error(c, http.StatusUnauthorized, "unauthorized")
		return
	}
	var input struct {
		AssetRef         string `json:"assetRef"`
		AssetDescription string `json:"assetDescription"`
		Purpose          string `json:"purpose"`
		OriginBranch     string `json:"originBranch"`
		RecipientBranch  string `json:"recipientBranch"`
		IssueDate        string `json:"issueDate"`
		EmployeeName     string `json:"employeeName"`
		EmployeeCode     string `json:"employeeCode"`
		DepartmentName   string `json:"departmentName"`
		ApproverName     string `json:"approverName"`
		ContactNumber    string `json:"contactNumber"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		httpx.Error(c, http.StatusBadRequest, "invalid gatepass payload")
		return
	}
	if strings.TrimSpace(input.Purpose) == "" {
		httpx.Error(c, http.StatusBadRequest, "purpose is required")
		return
	}
	if strings.TrimSpace(input.ApproverName) == "" {
		httpx.Error(c, http.StatusBadRequest, "approverName is required")
		return
	}
	issueDate := strings.TrimSpace(input.IssueDate)
	if issueDate == "" {
		issueDate = time.Now().UTC().Format("2006-01-02")
	}
	issueDay, err := time.Parse("2006-01-02", issueDate)
	if err != nil {
		httpx.Error(c, http.StatusBadRequest, "invalid issue date")
		return
	}
	tx, err := server.db.BeginTx(c.Request.Context(), nil)
	if err != nil {
		httpx.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	defer func() { _ = tx.Rollback() }()

	var requesterName string
	if err := tx.QueryRow(`SELECT full_name FROM users WHERE id = $1::uuid`, claims.UserID).Scan(&requesterName); err != nil {
		httpx.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	var sequence int
	if err := tx.QueryRow(`
		SELECT COUNT(*) + 1
		FROM gatepasses
		WHERE issue_date = $1::date
	`, issueDay.Format("2006-01-02")).Scan(&sequence); err != nil {
		httpx.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	gatepassNumber := fmt.Sprintf("ZGP-%s-%04d", issueDay.Format("20060102"), sequence)
	var id string
	if err := tx.QueryRow(`
		INSERT INTO gatepasses (
			requester_id, gatepass_number, asset_ref, asset_description, purpose, origin_branch, recipient_branch,
			issue_date, employee_name, employee_code, department_name, approver_name_text, contact_number, status, issuer_signed_name, issuer_signed_at
		)
		VALUES (
			$1::uuid, $2, $3, NULLIF($4, ''), $5, NULLIF($6, ''), NULLIF($7, ''),
			NULLIF($8, '')::date, NULLIF($9, ''), NULLIF($10, ''), NULLIF($11, ''), NULLIF($12, ''), NULLIF($13, ''), 'pending', $14, NOW()
		)
		RETURNING id
	`, claims.UserID,
		gatepassNumber,
		strings.TrimSpace(input.AssetRef),
		strings.TrimSpace(input.AssetDescription),
		strings.TrimSpace(input.Purpose),
		strings.TrimSpace(input.OriginBranch),
		strings.TrimSpace(input.RecipientBranch),
		issueDate,
		strings.TrimSpace(input.EmployeeName),
		strings.TrimSpace(input.EmployeeCode),
		strings.TrimSpace(input.DepartmentName),
		strings.TrimSpace(input.ApproverName),
		strings.TrimSpace(input.ContactNumber),
		requesterName,
	).Scan(&id); err != nil {
		httpx.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	if err := tx.Commit(); err != nil {
		httpx.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	middleware.TagAudit(c, middleware.AuditMeta{Action: "gatepass_created", TargetType: "gatepass", TargetID: id, Detail: input})
	httpx.Created(c, gin.H{"id": id, "gatepassNumber": gatepassNumber})
}

func (server *apiServer) listGatepasses(c *gin.Context) {
	claims := middleware.CurrentClaims(c)
	if claims == nil {
		httpx.Error(c, http.StatusUnauthorized, "unauthorized")
		return
	}
	page, pageSize, paginate := parsePaginationRequest(c, 25)
	query := `
		SELECT g.id, COALESCE(g.gatepass_number, ''), COALESCE(g.asset_ref, ''), COALESCE(g.asset_description, ''), g.purpose, COALESCE(g.origin_branch, ''), COALESCE(g.recipient_branch, ''),
			COALESCE(g.issue_date::text, ''), COALESCE(g.employee_name, ''), COALESCE(g.employee_code, ''), COALESCE(g.department_name, ''), COALESCE(g.contact_number, ''),
			g.status, g.created_at, COALESCE(g.issuer_signed_name, ''), COALESCE(g.issuer_signed_at::text, ''), COALESCE(g.receiver_signed_name, ''), COALESCE(g.receiver_signed_at::text, ''), COALESCE(g.security_signed_name, ''), COALESCE(g.security_signed_at::text, ''),
			COALESCE(approver.full_name, g.approver_name_text, ''), requester.full_name,
			COALESCE(g.receiver_signed_file_name, ''), COALESCE(g.receiver_signed_file_content_type, ''), COALESCE(g.receiver_signed_file_uploaded_at::text, ''),
			COALESCE(g.receiver_signed_verification_status, ''), COALESCE(g.receiver_signed_verification_notes, '')
		FROM gatepasses g
		JOIN users requester ON requester.id = g.requester_id
		LEFT JOIN users approver ON approver.id = g.approver_id
	`
	args := []any{}
	if claims.Role == "employee" {
		query += ` WHERE g.requester_id = $1::uuid`
		args = append(args, claims.UserID)
	}
	countQuery := `
		SELECT
			COUNT(*),
			COUNT(*) FILTER (
				WHERE g.status = 'pending'
				   OR (g.status = 'approved' AND COALESCE(g.receiver_signed_file_name, '') = '')
				   OR (g.status = 'approved' AND g.receiver_signed_at IS NOT NULL AND g.security_signed_at IS NULL)
			),
			COUNT(*) FILTER (
				WHERE NOT (
					g.status = 'pending'
					OR (g.status = 'approved' AND COALESCE(g.receiver_signed_file_name, '') = '')
					OR (g.status = 'approved' AND g.receiver_signed_at IS NOT NULL AND g.security_signed_at IS NULL)
				)
			)
		FROM gatepasses g
	`
	if claims.Role == "employee" {
		countQuery += ` WHERE g.requester_id = $1::uuid`
	}
	query += ` ORDER BY g.created_at DESC`
	if paginate {
		query += fmt.Sprintf(" LIMIT $%d OFFSET $%d", len(args)+1, len(args)+2)
		args = append(args, pageSize, (page-1)*pageSize)
	}

	rows, err := server.db.Query(query, args...)
	if err != nil {
		httpx.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()

	result := make([]gin.H, 0)
	for rows.Next() {
		var id, gatepassNumber, assetRef, assetDescription, purpose, originBranch, recipientBranch, issueDate, employeeName, employeeCode, departmentName, contactNumber, status, issuerSignedName, issuerSignedAt, receiverSignedName, receiverSignedAt, securitySignedName, securitySignedAt, approverName, requesterName string
		var receiverSignedFileName, receiverSignedFileContentType, receiverSignedFileUploadedAt, receiverSignedVerificationStatus, receiverSignedVerificationNotes string
		var createdAt time.Time
		if err := rows.Scan(&id, &gatepassNumber, &assetRef, &assetDescription, &purpose, &originBranch, &recipientBranch, &issueDate, &employeeName, &employeeCode, &departmentName, &contactNumber, &status, &createdAt, &issuerSignedName, &issuerSignedAt, &receiverSignedName, &receiverSignedAt, &securitySignedName, &securitySignedAt, &approverName, &requesterName, &receiverSignedFileName, &receiverSignedFileContentType, &receiverSignedFileUploadedAt, &receiverSignedVerificationStatus, &receiverSignedVerificationNotes); err != nil {
			httpx.Error(c, http.StatusInternalServerError, err.Error())
			return
		}
		result = append(result, gin.H{
			"id":                               id,
			"gatepassNumber":                   gatepassNumber,
			"assetRef":                         assetRef,
			"assetDescription":                 assetDescription,
			"purpose":                          purpose,
			"originBranch":                     originBranch,
			"recipientBranch":                  recipientBranch,
			"issueDate":                        issueDate,
			"employeeName":                     employeeName,
			"employeeCode":                     employeeCode,
			"departmentName":                   departmentName,
			"contactNumber":                    contactNumber,
			"status":                           status,
			"createdAt":                        createdAt,
			"issuerSignedName":                 issuerSignedName,
			"issuerSignedAt":                   issuerSignedAt,
			"receiverSignedName":               receiverSignedName,
			"receiverSignedAt":                 receiverSignedAt,
			"securitySignedName":               securitySignedName,
			"securitySignedAt":                 securitySignedAt,
			"approverName":                     approverName,
			"requesterName":                    requesterName,
			"receiverSignedFileName":           emptyToNil(receiverSignedFileName),
			"receiverSignedFileContentType":    emptyToNil(receiverSignedFileContentType),
			"receiverSignedFileUploadedAt":     emptyToNil(receiverSignedFileUploadedAt),
			"receiverSignedVerificationStatus": emptyToNil(receiverSignedVerificationStatus),
			"receiverSignedVerificationNotes":  emptyToNil(receiverSignedVerificationNotes),
			"hasReceiverSignedUpload":          receiverSignedFileName != "",
		})
	}
	if !paginate {
		httpx.JSON(c, http.StatusOK, result)
		return
	}
	var total, pendingCount, archivedCount int
	err = server.db.QueryRow(countQuery, args[:len(args)-2]...).Scan(&total, &pendingCount, &archivedCount)
	if err != nil {
		httpx.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	httpx.JSON(c, http.StatusOK, gin.H{
		"items":    result,
		"total":    total,
		"page":     page,
		"pageSize": pageSize,
		"summary": gin.H{
			"pending":  pendingCount,
			"archived": archivedCount,
		},
	})
}

func (server *apiServer) approveGatepass(c *gin.Context) { server.decideGatepass(c, "approved") }
func (server *apiServer) rejectGatepass(c *gin.Context)  { server.decideGatepass(c, "rejected") }

func (server *apiServer) completeGatepass(c *gin.Context) {
	if !server.requireRoles(c, "super_admin", "it_team") {
		return
	}
	var input struct {
		ReceiverSignedName string `json:"receiverSignedName"`
		SecuritySignedName string `json:"securitySignedName"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		httpx.Error(c, http.StatusBadRequest, "invalid gatepass completion payload")
		return
	}
	securityName := strings.TrimSpace(input.SecuritySignedName)
	if securityName == "" {
		httpx.Error(c, http.StatusBadRequest, "securitySignedName is required")
		return
	}
	receiverName := strings.TrimSpace(input.ReceiverSignedName)
	result, err := server.db.Exec(`
		UPDATE gatepasses
		SET receiver_signed_name = COALESCE(NULLIF(receiver_signed_name, ''), COALESCE(NULLIF($2, ''), employee_name)),
			receiver_signed_at = COALESCE(receiver_signed_at, NOW()),
			security_signed_name = $3,
			security_signed_at = NOW(),
			status = 'completed',
			updated_at = NOW()
		WHERE id = $1::uuid
	`, c.Param("id"), receiverName, securityName)
	if err != nil {
		httpx.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	if rows, _ := result.RowsAffected(); rows == 0 {
		httpx.Error(c, http.StatusNotFound, "gatepass not found")
		return
	}
	middleware.TagAudit(c, middleware.AuditMeta{Action: "gatepass_completed", TargetType: "gatepass", TargetID: c.Param("id"), Detail: input})
	httpx.JSON(c, http.StatusOK, gin.H{"status": "completed"})
}

func (server *apiServer) uploadReceiverSignedGatepass(c *gin.Context) {
	if !server.requireRoles(c, "super_admin", "it_team") {
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 9<<20)
	claims := middleware.CurrentClaims(c)
	if claims == nil {
		httpx.Error(c, http.StatusUnauthorized, "unauthorized")
		return
	}
	receiverName := strings.TrimSpace(c.PostForm("receiverSignedName"))
	if receiverName == "" {
		httpx.Error(c, http.StatusBadRequest, "receiverSignedName is required")
		return
	}
	fileHeader, err := c.FormFile("file")
	if err != nil {
		httpx.Error(c, http.StatusBadRequest, "signed gatepass file is required")
		return
	}
	file, err := fileHeader.Open()
	if err != nil {
		httpx.Error(c, http.StatusBadRequest, "failed to open uploaded file")
		return
	}
	defer file.Close()
	content, err := io.ReadAll(io.LimitReader(file, 8<<20+1))
	if err != nil {
		httpx.Error(c, http.StatusBadRequest, "failed to read uploaded file")
		return
	}
	if len(content) == 0 {
		httpx.Error(c, http.StatusBadRequest, "uploaded file is empty")
		return
	}
	if len(content) > 8<<20 {
		httpx.Error(c, http.StatusBadRequest, "uploaded file must be 8 MB or smaller")
		return
	}
	contentType := fileHeader.Header.Get("Content-Type")
	if strings.TrimSpace(contentType) == "" {
		contentType = http.DetectContentType(content)
	}
	if contentType != "application/pdf" && !strings.HasPrefix(contentType, "image/") {
		httpx.Error(c, http.StatusBadRequest, "only PDF or image uploads are supported")
		return
	}

	var gatepassNumber, assetRef, employeeCode string
	if err := server.db.QueryRow(`SELECT COALESCE(gatepass_number, ''), COALESCE(asset_ref, ''), COALESCE(employee_code, '') FROM gatepasses WHERE id = $1::uuid`, c.Param("id")).Scan(&gatepassNumber, &assetRef, &employeeCode); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			httpx.Error(c, http.StatusNotFound, "gatepass not found")
			return
		}
		httpx.Error(c, http.StatusInternalServerError, err.Error())
		return
	}

	verificationStatus, verificationNotes := analyzeSignedGatepassUpload(gatepassNumber, assetRef, employeeCode, fileHeader.Filename, contentType, content)
	result, err := server.db.Exec(`
		UPDATE gatepasses
		SET receiver_signed_name = $2,
			receiver_signed_at = COALESCE(receiver_signed_at, NOW()),
			receiver_signed_file_name = $3,
			receiver_signed_file_content_type = $4,
			receiver_signed_file_data = $5,
			receiver_signed_file_uploaded_at = NOW(),
			receiver_signed_file_uploaded_by = $6::uuid,
			receiver_signed_verification_status = $7,
			receiver_signed_verification_notes = NULLIF($8, ''),
			updated_at = NOW()
		WHERE id = $1::uuid
	`, c.Param("id"), receiverName, strings.TrimSpace(fileHeader.Filename), contentType, content, claims.UserID, verificationStatus, verificationNotes)
	if err != nil {
		httpx.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	if rows, _ := result.RowsAffected(); rows == 0 {
		httpx.Error(c, http.StatusNotFound, "gatepass not found")
		return
	}
	detail := gin.H{"receiverSignedName": receiverName, "fileName": fileHeader.Filename, "verificationStatus": verificationStatus, "verificationNotes": verificationNotes}
	middleware.TagAudit(c, middleware.AuditMeta{Action: "gatepass_receiver_upload", TargetType: "gatepass", TargetID: c.Param("id"), Detail: detail})
	httpx.JSON(c, http.StatusOK, gin.H{"status": "uploaded", "verificationStatus": verificationStatus, "verificationNotes": verificationNotes})
}

func (server *apiServer) downloadReceiverSignedGatepass(c *gin.Context) {
	claims := middleware.CurrentClaims(c)
	if claims == nil {
		httpx.Error(c, http.StatusUnauthorized, "unauthorized")
		return
	}
	var fileName, contentType string
	var data []byte
	if err := server.db.QueryRow(`SELECT COALESCE(receiver_signed_file_name, ''), COALESCE(receiver_signed_file_content_type, ''), receiver_signed_file_data FROM gatepasses WHERE id = $1::uuid`, c.Param("id")).Scan(&fileName, &contentType, &data); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			httpx.Error(c, http.StatusNotFound, "gatepass not found")
			return
		}
		httpx.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	if len(data) == 0 || strings.TrimSpace(fileName) == "" {
		httpx.Error(c, http.StatusNotFound, "signed gatepass upload not found")
		return
	}
	if strings.TrimSpace(contentType) == "" {
		contentType = http.DetectContentType(data)
	}
	disposition := "inline"
	if c.Query("download") == "1" {
		disposition = "attachment"
	}
	c.Header("Content-Type", contentType)
	c.Header("Content-Disposition", fmt.Sprintf("%s; filename=%q", disposition, fileName))
	c.Data(http.StatusOK, contentType, data)
}

func (server *apiServer) decideGatepass(c *gin.Context, status string) {
	if !server.requireRoles(c, "super_admin", "it_team") {
		return
	}
	claims := middleware.CurrentClaims(c)
	var requesterID string
	if err := server.db.QueryRow(`
		UPDATE gatepasses
		SET status = $2, approver_id = $3::uuid, updated_at = NOW()
		WHERE id = $1::uuid
		RETURNING requester_id
	`, c.Param("id"), status, claims.UserID).Scan(&requesterID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			httpx.Error(c, http.StatusNotFound, "gatepass not found")
			return
		}
		httpx.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	middleware.TagAudit(c, middleware.AuditMeta{Action: "gatepass_" + status, TargetType: "gatepass", TargetID: c.Param("id"), Detail: gin.H{"requester_id": requesterID}})
	httpx.JSON(c, http.StatusOK, gin.H{"status": status})
}

func analyzeSignedGatepassUpload(gatepassNumber string, assetRef string, employeeCode string, fileName string, contentType string, content []byte) (string, string) {
	searchable := strings.ToLower(strings.TrimSpace(fileName))
	if len(content) > 0 {
		limit := content
		if len(limit) > 512<<10 {
			limit = limit[:512<<10]
		}
		searchable += "\n" + extractSearchableUploadText(limit)
	}

	tokens := []struct {
		label string
		value string
	}{
		{label: "gatepass number", value: gatepassNumber},
		{label: "asset ref", value: assetRef},
		{label: "employee code", value: employeeCode},
	}

	matched := make([]string, 0, len(tokens))
	for _, token := range tokens {
		normalized := strings.ToLower(strings.TrimSpace(token.value))
		if normalized != "" && strings.Contains(searchable, normalized) {
			matched = append(matched, token.label)
		}
	}

	if len(matched) >= 2 {
		return "verified", fmt.Sprintf("Matched %s in the uploaded document.", strings.Join(matched, ", "))
	}
	if len(matched) == 1 {
		return "review", fmt.Sprintf("Partially matched the %s. Manual review is recommended.", matched[0])
	}
	if strings.HasPrefix(contentType, "image/") {
		return "review", "Image upload stored. Automatic OCR is not enabled, so manual review is required."
	}
	return "review", "Uploaded document stored, but automatic verification could not confidently match the generated gatepass markers."
}

func extractSearchableUploadText(content []byte) string {
	content = bytes.ToLower(content)
	builder := strings.Builder{}
	builder.Grow(len(content))
	for _, char := range content {
		if (char >= 'a' && char <= 'z') || (char >= '0' && char <= '9') || char == '-' || char == '_' || char == ' ' || char == '.' || char == '/' {
			builder.WriteByte(char)
			continue
		}
		if char == '\n' || char == '\r' || char == '\t' {
			builder.WriteByte(' ')
		}
	}
	return builder.String()
}

func (server *apiServer) listStock(c *gin.Context) {
	if !server.requireRoles(c, "super_admin", "it_team") {
		return
	}
	page, pageSize, paginate := parsePaginationRequest(c, 24)
	branchFilter := strings.TrimSpace(c.Query("branch"))
	searchQuery := strings.ToLower(strings.TrimSpace(c.Query("search")))
	whereClauses := []string{"1 = 1"}
	args := make([]any, 0, 4)
	argIndex := 1
	if branchFilter != "" && branchFilter != "all" {
		whereClauses = append(whereClauses, fmt.Sprintf("branch_id = $%d::uuid", argIndex))
		args = append(args, branchFilter)
		argIndex++
	}
	if searchQuery != "" {
		whereClauses = append(whereClauses, fmt.Sprintf("lower(concat_ws(' ', item_code, name, COALESCE(serial_number, ''), COALESCE(specs, ''), category)) LIKE $%d", argIndex))
		args = append(args, "%"+searchQuery+"%")
		argIndex++
	}
	whereSQL := strings.Join(whereClauses, " AND ")

	var total, available, allocated, retired, returned, inventory int
	err := server.db.QueryRow(`
		SELECT
			COUNT(*),
			COUNT(*) FILTER (WHERE status IN ('inventory', 'returned')),
			COUNT(*) FILTER (WHERE status = 'allocated'),
			COUNT(*) FILTER (WHERE status = 'retired'),
			COUNT(*) FILTER (WHERE status = 'returned'),
			COUNT(*) FILTER (WHERE status = 'inventory')
		FROM stock_items
		WHERE `+whereSQL, args...).Scan(&total, &available, &allocated, &retired, &returned, &inventory)
	if err != nil {
		httpx.Error(c, http.StatusInternalServerError, err.Error())
		return
	}

	groupRows, err := server.db.Query(`
		SELECT
			category,
			name,
			COUNT(*) AS total,
			COUNT(*) FILTER (WHERE status IN ('inventory', 'returned')) AS available,
			COUNT(*) FILTER (WHERE status = 'allocated') AS allocated,
			COUNT(*) FILTER (WHERE status = 'retired') AS retired,
			COUNT(*) FILTER (WHERE status = 'returned') AS returned
		FROM stock_items
		WHERE `+whereSQL+`
		GROUP BY category, name
		ORDER BY COUNT(*) FILTER (WHERE status IN ('inventory', 'returned')) ASC, name ASC
	`, args...)
	if err != nil {
		httpx.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	defer groupRows.Close()
	groups := make([]gin.H, 0)
	for groupRows.Next() {
		var category, name string
		var groupTotal, groupAvailable, groupAllocated, groupRetired, groupReturned int
		if err := groupRows.Scan(&category, &name, &groupTotal, &groupAvailable, &groupAllocated, &groupRetired, &groupReturned); err != nil {
			httpx.Error(c, http.StatusInternalServerError, err.Error())
			return
		}
		groups = append(groups, gin.H{
			"category":  category,
			"name":      name,
			"total":     groupTotal,
			"available": groupAvailable,
			"allocated": groupAllocated,
			"retired":   groupRetired,
			"returned":  groupReturned,
		})
	}

	queryArgs := append([]any{}, args...)
	query := `
		SELECT id, item_code, category, name, COALESCE(serial_number, ''), COALESCE(specs, ''), COALESCE(branch_id::text, ''),
			COALESCE(assigned_user_id::text, ''), COALESCE(warranty_expires_at::text, ''), status, created_at
		FROM stock_items
		WHERE ` + whereSQL + `
		ORDER BY created_at DESC`
	if paginate {
		query += fmt.Sprintf(" LIMIT $%d OFFSET $%d", argIndex, argIndex+1)
		queryArgs = append(queryArgs, pageSize, (page-1)*pageSize)
	}
	rows, err := server.db.Query(query, queryArgs...)
	if err != nil {
		httpx.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()

	result := make([]gin.H, 0)
	summary := gin.H{"total": total, "available": available, "allocated": allocated, "retired": retired, "returned": returned, "inventory": inventory}
	for rows.Next() {
		var id, itemCode, category, name, serialNumber, specs, branchID, assignedUserID, warranty, status string
		var createdAt time.Time
		if err := rows.Scan(&id, &itemCode, &category, &name, &serialNumber, &specs, &branchID, &assignedUserID, &warranty, &status, &createdAt); err != nil {
			httpx.Error(c, http.StatusInternalServerError, err.Error())
			return
		}
		entry := gin.H{
			"id":                id,
			"itemCode":          itemCode,
			"category":          category,
			"name":              name,
			"serialNumber":      serialNumber,
			"specs":             specs,
			"branchId":          emptyToNullString(branchID),
			"assignedUserId":    emptyToNullString(assignedUserID),
			"warrantyExpiresAt": emptyToNullString(warranty),
			"status":            status,
			"createdAt":         createdAt,
		}
		result = append(result, entry)
	}
	if !paginate {
		httpx.JSON(c, http.StatusOK, result)
		return
	}
	httpx.JSON(c, http.StatusOK, gin.H{"items": result, "total": total, "page": page, "pageSize": pageSize, "summary": summary, "groups": groups})
}

func (server *apiServer) createStockItem(c *gin.Context) {
	if !server.requireRoles(c, "super_admin", "it_team") {
		return
	}
	var input struct {
		Category          string `json:"category"`
		Name              string `json:"name"`
		SerialNumber      string `json:"serialNumber"`
		Specs             string `json:"specs"`
		BranchID          string `json:"branchId"`
		WarrantyExpiresAt string `json:"warrantyExpiresAt"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		httpx.Error(c, http.StatusBadRequest, "invalid stock payload")
		return
	}
	if strings.TrimSpace(input.Name) == "" {
		httpx.Error(c, http.StatusBadRequest, "name is required")
		return
	}
	var id, itemCode string
	err := server.db.QueryRow(`
		INSERT INTO stock_items (category, name, serial_number, specs, branch_id, warranty_expires_at, status)
		VALUES ($1, $2, NULLIF($3, ''), NULLIF($4, ''), NULLIF($5, '')::uuid, NULLIF($6, '')::date, 'inventory')
		RETURNING id, item_code
	`, strings.TrimSpace(input.Category), strings.TrimSpace(input.Name), strings.TrimSpace(input.SerialNumber), strings.TrimSpace(input.Specs), strings.TrimSpace(input.BranchID), strings.TrimSpace(input.WarrantyExpiresAt)).Scan(&id, &itemCode)
	if err != nil {
		httpx.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	middleware.TagAudit(c, middleware.AuditMeta{Action: "stock_item_created", TargetType: "stock_item", TargetID: id, Detail: input})
	httpx.Created(c, gin.H{"id": id, "itemCode": itemCode})
}

func (server *apiServer) updateStockItem(c *gin.Context) {
	if !server.requireRoles(c, "super_admin", "it_team") {
		return
	}
	var input struct {
		Category          string `json:"category"`
		Name              string `json:"name"`
		SerialNumber      string `json:"serialNumber"`
		Specs             string `json:"specs"`
		BranchID          string `json:"branchId"`
		WarrantyExpiresAt string `json:"warrantyExpiresAt"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		httpx.Error(c, http.StatusBadRequest, "invalid stock payload")
		return
	}
	if strings.TrimSpace(input.Name) == "" {
		httpx.Error(c, http.StatusBadRequest, "name is required")
		return
	}
	result, err := server.db.Exec(`
		UPDATE stock_items
		SET category = $2,
			name = $3,
			serial_number = NULLIF($4, ''),
			specs = NULLIF($5, ''),
			branch_id = NULLIF($6, '')::uuid,
			warranty_expires_at = NULLIF($7, '')::date,
			updated_at = NOW()
		WHERE id = $1::uuid
	`, c.Param("id"), strings.TrimSpace(input.Category), strings.TrimSpace(input.Name), strings.TrimSpace(input.SerialNumber), strings.TrimSpace(input.Specs), strings.TrimSpace(input.BranchID), strings.TrimSpace(input.WarrantyExpiresAt))
	if err != nil {
		httpx.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	if rows, _ := result.RowsAffected(); rows == 0 {
		httpx.Error(c, http.StatusNotFound, "stock item not found")
		return
	}
	middleware.TagAudit(c, middleware.AuditMeta{Action: "stock_item_updated", TargetType: "stock_item", TargetID: c.Param("id"), Detail: input})
	httpx.JSON(c, http.StatusOK, gin.H{"status": "updated"})
}

func (server *apiServer) deleteStockItem(c *gin.Context) {
	if !server.requireRoles(c, "super_admin", "it_team") {
		return
	}
	var status string
	if err := server.db.QueryRow(`SELECT status FROM stock_items WHERE id = $1::uuid`, c.Param("id")).Scan(&status); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			httpx.Error(c, http.StatusNotFound, "stock item not found")
			return
		}
		httpx.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	if status == "allocated" {
		httpx.Error(c, http.StatusBadRequest, "allocated stock item must be returned before deletion")
		return
	}
	result, err := server.db.Exec(`DELETE FROM stock_items WHERE id = $1::uuid`, c.Param("id"))
	if err != nil {
		httpx.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	if rows, _ := result.RowsAffected(); rows == 0 {
		httpx.Error(c, http.StatusNotFound, "stock item not found")
		return
	}
	middleware.TagAudit(c, middleware.AuditMeta{Action: "stock_item_deleted", TargetType: "stock_item", TargetID: c.Param("id")})
	httpx.JSON(c, http.StatusOK, gin.H{"status": "deleted"})
}

func (server *apiServer) allocateStockItem(c *gin.Context) {
	if !server.requireRoles(c, "super_admin", "it_team") {
		return
	}
	var input struct {
		UserID string `json:"userId"`
	}
	if err := c.ShouldBindJSON(&input); err != nil || strings.TrimSpace(input.UserID) == "" {
		httpx.Error(c, http.StatusBadRequest, "userId is required")
		return
	}
	result, err := server.db.Exec(`
		UPDATE stock_items
		SET assigned_user_id = $2::uuid, status = 'allocated', updated_at = NOW()
		WHERE id = $1::uuid
	`, c.Param("id"), strings.TrimSpace(input.UserID))
	if err != nil {
		httpx.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	if rows, _ := result.RowsAffected(); rows == 0 {
		httpx.Error(c, http.StatusNotFound, "stock item not found")
		return
	}
	middleware.TagAudit(c, middleware.AuditMeta{Action: "stock_item_allocated", TargetType: "stock_item", TargetID: c.Param("id"), Detail: input})
	httpx.JSON(c, http.StatusOK, gin.H{"status": "allocated"})
}

func (server *apiServer) returnStockItem(c *gin.Context) {
	if !server.requireRoles(c, "super_admin", "it_team") {
		return
	}
	result, err := server.db.Exec(`
		UPDATE stock_items
		SET assigned_user_id = NULL, status = 'returned', updated_at = NOW()
		WHERE id = $1::uuid
	`, c.Param("id"))
	if err != nil {
		httpx.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	if rows, _ := result.RowsAffected(); rows == 0 {
		httpx.Error(c, http.StatusNotFound, "stock item not found")
		return
	}
	middleware.TagAudit(c, middleware.AuditMeta{Action: "stock_item_returned", TargetType: "stock_item", TargetID: c.Param("id")})
	httpx.JSON(c, http.StatusOK, gin.H{"status": "returned"})
}

func (server *apiServer) retireStockItem(c *gin.Context) {
	if !server.requireRoles(c, "super_admin", "it_team") {
		return
	}
	result, err := server.db.Exec(`
		UPDATE stock_items
		SET assigned_user_id = NULL, status = 'retired', updated_at = NOW()
		WHERE id = $1::uuid
	`, c.Param("id"))
	if err != nil {
		httpx.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	if rows, _ := result.RowsAffected(); rows == 0 {
		httpx.Error(c, http.StatusNotFound, "stock item not found")
		return
	}
	middleware.TagAudit(c, middleware.AuditMeta{Action: "stock_item_retired", TargetType: "stock_item", TargetID: c.Param("id")})
	httpx.JSON(c, http.StatusOK, gin.H{"status": "retired"})
}

func (server *apiServer) listMyRequests(c *gin.Context) {
	claims := middleware.CurrentClaims(c)
	if claims == nil {
		httpx.Error(c, http.StatusUnauthorized, "unauthorized")
		return
	}
	page, pageSize, paginate := parsePaginationRequest(c, 10)
	items, err := server.loadRequests(` WHERE r.requester_id = $1::uuid`, claims.UserID)
	if err != nil {
		httpx.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	if paginate {
		start, end := paginationBounds(len(items), page, pageSize)
		httpx.JSON(c, http.StatusOK, gin.H{"items": items[start:end], "total": len(items), "page": page, "pageSize": pageSize})
		return
	}
	httpx.JSON(c, http.StatusOK, items)
}

func (server *apiServer) createMyRequest(c *gin.Context) {
	claims := middleware.CurrentClaims(c)
	if claims == nil {
		httpx.Error(c, http.StatusUnauthorized, "unauthorized")
		return
	}
	var input struct {
		Type        string `json:"type"`
		Title       string `json:"title"`
		Description string `json:"description"`
	}
	if err := c.ShouldBindJSON(&input); err != nil || strings.TrimSpace(input.Type) == "" || strings.TrimSpace(input.Title) == "" {
		httpx.Error(c, http.StatusBadRequest, "type and title are required")
		return
	}
	assigneeID, err := server.resolveRequestRouting(strings.TrimSpace(input.Type), strings.TrimSpace(input.Title), strings.TrimSpace(input.Description))
	if err != nil {
		httpx.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	var id string
	if err := server.db.QueryRow(`
		INSERT INTO requests (requester_id, assignee_id, type, title, description, status)
		VALUES ($1::uuid, NULLIF($2, '')::uuid, $3, $4, NULLIF($5, ''), 'pending')
		RETURNING id
	`, claims.UserID, assigneeID, strings.TrimSpace(input.Type), strings.TrimSpace(input.Title), strings.TrimSpace(input.Description)).Scan(&id); err != nil {
		httpx.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	auditDetail := gin.H{
		"type":        strings.TrimSpace(input.Type),
		"title":       strings.TrimSpace(input.Title),
		"description": strings.TrimSpace(input.Description),
		"assigneeId":  assigneeID,
	}
	middleware.TagAudit(c, middleware.AuditMeta{Action: "request_created", TargetType: "request", TargetID: id, Detail: auditDetail})
	httpx.Created(c, gin.H{"id": id, "status": "pending", "assigneeId": assigneeID})
}

func (server *apiServer) getMyRequest(c *gin.Context) {
	claims := middleware.CurrentClaims(c)
	if claims == nil {
		httpx.Error(c, http.StatusUnauthorized, "unauthorized")
		return
	}
	items, err := server.loadRequests(` WHERE r.id = $1::uuid AND r.requester_id = $2::uuid`, c.Param("id"), claims.UserID)
	if err != nil {
		httpx.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	if len(items) == 0 {
		httpx.Error(c, http.StatusNotFound, "request not found")
		return
	}
	httpx.JSON(c, http.StatusOK, items[0])
}

func (server *apiServer) commentMyRequest(c *gin.Context) {
	claims := middleware.CurrentClaims(c)
	if claims == nil {
		httpx.Error(c, http.StatusUnauthorized, "unauthorized")
		return
	}
	var input struct {
		Note string `json:"note"`
	}
	if err := c.ShouldBindJSON(&input); err != nil || strings.TrimSpace(input.Note) == "" {
		httpx.Error(c, http.StatusBadRequest, "note is required")
		return
	}
	var exists bool
	if err := server.db.QueryRow(`SELECT EXISTS(SELECT 1 FROM requests WHERE id = $1::uuid AND requester_id = $2::uuid)`, c.Param("id"), claims.UserID).Scan(&exists); err != nil {
		httpx.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	if !exists {
		httpx.Error(c, http.StatusNotFound, "request not found")
		return
	}
	if _, err := server.db.Exec(`
		INSERT INTO request_comments (request_id, author_id, note)
		VALUES ($1::uuid, $2::uuid, $3)
	`, c.Param("id"), claims.UserID, strings.TrimSpace(input.Note)); err != nil {
		httpx.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	middleware.TagAudit(c, middleware.AuditMeta{Action: "request_commented", TargetType: "request", TargetID: c.Param("id"), Detail: input})
	httpx.Created(c, gin.H{"status": "commented"})
}

func (server *apiServer) listRequests(c *gin.Context) {
	if !server.requireRoles(c, "super_admin", "it_team") {
		return
	}
	page, pageSize, paginate := parsePaginationRequest(c, 12)
	searchQuery := strings.ToLower(strings.TrimSpace(c.Query("search")))
	statusFilter := strings.TrimSpace(c.Query("status"))
	typeFilter := strings.TrimSpace(c.Query("type"))
	lookupValues := make([]string, 0)
	for _, lookupValue := range c.QueryArray("lookup") {
		lookupValue = strings.ToLower(strings.TrimSpace(lookupValue))
		if lookupValue != "" {
			lookupValues = append(lookupValues, lookupValue)
		}
	}
	whereClauses := []string{"1 = 1"}
	args := make([]any, 0, 8)
	argIndex := 1
	if statusFilter != "" && statusFilter != "all" {
		whereClauses = append(whereClauses, fmt.Sprintf("r.status = $%d", argIndex))
		args = append(args, statusFilter)
		argIndex++
	} else {
		whereClauses = append(whereClauses, "r.status <> 'rejected'")
	}
	if typeFilter == "device_enrollment" {
		whereClauses = append(whereClauses, fmt.Sprintf("r.type = $%d", argIndex))
		args = append(args, "device_enrollment")
		argIndex++
	} else if typeFilter == "other" {
		whereClauses = append(whereClauses, fmt.Sprintf("r.type <> $%d", argIndex))
		args = append(args, "device_enrollment")
		argIndex++
	}
	if len(lookupValues) > 0 {
		lookupClauses := make([]string, 0, len(lookupValues))
		for _, lookupValue := range lookupValues {
			lookupClauses = append(lookupClauses, fmt.Sprintf("lower(COALESCE(r.description, '')) LIKE $%d", argIndex))
			args = append(args, "%asset tag / host: "+lookupValue+"%")
			argIndex++
		}
		whereClauses = append(whereClauses, "("+strings.Join(lookupClauses, " OR ")+")")
	}
	if searchQuery != "" {
		whereClauses = append(whereClauses, fmt.Sprintf("lower(concat_ws(' ', r.title, r.type, COALESCE(r.description, ''), requester.full_name, COALESCE(assignee.full_name, ''), r.id::text)) LIKE $%d", argIndex))
		args = append(args, "%"+searchQuery+"%")
		argIndex++
	}
	whereSQL := strings.Join(whereClauses, " AND ")
	baseFrom := `
		FROM requests r
		JOIN users requester ON requester.id = r.requester_id
		LEFT JOIN users assignee ON assignee.id = r.assignee_id
	`

	var total, pendingCount, inProgressCount, resolvedCount, enrollmentCount, pendingEnrollmentCount int
	err := server.db.QueryRow(`
		SELECT
			COUNT(*),
			COUNT(*) FILTER (WHERE r.status = 'pending'),
			COUNT(*) FILTER (WHERE r.status = 'in_progress'),
			COUNT(*) FILTER (WHERE r.status = 'resolved'),
			COUNT(*) FILTER (WHERE r.type = 'device_enrollment'),
			COUNT(*) FILTER (WHERE r.type = 'device_enrollment' AND r.status = 'pending')
		`+baseFrom+`
		WHERE `+whereSQL, args...).Scan(&total, &pendingCount, &inProgressCount, &resolvedCount, &enrollmentCount, &pendingEnrollmentCount)
	if err != nil {
		httpx.Error(c, http.StatusInternalServerError, err.Error())
		return
	}

	queryArgs := append([]any{}, args...)
	query := `
		SELECT r.id, r.type, r.title, COALESCE(r.description, ''), r.status, COALESCE(r.notes, ''), r.created_at, r.updated_at,
			requester.id, requester.full_name, COALESCE(assignee.id::text, ''), COALESCE(assignee.full_name, '')
		` + baseFrom + `
		WHERE ` + whereSQL + `
		ORDER BY r.updated_at DESC, r.created_at DESC`
	if paginate {
		query += fmt.Sprintf(" LIMIT $%d OFFSET $%d", argIndex, argIndex+1)
		queryArgs = append(queryArgs, pageSize, (page-1)*pageSize)
	}
	rows, err := server.db.Query(query, queryArgs...)
	if err != nil {
		httpx.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()

	type requestRow struct {
		id            string
		kind          string
		title         string
		description   string
		status        string
		notes         string
		createdAt     time.Time
		updatedAt     time.Time
		requesterID   string
		requesterName string
		assigneeID    string
		assigneeName  string
	}
	requestRows := make([]requestRow, 0)
	requestIDs := make([]string, 0)
	for rows.Next() {
		var item requestRow
		if err := rows.Scan(&item.id, &item.kind, &item.title, &item.description, &item.status, &item.notes, &item.createdAt, &item.updatedAt, &item.requesterID, &item.requesterName, &item.assigneeID, &item.assigneeName); err != nil {
			httpx.Error(c, http.StatusInternalServerError, err.Error())
			return
		}
		requestRows = append(requestRows, item)
		requestIDs = append(requestIDs, item.id)
	}
	if err := rows.Err(); err != nil {
		httpx.Error(c, http.StatusInternalServerError, err.Error())
		return
	}

	commentLookup := map[string][]gin.H{}
	if len(requestIDs) > 0 {
		commentArgs := make([]any, 0, len(requestIDs))
		placeholders := make([]string, 0, len(requestIDs))
		for index, requestID := range requestIDs {
			placeholders = append(placeholders, fmt.Sprintf("$%d::uuid", index+1))
			commentArgs = append(commentArgs, requestID)
		}
		commentRows, err := server.db.Query(`
			SELECT c.request_id::text, c.id, u.full_name, c.note, c.created_at
			FROM request_comments c
			JOIN users u ON u.id = c.author_id
			WHERE c.request_id IN (`+strings.Join(placeholders, ", ")+`)
			ORDER BY c.request_id ASC, c.created_at ASC
		`, commentArgs...)
		if err != nil {
			httpx.Error(c, http.StatusInternalServerError, err.Error())
			return
		}
		defer commentRows.Close()
		for commentRows.Next() {
			var requestID, commentID, author, note string
			var commentCreatedAt time.Time
			if err := commentRows.Scan(&requestID, &commentID, &author, &note, &commentCreatedAt); err != nil {
				httpx.Error(c, http.StatusInternalServerError, err.Error())
				return
			}
			commentLookup[requestID] = append(commentLookup[requestID], gin.H{"id": commentID, "author": author, "note": note, "createdAt": commentCreatedAt})
		}
		if err := commentRows.Err(); err != nil {
			httpx.Error(c, http.StatusInternalServerError, err.Error())
			return
		}
	}

	filtered := make([]gin.H, 0, len(requestRows))
	for _, item := range requestRows {
		comments := commentLookup[item.id]
		if comments == nil {
			comments = []gin.H{}
		}
		filtered = append(filtered, gin.H{
			"id":          item.id,
			"type":        item.kind,
			"title":       item.title,
			"description": item.description,
			"status":      item.status,
			"notes":       item.notes,
			"createdAt":   item.createdAt,
			"updatedAt":   item.updatedAt,
			"requester":   gin.H{"id": item.requesterID, "fullName": item.requesterName},
			"assignee":    gin.H{"id": emptyToNullString(item.assigneeID), "fullName": item.assigneeName},
			"comments":    comments,
		})
	}

	if !paginate {
		httpx.JSON(c, http.StatusOK, filtered)
		return
	}
	httpx.JSON(c, http.StatusOK, gin.H{
		"items":    filtered,
		"total":    total,
		"page":     page,
		"pageSize": pageSize,
		"summary": gin.H{
			"pending":           pendingCount,
			"inProgress":        inProgressCount,
			"resolved":          resolvedCount,
			"enrollment":        enrollmentCount,
			"pendingEnrollment": pendingEnrollmentCount,
		},
	})
}

func (server *apiServer) updateRequestStatus(c *gin.Context) {
	if !server.requireRoles(c, "super_admin", "it_team") {
		return
	}
	claims := middleware.CurrentClaims(c)
	var input struct {
		Status string `json:"status"`
		Notes  string `json:"notes"`
	}
	if err := c.ShouldBindJSON(&input); err != nil || strings.TrimSpace(input.Status) == "" {
		httpx.Error(c, http.StatusBadRequest, "status is required")
		return
	}
	requestID := c.Param("id")
	status := strings.TrimSpace(input.Status)
	notes := strings.TrimSpace(input.Notes)
	var requestType string
	if err := server.db.QueryRow(`SELECT type FROM requests WHERE id = $1::uuid`, requestID).Scan(&requestType); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			httpx.Error(c, http.StatusNotFound, "request not found")
			return
		}
		httpx.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	result, err := server.db.Exec(`
		UPDATE requests
		SET status = $2, notes = NULLIF($3, ''), updated_at = NOW()
		WHERE id = $1::uuid
	`, requestID, status, notes)
	if err != nil {
		httpx.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	if rows, _ := result.RowsAffected(); rows == 0 {
		httpx.Error(c, http.StatusNotFound, "request not found")
		return
	}
	if requestType == "device_enrollment" && claims != nil {
		actorName := strings.TrimSpace(claims.Name)
		if actorName == "" {
			actorName = strings.TrimSpace(claims.Email)
		}
		commentNote := ""
		switch status {
		case "in_progress":
			commentNote = "Enrollment review started by " + actorName + "."
		case "resolved":
			commentNote = "Enrollment approved by " + actorName + "."
		case "rejected":
			commentNote = "Enrollment rejected by " + actorName + "."
		}
		if commentNote != "" {
			if notes != "" {
				commentNote += " Notes: " + notes
			}
			_, _ = server.db.Exec(`
				INSERT INTO request_comments (request_id, author_id, note)
				VALUES ($1::uuid, $2::uuid, $3)
			`, requestID, claims.UserID, commentNote)
		}
	}
	middleware.TagAudit(c, middleware.AuditMeta{Action: "request_status_changed", TargetType: "request", TargetID: c.Param("id"), Detail: input})
	httpx.JSON(c, http.StatusOK, gin.H{"status": "updated"})
}

func (server *apiServer) assignRequest(c *gin.Context) {
	if !server.requireRoles(c, "super_admin", "it_team") {
		return
	}
	var input struct {
		AssigneeID string `json:"assigneeId"`
	}
	if err := c.ShouldBindJSON(&input); err != nil || strings.TrimSpace(input.AssigneeID) == "" {
		httpx.Error(c, http.StatusBadRequest, "assigneeId is required")
		return
	}
	if err := server.validateTicketAssignee(strings.TrimSpace(input.AssigneeID)); err != nil {
		httpx.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	result, err := server.db.Exec(`
		UPDATE requests SET assignee_id = $2::uuid, updated_at = NOW() WHERE id = $1::uuid
	`, c.Param("id"), strings.TrimSpace(input.AssigneeID))
	if err != nil {
		httpx.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	if rows, _ := result.RowsAffected(); rows == 0 {
		httpx.Error(c, http.StatusNotFound, "request not found")
		return
	}
	middleware.TagAudit(c, middleware.AuditMeta{Action: "request_assigned", TargetType: "request", TargetID: c.Param("id"), Detail: input})
	httpx.JSON(c, http.StatusOK, gin.H{"status": "assigned"})
}

func (server *apiServer) loadRequests(clause string, args ...any) ([]gin.H, error) {
	query := `
		SELECT r.id, r.type, r.title, COALESCE(r.description, ''), r.status, COALESCE(r.notes, ''), r.created_at, r.updated_at,
			requester.id, requester.full_name, COALESCE(assignee.id::text, ''), COALESCE(assignee.full_name, '')
		FROM requests r
		JOIN users requester ON requester.id = r.requester_id
		LEFT JOIN users assignee ON assignee.id = r.assignee_id
	` + clause + ` ORDER BY r.updated_at DESC, r.created_at DESC`

	rows, err := server.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]gin.H, 0)
	for rows.Next() {
		var id, kind, title, description, status, notes, requesterID, requesterName, assigneeID, assigneeName string
		var createdAt, updatedAt time.Time
		if err := rows.Scan(&id, &kind, &title, &description, &status, &notes, &createdAt, &updatedAt, &requesterID, &requesterName, &assigneeID, &assigneeName); err != nil {
			return nil, err
		}
		commentRows, err := server.db.Query(`
			SELECT c.id, u.full_name, c.note, c.created_at
			FROM request_comments c
			JOIN users u ON u.id = c.author_id
			WHERE c.request_id = $1::uuid
			ORDER BY c.created_at ASC
		`, id)
		if err != nil {
			return nil, err
		}
		comments := make([]gin.H, 0)
		for commentRows.Next() {
			var commentID, author, note string
			var commentCreatedAt time.Time
			if err := commentRows.Scan(&commentID, &author, &note, &commentCreatedAt); err != nil {
				commentRows.Close()
				return nil, err
			}
			comments = append(comments, gin.H{"id": commentID, "author": author, "note": note, "createdAt": commentCreatedAt})
		}
		commentRows.Close()
		items = append(items, gin.H{
			"id":          id,
			"type":        kind,
			"title":       title,
			"description": description,
			"status":      status,
			"notes":       notes,
			"createdAt":   createdAt,
			"updatedAt":   updatedAt,
			"requester":   gin.H{"id": requesterID, "fullName": requesterName},
			"assignee":    gin.H{"id": emptyToNullString(assigneeID), "fullName": assigneeName},
			"comments":    comments,
		})
	}
	return items, nil
}

func (server *apiServer) listChatChannels(c *gin.Context) {
	claims := middleware.CurrentClaims(c)
	if claims == nil {
		httpx.Error(c, http.StatusUnauthorized, "unauthorized")
		return
	}
	page, pageSize, paginate := parsePaginationRequest(c, 100)
	searchQuery := strings.ToLower(strings.TrimSpace(c.Query("search")))
	kindFilter := strings.ToLower(strings.TrimSpace(c.Query("kind")))
	if err := server.ensureChatChannelsForUser(claims); err != nil {
		httpx.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	whereClauses := []string{"m.user_id = $1::uuid", "(c.status <> 'closed' OR c.closed_at IS NULL OR c.closed_at >= NOW() - INTERVAL '7 days')"}
	args := []any{claims.UserID}
	argIndex := 2
	if kindFilter != "" && kindFilter != "all" {
		whereClauses = append(whereClauses, fmt.Sprintf("c.kind = $%d", argIndex))
		args = append(args, kindFilter)
		argIndex++
	}
	if searchQuery != "" {
		whereClauses = append(whereClauses, fmt.Sprintf(`(
			lower(c.name) LIKE $%d
			OR EXISTS (
				SELECT 1
				FROM chat_members cm_search
				JOIN users u_search ON u_search.id = cm_search.user_id
				WHERE cm_search.channel_id = c.id AND lower(u_search.full_name) LIKE $%d
			)
			OR EXISTS (
				SELECT 1
				FROM chat_messages msg_search
				WHERE msg_search.channel_id = c.id AND lower(msg_search.body) LIKE $%d
			)
		)`, argIndex, argIndex, argIndex))
		args = append(args, "%"+searchQuery+"%")
		argIndex++
	}
	whereSQL := strings.Join(whereClauses, " AND ")

	var total int
	if err := server.db.QueryRow(`
		SELECT COUNT(DISTINCT c.id)
		FROM chat_channels c
		JOIN chat_members m ON m.channel_id = c.id
		WHERE `+whereSQL, args...).Scan(&total); err != nil {
		httpx.Error(c, http.StatusInternalServerError, err.Error())
		return
	}

	queryArgs := append([]any{}, args...)
	query := `
		SELECT c.id, c.name, c.kind, c.created_at, c.created_by, COALESCE(creator.full_name, ''), c.primary_owner_id, COALESCE(owner.full_name, ''),
			c.backup_owner_id, COALESCE(backup_owner.full_name, ''), c.status, c.closed_at, c.linked_request_id, COALESCE(r.ticket_number, ''), COALESCE(r.status, '')
		FROM chat_channels c
		JOIN chat_members m ON m.channel_id = c.id
		LEFT JOIN users creator ON creator.id = c.created_by
		LEFT JOIN users owner ON owner.id = c.primary_owner_id
		LEFT JOIN users backup_owner ON backup_owner.id = c.backup_owner_id
		LEFT JOIN requests r ON r.id = c.linked_request_id
		WHERE ` + whereSQL + `
		ORDER BY COALESCE((SELECT MAX(created_at) FROM chat_messages WHERE channel_id = c.id), c.created_at) DESC, c.created_at DESC
	`
	if paginate {
		query += fmt.Sprintf(" LIMIT $%d OFFSET $%d", argIndex, argIndex+1)
		queryArgs = append(queryArgs, pageSize, (page-1)*pageSize)
	}
	rows, err := server.db.Query(query, queryArgs...)
	if err != nil {
		httpx.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()

	channels := make([]gin.H, 0)
	for rows.Next() {
		var id, name, kind string
		var createdAt time.Time
		var createdByID, createdByName sql.NullString
		var primaryOwnerID, primaryOwnerName sql.NullString
		var backupOwnerID, backupOwnerName sql.NullString
		var status string
		var closedAt sql.NullTime
		var linkedRequestID, linkedTicketNumber, linkedRequestStatus sql.NullString
		if err := rows.Scan(&id, &name, &kind, &createdAt, &createdByID, &createdByName, &primaryOwnerID, &primaryOwnerName, &backupOwnerID, &backupOwnerName, &status, &closedAt, &linkedRequestID, &linkedTicketNumber, &linkedRequestStatus); err != nil {
			httpx.Error(c, http.StatusInternalServerError, err.Error())
			return
		}
		memberRows, err := server.db.Query(`
			SELECT u.id, u.full_name, r.name
			FROM chat_members cm
			JOIN users u ON u.id = cm.user_id
			JOIN roles r ON r.id = u.role_id
			WHERE cm.channel_id = $1::uuid
			ORDER BY u.full_name ASC
		`, id)
		if err != nil {
			httpx.Error(c, http.StatusInternalServerError, err.Error())
			return
		}
		members := make([]gin.H, 0)
		for memberRows.Next() {
			var memberID, fullName, role string
			if err := memberRows.Scan(&memberID, &fullName, &role); err != nil {
				memberRows.Close()
				httpx.Error(c, http.StatusInternalServerError, err.Error())
				return
			}
			members = append(members, gin.H{"id": memberID, "fullName": fullName, "role": role})
		}
		memberRows.Close()
		var messageCount int
		if err := server.db.QueryRow(`SELECT COUNT(*) FROM chat_messages WHERE channel_id = $1::uuid`, id).Scan(&messageCount); err != nil {
			httpx.Error(c, http.StatusInternalServerError, err.Error())
			return
		}
		channel := gin.H{
			"id":           id,
			"name":         name,
			"kind":         kind,
			"members":      members,
			"createdAt":    createdAt.UTC().Format(time.RFC3339Nano),
			"status":       status,
			"messageCount": messageCount,
		}
		if closedAt.Valid {
			channel["closedAt"] = closedAt.Time.UTC().Format(time.RFC3339Nano)
		}
		if createdByID.Valid {
			channel["createdBy"] = gin.H{"id": createdByID.String, "fullName": strings.TrimSpace(createdByName.String)}
		}
		if primaryOwnerID.Valid {
			channel["primaryOwner"] = gin.H{"id": primaryOwnerID.String, "fullName": strings.TrimSpace(primaryOwnerName.String)}
		}
		if backupOwnerID.Valid {
			channel["backupOwner"] = gin.H{"id": backupOwnerID.String, "fullName": strings.TrimSpace(backupOwnerName.String)}
		}
		if linkedRequestID.Valid {
			channel["linkedRequest"] = gin.H{"id": linkedRequestID.String, "ticketNumber": strings.TrimSpace(linkedTicketNumber.String), "status": strings.TrimSpace(linkedRequestStatus.String)}
		}
		var latestBody, latestAuthorName sql.NullString
		var latestCreatedAt time.Time
		err = server.db.QueryRow(`
			SELECT cm.body, cm.created_at, COALESCE(u.full_name, '')
			FROM chat_messages cm
			LEFT JOIN users u ON u.id = cm.author_id
			WHERE cm.channel_id = $1::uuid
			ORDER BY cm.created_at DESC
			LIMIT 1
		`, id).Scan(&latestBody, &latestCreatedAt, &latestAuthorName)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			httpx.Error(c, http.StatusInternalServerError, err.Error())
			return
		}
		if err == nil {
			channel["latestMessage"] = gin.H{
				"body":       latestBody.String,
				"createdAt":  latestCreatedAt.UTC().Format(time.RFC3339Nano),
				"authorName": strings.TrimSpace(latestAuthorName.String),
			}
		}
		channels = append(channels, channel)
	}
	if !paginate {
		httpx.JSON(c, http.StatusOK, channels)
		return
	}
	httpx.JSON(c, http.StatusOK, gin.H{
		"items":    channels,
		"total":    total,
		"page":     page,
		"pageSize": pageSize,
	})
}

func (server *apiServer) createChatChannel(c *gin.Context) {
	claims := middleware.CurrentClaims(c)
	if claims == nil {
		httpx.Error(c, http.StatusUnauthorized, "unauthorized")
		return
	}
	if claims.Role != "super_admin" && claims.Role != "it_team" && claims.Role != "employee" {
		httpx.Error(c, http.StatusForbidden, "forbidden")
		return
	}
	var input struct {
		Name           string   `json:"name"`
		Kind           string   `json:"kind"`
		MemberIDs      []string `json:"memberIds"`
		InitialMessage string   `json:"initialMessage"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		httpx.Error(c, http.StatusBadRequest, "invalid chat channel payload")
		return
	}
	input.Name = strings.TrimSpace(input.Name)
	input.Kind = strings.TrimSpace(input.Kind)
	input.InitialMessage = strings.TrimSpace(input.InitialMessage)
	if input.Name == "" {
		input.Name = "IT Channel"
	}
	if claims.Role == "employee" {
		enabled, err := server.chatAutoCreateEnabled()
		if err != nil {
			httpx.Error(c, http.StatusInternalServerError, err.Error())
			return
		}
		if !enabled {
			httpx.Error(c, http.StatusForbidden, "chat creation is disabled")
			return
		}
		if input.Kind == "" {
			input.Kind = "support"
		}
		input.MemberIDs = nil
	} else if input.Kind == "" {
		httpx.Error(c, http.StatusBadRequest, "invalid chat channel payload")
		return
	}
	routedMemberID, err := server.resolveChatRouting(strings.TrimSpace(input.Name))
	if err != nil {
		httpx.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	if routedMemberID != "" {
		if err := server.validateChatMemberAssignee(routedMemberID); err != nil {
			httpx.Error(c, http.StatusBadRequest, err.Error())
			return
		}
	}
	primaryOwnerID := strings.TrimSpace(routedMemberID)
	if primaryOwnerID == "" && (claims.Role == "it_team" || claims.Role == "super_admin") {
		primaryOwnerID = claims.UserID
	}

	tx, err := server.db.Begin()
	if err != nil {
		httpx.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	defer tx.Rollback()

	var channelID string
	if err := tx.QueryRow(`
		INSERT INTO chat_channels (name, kind, created_by, primary_owner_id)
		VALUES ($1, $2, $3::uuid, NULLIF($4, '')::uuid)
		RETURNING id
	`, strings.TrimSpace(input.Name), strings.TrimSpace(input.Kind), claims.UserID, primaryOwnerID).Scan(&channelID); err != nil {
		httpx.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	memberIDs := append([]string{claims.UserID}, input.MemberIDs...)
	if routedMemberID != "" {
		memberIDs = append(memberIDs, routedMemberID)
	}
	seen := map[string]struct{}{}
	for _, memberID := range memberIDs {
		memberID = strings.TrimSpace(memberID)
		if memberID == "" {
			continue
		}
		if memberID != claims.UserID {
			if err := server.validateChatMemberAssignee(memberID); err != nil {
				httpx.Error(c, http.StatusBadRequest, err.Error())
				return
			}
		}
		if _, ok := seen[memberID]; ok {
			continue
		}
		seen[memberID] = struct{}{}
		if _, err := tx.Exec(`INSERT INTO chat_members (channel_id, user_id) VALUES ($1::uuid, $2::uuid) ON CONFLICT DO NOTHING`, channelID, memberID); err != nil {
			httpx.Error(c, http.StatusBadRequest, err.Error())
			return
		}
	}
	if input.InitialMessage != "" {
		if _, err := tx.Exec(`
			INSERT INTO chat_messages (channel_id, author_id, body)
			VALUES ($1::uuid, $2::uuid, $3)
		`, channelID, claims.UserID, input.InitialMessage); err != nil {
			httpx.Error(c, http.StatusBadRequest, err.Error())
			return
		}
	}
	if err := tx.Commit(); err != nil {
		httpx.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	auditDetail := gin.H{
		"name":           strings.TrimSpace(input.Name),
		"kind":           strings.TrimSpace(input.Kind),
		"memberIds":      input.MemberIDs,
		"initialMessage": input.InitialMessage,
		"routedMemberId": routedMemberID,
		"primaryOwnerId": emptyToNullString(primaryOwnerID),
	}
	middleware.TagAudit(c, middleware.AuditMeta{Action: "chat_channel_created", TargetType: "chat_channel", TargetID: channelID, Detail: auditDetail})
	httpx.Created(c, gin.H{"id": channelID, "routedMemberId": routedMemberID, "primaryOwnerId": emptyToNullString(primaryOwnerID)})
}

func (server *apiServer) addChatChannelMembers(c *gin.Context) {
	if !server.requireRoles(c, "super_admin", "it_team") {
		return
	}
	claims := middleware.CurrentClaims(c)
	if claims == nil {
		httpx.Error(c, http.StatusUnauthorized, "unauthorized")
		return
	}
	channelID := strings.TrimSpace(c.Param("id"))
	var input struct {
		MemberIDs []string `json:"memberIds"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		httpx.Error(c, http.StatusBadRequest, "invalid chat channel payload")
		return
	}
	var exists bool
	if err := server.db.QueryRow(`SELECT EXISTS(SELECT 1 FROM chat_channels WHERE id = $1::uuid)`, channelID).Scan(&exists); err != nil {
		httpx.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	if !exists {
		httpx.Error(c, http.StatusNotFound, "chat channel not found")
		return
	}
	if claims.Role == "it_team" {
		allowed, err := server.userIsChatMember(c.Request.Context(), channelID, claims.UserID)
		if err != nil {
			httpx.Error(c, http.StatusInternalServerError, err.Error())
			return
		}
		if !allowed {
			httpx.Error(c, http.StatusForbidden, "only chat members or super admin can add teammates")
			return
		}
	}
	var channelStatus string
	if err := server.db.QueryRow(`SELECT status FROM chat_channels WHERE id = $1::uuid`, channelID).Scan(&channelStatus); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			httpx.Error(c, http.StatusNotFound, "chat channel not found")
			return
		}
		httpx.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	if channelStatus == "closed" {
		httpx.Error(c, http.StatusBadRequest, "reopen chat before adding teammates")
		return
	}
	memberIDs := make([]string, 0, len(input.MemberIDs))
	seen := map[string]struct{}{}
	for _, memberID := range input.MemberIDs {
		memberID = strings.TrimSpace(memberID)
		if memberID == "" {
			continue
		}
		if err := server.validateChatMemberAssignee(memberID); err != nil {
			httpx.Error(c, http.StatusBadRequest, err.Error())
			return
		}
		if _, ok := seen[memberID]; ok {
			continue
		}
		seen[memberID] = struct{}{}
		memberIDs = append(memberIDs, memberID)
	}
	if len(memberIDs) == 0 {
		httpx.Error(c, http.StatusBadRequest, "select at least one teammate")
		return
	}
	added := 0
	for _, memberID := range memberIDs {
		result, err := server.db.Exec(`INSERT INTO chat_members (channel_id, user_id) VALUES ($1::uuid, $2::uuid) ON CONFLICT DO NOTHING`, channelID, memberID)
		if err != nil {
			httpx.Error(c, http.StatusBadRequest, err.Error())
			return
		}
		rowsAffected, err := result.RowsAffected()
		if err == nil {
			added += int(rowsAffected)
		}
	}
	middleware.TagAudit(c, middleware.AuditMeta{Action: "chat_channel_members_added", TargetType: "chat_channel", TargetID: channelID, Detail: gin.H{"memberIds": memberIDs, "added": added}})
	httpx.JSON(c, http.StatusOK, gin.H{"added": added})
}

func (server *apiServer) removeChatChannelMember(c *gin.Context) {
	if !server.requireRoles(c, "super_admin", "it_team") {
		return
	}
	claims := middleware.CurrentClaims(c)
	if claims == nil {
		httpx.Error(c, http.StatusUnauthorized, "unauthorized")
		return
	}
	channelID := strings.TrimSpace(c.Param("id"))
	userID := strings.TrimSpace(c.Param("userId"))
	if channelID == "" || userID == "" {
		httpx.Error(c, http.StatusBadRequest, "invalid chat member target")
		return
	}
	if claims.Role == "it_team" {
		allowed, err := server.userIsChatMember(c.Request.Context(), channelID, claims.UserID)
		if err != nil {
			httpx.Error(c, http.StatusInternalServerError, err.Error())
			return
		}
		if !allowed {
			httpx.Error(c, http.StatusForbidden, "only chat members or super admin can remove teammates")
			return
		}
	}
	var targetRole string
	err := server.db.QueryRow(`
		SELECT r.name
		FROM chat_members cm
		JOIN users u ON u.id = cm.user_id
		JOIN roles r ON r.id = u.role_id
		WHERE cm.channel_id = $1::uuid AND cm.user_id = $2::uuid
	`, channelID, userID).Scan(&targetRole)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			httpx.Error(c, http.StatusNotFound, "chat member not found")
			return
		}
		httpx.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	if targetRole != "it_team" && targetRole != "super_admin" {
		httpx.Error(c, http.StatusBadRequest, "only IT owners can be removed from chat routing")
		return
	}
	var privilegedCount int
	if err := server.db.QueryRow(`
		SELECT COUNT(*)
		FROM chat_members cm
		JOIN users u ON u.id = cm.user_id
		JOIN roles r ON r.id = u.role_id
		WHERE cm.channel_id = $1::uuid AND r.name IN ('super_admin', 'it_team')
	`, channelID).Scan(&privilegedCount); err != nil {
		httpx.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	if privilegedCount <= 1 {
		httpx.Error(c, http.StatusBadRequest, "add another IT owner before removing the last one")
		return
	}
	if _, err := server.db.Exec(`UPDATE chat_channels SET primary_owner_id = NULL WHERE id = $1::uuid AND primary_owner_id = $2::uuid`, channelID, userID); err != nil {
		httpx.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	if _, err := server.db.Exec(`UPDATE chat_channels SET backup_owner_id = NULL WHERE id = $1::uuid AND backup_owner_id = $2::uuid`, channelID, userID); err != nil {
		httpx.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	result, err := server.db.Exec(`DELETE FROM chat_members WHERE channel_id = $1::uuid AND user_id = $2::uuid`, channelID, userID)
	if err != nil {
		httpx.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	rowsAffected, err := result.RowsAffected()
	if err != nil {
		httpx.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	if rowsAffected == 0 {
		httpx.Error(c, http.StatusNotFound, "chat member not found")
		return
	}
	middleware.TagAudit(c, middleware.AuditMeta{Action: "chat_channel_member_removed", TargetType: "chat_channel", TargetID: channelID, Detail: gin.H{"userId": userID}})
	httpx.JSON(c, http.StatusOK, gin.H{"removed": rowsAffected})
}

func (server *apiServer) updateChatChannelOwner(c *gin.Context) {
	if !server.requireRoles(c, "super_admin", "it_team") {
		return
	}
	claims := middleware.CurrentClaims(c)
	if claims == nil {
		httpx.Error(c, http.StatusUnauthorized, "unauthorized")
		return
	}
	channelID := strings.TrimSpace(c.Param("id"))
	var input struct {
		OwnerID       *string `json:"ownerId"`
		BackupOwnerID *string `json:"backupOwnerId"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		httpx.Error(c, http.StatusBadRequest, "invalid chat owner payload")
		return
	}
	if input.OwnerID == nil && input.BackupOwnerID == nil {
		httpx.Error(c, http.StatusBadRequest, "select a primary or backup owner")
		return
	}
	ownerID := ""
	if input.OwnerID != nil {
		ownerID = strings.TrimSpace(*input.OwnerID)
		if ownerID == "" {
			httpx.Error(c, http.StatusBadRequest, "select a primary owner")
			return
		}
	}
	backupOwnerID := ""
	if input.BackupOwnerID != nil {
		backupOwnerID = strings.TrimSpace(*input.BackupOwnerID)
	}
	if claims.Role == "it_team" {
		allowed, err := server.userIsChatMember(c.Request.Context(), channelID, claims.UserID)
		if err != nil {
			httpx.Error(c, http.StatusInternalServerError, err.Error())
			return
		}
		if !allowed {
			httpx.Error(c, http.StatusForbidden, "only chat members or super admin can transfer ownership")
			return
		}
	}
	var channelStatus string
	if err := server.db.QueryRow(`SELECT status FROM chat_channels WHERE id = $1::uuid`, channelID).Scan(&channelStatus); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			httpx.Error(c, http.StatusNotFound, "chat channel not found")
			return
		}
		httpx.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	if channelStatus == "closed" {
		httpx.Error(c, http.StatusBadRequest, "reopen chat before changing the primary owner")
		return
	}
	validateOwnerMember := func(candidateID string, label string) error {
		if strings.TrimSpace(candidateID) == "" {
			return nil
		}
		if err := server.validateChatMemberAssignee(candidateID); err != nil {
			return err
		}
		var ownerRole string
		err := server.db.QueryRow(`
			SELECT r.name
			FROM chat_members cm
			JOIN users u ON u.id = cm.user_id
			JOIN roles r ON r.id = u.role_id
			WHERE cm.channel_id = $1::uuid AND cm.user_id = $2::uuid
		`, channelID, candidateID).Scan(&ownerRole)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return fmt.Errorf("%s must already be a chat member", label)
			}
			return err
		}
		if ownerRole != "it_team" && ownerRole != "super_admin" {
			return fmt.Errorf("%s must be an IT owner", label)
		}
		return nil
	}
	if ownerID != "" {
		if err := validateOwnerMember(ownerID, "primary owner"); err != nil {
			httpx.Error(c, http.StatusBadRequest, err.Error())
			return
		}
	}
	if backupOwnerID != "" {
		if err := validateOwnerMember(backupOwnerID, "backup owner"); err != nil {
			httpx.Error(c, http.StatusBadRequest, err.Error())
			return
		}
	}
	if ownerID != "" && backupOwnerID != "" && ownerID == backupOwnerID {
		httpx.Error(c, http.StatusBadRequest, "backup owner must be different from the primary owner")
		return
	}
	assignments := make([]string, 0, 2)
	args := []any{channelID}
	if input.OwnerID != nil {
		assignments = append(assignments, fmt.Sprintf("primary_owner_id = NULLIF($%d, '')::uuid", len(args)+1))
		args = append(args, ownerID)
	}
	if input.BackupOwnerID != nil {
		assignments = append(assignments, fmt.Sprintf("backup_owner_id = NULLIF($%d, '')::uuid", len(args)+1))
		args = append(args, backupOwnerID)
	}
	result, err := server.db.Exec(fmt.Sprintf("UPDATE chat_channels SET %s WHERE id = $1::uuid", strings.Join(assignments, ", ")), args...)
	if err != nil {
		httpx.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	rowsAffected, err := result.RowsAffected()
	if err != nil {
		httpx.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	if rowsAffected == 0 {
		httpx.Error(c, http.StatusNotFound, "chat channel not found")
		return
	}
	auditDetail := gin.H{}
	response := gin.H{}
	if input.OwnerID != nil {
		auditDetail["ownerId"] = emptyToNullString(ownerID)
		response["ownerId"] = emptyToNullString(ownerID)
	}
	if input.BackupOwnerID != nil {
		auditDetail["backupOwnerId"] = emptyToNullString(backupOwnerID)
		response["backupOwnerId"] = emptyToNullString(backupOwnerID)
	}
	middleware.TagAudit(c, middleware.AuditMeta{Action: "chat_channel_owner_updated", TargetType: "chat_channel", TargetID: channelID, Detail: auditDetail})
	httpx.JSON(c, http.StatusOK, response)
}

func (server *apiServer) nextSupportTicketNumber(tx *sql.Tx) (string, error) {
	var ticketNumber string
	err := tx.QueryRow(`SELECT 'TKT-' || LPAD(nextval('support_ticket_number_seq')::text, 6, '0')`).Scan(&ticketNumber)
	return ticketNumber, err
}

func (server *apiServer) ensureClosedChatTicket(tx *sql.Tx, channelID string) (string, string, error) {
	var linkedRequestID, channelName, primaryOwnerID string
	var createdByID sql.NullString
	err := tx.QueryRow(`
		SELECT COALESCE(linked_request_id::text, ''), name, COALESCE(primary_owner_id::text, ''), created_by::text
		FROM chat_channels
		WHERE id = $1::uuid
	`, channelID).Scan(&linkedRequestID, &channelName, &primaryOwnerID, &createdByID)
	if err != nil {
		return "", "", err
	}
	if strings.TrimSpace(linkedRequestID) != "" {
		var ticketNumber string
		if err := tx.QueryRow(`SELECT COALESCE(ticket_number, '') FROM requests WHERE id = $1::uuid`, linkedRequestID).Scan(&ticketNumber); err != nil {
			return "", "", err
		}
		return linkedRequestID, strings.TrimSpace(ticketNumber), nil
	}
	requesterID := strings.TrimSpace(createdByID.String)
	if requesterID == "" {
		err = tx.QueryRow(`
			SELECT cm.user_id::text
			FROM chat_members cm
			JOIN users u ON u.id = cm.user_id
			JOIN roles r ON r.id = u.role_id
			WHERE cm.channel_id = $1::uuid AND r.name = 'employee'
			ORDER BY cm.created_at ASC
			LIMIT 1
		`, channelID).Scan(&requesterID)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				requesterID = strings.TrimSpace(createdByID.String)
			} else {
				return "", "", err
			}
		}
	}
	if requesterID == "" {
		return "", "", errors.New("chat requester not found")
	}
	ticketNumber, err := server.nextSupportTicketNumber(tx)
	if err != nil {
		return "", "", err
	}
	var requestID string
	requestStatus := "pending"
	if strings.TrimSpace(primaryOwnerID) != "" {
		requestStatus = "in_progress"
	}
	if err := tx.QueryRow(`
		INSERT INTO requests (requester_id, assignee_id, type, title, description, status, notes, ticket_number, source_chat_id, reference_key)
		VALUES ($1::uuid, NULLIF($2, '')::uuid, 'support_chat', $3, $4, $5, $6, $7, $8::uuid, $9)
		RETURNING id
	`, requesterID, strings.TrimSpace(primaryOwnerID), "Chat Ticket: "+strings.TrimSpace(channelName), "Auto-created from a closed support chat conversation.", requestStatus, "Converted from chat closure.", ticketNumber, channelID, "chat:"+channelID).Scan(&requestID); err != nil {
		return "", "", err
	}
	if _, err := tx.Exec(`UPDATE chat_channels SET linked_request_id = $2::uuid WHERE id = $1::uuid`, channelID, requestID); err != nil {
		return "", "", err
	}
	return requestID, ticketNumber, nil
}

func (server *apiServer) closeChatChannel(c *gin.Context) {
	if !server.requireRoles(c, "super_admin", "it_team") {
		return
	}
	claims := middleware.CurrentClaims(c)
	if claims == nil {
		httpx.Error(c, http.StatusUnauthorized, "unauthorized")
		return
	}
	channelID := strings.TrimSpace(c.Param("id"))
	if claims.Role == "it_team" {
		allowed, err := server.userIsChatMember(c.Request.Context(), channelID, claims.UserID)
		if err != nil {
			httpx.Error(c, http.StatusInternalServerError, err.Error())
			return
		}
		if !allowed {
			httpx.Error(c, http.StatusForbidden, "only chat members or super admin can close chats")
			return
		}
	}
	tx, err := server.db.Begin()
	if err != nil {
		httpx.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	defer tx.Rollback()
	var status string
	if err := tx.QueryRow(`SELECT status FROM chat_channels WHERE id = $1::uuid`, channelID).Scan(&status); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			httpx.Error(c, http.StatusNotFound, "chat channel not found")
			return
		}
		httpx.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	if status == "closed" {
		httpx.Error(c, http.StatusBadRequest, "chat is already closed")
		return
	}
	requestID, ticketNumber, err := server.ensureClosedChatTicket(tx, channelID)
	if err != nil {
		httpx.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	if _, err := tx.Exec(`UPDATE chat_channels SET status = 'closed', closed_at = NOW(), closed_by = $2::uuid WHERE id = $1::uuid`, channelID, claims.UserID); err != nil {
		httpx.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	actorName := strings.TrimSpace(claims.Name)
	if actorName == "" {
		actorName = strings.TrimSpace(claims.Email)
	}
	if _, err := tx.Exec(`INSERT INTO request_comments (request_id, author_id, note) VALUES ($1::uuid, $2::uuid, $3)`, requestID, claims.UserID, "Chat closed by "+actorName+". Follow-up continues under ticket "+ticketNumber+"."); err != nil {
		httpx.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	if err := tx.Commit(); err != nil {
		httpx.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	server.chat.publish(channelID, chatEnvelope{Type: "channel_closed", ChannelID: channelID, Status: "closed", TicketID: requestID, TicketNumber: ticketNumber, CreatedAt: time.Now().UTC().Format(time.RFC3339Nano)})
	middleware.TagAudit(c, middleware.AuditMeta{Action: "chat_channel_closed", TargetType: "chat_channel", TargetID: channelID, Detail: gin.H{"ticketId": requestID, "ticketNumber": ticketNumber}})
	httpx.JSON(c, http.StatusOK, gin.H{"status": "closed", "ticketId": requestID, "ticketNumber": ticketNumber})
}

func (server *apiServer) reopenChatChannel(c *gin.Context) {
	claims := middleware.CurrentClaims(c)
	if claims == nil {
		httpx.Error(c, http.StatusUnauthorized, "unauthorized")
		return
	}
	channelID := strings.TrimSpace(c.Param("id"))
	allowed, err := server.userIsChatMember(c.Request.Context(), channelID, claims.UserID)
	if err != nil {
		httpx.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	if !allowed {
		httpx.Error(c, http.StatusForbidden, "forbidden")
		return
	}
	if claims.Role != "employee" && claims.Role != "super_admin" && claims.Role != "it_team" {
		httpx.Error(c, http.StatusForbidden, "forbidden")
		return
	}
	var status string
	var linkedRequestID sql.NullString
	err = server.db.QueryRow(`SELECT status, linked_request_id::text FROM chat_channels WHERE id = $1::uuid`, channelID).Scan(&status, &linkedRequestID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			httpx.Error(c, http.StatusNotFound, "chat channel not found")
			return
		}
		httpx.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	if status != "closed" {
		httpx.Error(c, http.StatusBadRequest, "chat is already open")
		return
	}
	tx, err := server.db.Begin()
	if err != nil {
		httpx.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`UPDATE chat_channels SET status = 'open', closed_at = NULL, closed_by = NULL WHERE id = $1::uuid`, channelID); err != nil {
		httpx.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	if linkedRequestID.Valid && strings.TrimSpace(linkedRequestID.String) != "" {
		var assigneeID sql.NullString
		if err := tx.QueryRow(`SELECT assignee_id::text FROM requests WHERE id = $1::uuid`, linkedRequestID.String).Scan(&assigneeID); err == nil {
			requestStatus := "pending"
			if strings.TrimSpace(assigneeID.String) != "" {
				requestStatus = "in_progress"
			}
			if _, err := tx.Exec(`UPDATE requests SET status = $2, updated_at = NOW() WHERE id = $1::uuid`, linkedRequestID.String, requestStatus); err != nil {
				httpx.Error(c, http.StatusInternalServerError, err.Error())
				return
			}
			actorName := strings.TrimSpace(claims.Name)
			if actorName == "" {
				actorName = strings.TrimSpace(claims.Email)
			}
			if _, err := tx.Exec(`INSERT INTO request_comments (request_id, author_id, note) VALUES ($1::uuid, $2::uuid, $3)`, linkedRequestID.String, claims.UserID, "Chat reopened by "+actorName+"."); err != nil {
				httpx.Error(c, http.StatusInternalServerError, err.Error())
				return
			}
		}
	}
	if err := tx.Commit(); err != nil {
		httpx.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	server.chat.publish(channelID, chatEnvelope{Type: "channel_reopened", ChannelID: channelID, Status: "open", CreatedAt: time.Now().UTC().Format(time.RFC3339Nano)})
	middleware.TagAudit(c, middleware.AuditMeta{Action: "chat_channel_reopened", TargetType: "chat_channel", TargetID: channelID})
	httpx.JSON(c, http.StatusOK, gin.H{"status": "open", "ticketId": emptyToNullString(linkedRequestID.String)})
}

func (server *apiServer) listChatTicketSummary(c *gin.Context) {
	if !server.requireRoles(c, "super_admin") {
		return
	}
	rows, err := server.db.Query(`
		SELECT u.id, u.full_name,
			COUNT(r.id) FILTER (WHERE r.source_chat_id IS NOT NULL),
			COUNT(r.id) FILTER (WHERE r.source_chat_id IS NOT NULL AND r.status IN ('pending', 'in_progress')),
			COUNT(r.id) FILTER (WHERE r.source_chat_id IS NOT NULL AND r.status = 'resolved')
		FROM users u
		JOIN roles role ON role.id = u.role_id
		LEFT JOIN requests r ON r.assignee_id = u.id
		WHERE u.is_active = TRUE AND role.name IN ('it_team', 'super_admin')
		GROUP BY u.id, u.full_name
		ORDER BY COUNT(r.id) FILTER (WHERE r.source_chat_id IS NOT NULL) DESC, u.full_name ASC
	`)
	if err != nil {
		httpx.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()
	items := make([]gin.H, 0)
	for rows.Next() {
		var id, fullName string
		var total, openCount, resolved int
		if err := rows.Scan(&id, &fullName, &total, &openCount, &resolved); err != nil {
			httpx.Error(c, http.StatusInternalServerError, err.Error())
			return
		}
		items = append(items, gin.H{"id": id, "fullName": fullName, "total": total, "open": openCount, "resolved": resolved})
	}
	httpx.JSON(c, http.StatusOK, gin.H{"items": items})
}

func (server *apiServer) deleteChatChannel(c *gin.Context) {
	if !server.requireRoles(c, "super_admin", "it_team") {
		return
	}
	claims := middleware.CurrentClaims(c)
	var createdBy string
	err := server.db.QueryRow(`SELECT created_by FROM chat_channels WHERE id = $1::uuid`, c.Param("id")).Scan(&createdBy)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			httpx.Error(c, http.StatusNotFound, "chat channel not found")
			return
		}
		httpx.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	if claims.Role == "it_team" && createdBy != claims.UserID {
		httpx.Error(c, http.StatusForbidden, "only the creator or super admin can close this channel")
		return
	}
	if _, err := server.db.Exec(`DELETE FROM chat_channels WHERE id = $1::uuid`, c.Param("id")); err != nil {
		httpx.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	middleware.TagAudit(c, middleware.AuditMeta{Action: "chat_channel_deleted", TargetType: "chat_channel", TargetID: c.Param("id")})
	httpx.JSON(c, http.StatusOK, gin.H{"status": "closed"})
}

func (server *apiServer) listChatMessages(c *gin.Context) {
	claims := middleware.CurrentClaims(c)
	if claims == nil {
		httpx.Error(c, http.StatusUnauthorized, "unauthorized")
		return
	}
	page, pageSize, paginate := parsePaginationRequest(c, 100)
	allowed, err := server.userIsChatMember(c.Request.Context(), c.Param("id"), claims.UserID)
	if err != nil {
		httpx.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	if !allowed {
		httpx.Error(c, http.StatusForbidden, "forbidden")
		return
	}
	if !paginate {
		rows, err := server.db.Query(`
			SELECT m.id, m.body, m.created_at, u.id, u.full_name
			FROM chat_messages m
			JOIN users u ON u.id = m.author_id
			WHERE m.channel_id = $1::uuid
			ORDER BY m.created_at ASC
		`, c.Param("id"))
		if err != nil {
			httpx.Error(c, http.StatusInternalServerError, err.Error())
			return
		}
		defer rows.Close()

		result := make([]gin.H, 0)
		for rows.Next() {
			var id, body, authorID, authorName string
			var createdAt time.Time
			if err := rows.Scan(&id, &body, &createdAt, &authorID, &authorName); err != nil {
				httpx.Error(c, http.StatusInternalServerError, err.Error())
				return
			}
			result = append(result, gin.H{
				"id":        id,
				"body":      body,
				"createdAt": createdAt,
				"author":    gin.H{"id": authorID, "fullName": authorName},
			})
		}
		httpx.JSON(c, http.StatusOK, result)
		return
	}

	var total int
	if err := server.db.QueryRow(`SELECT COUNT(*) FROM chat_messages WHERE channel_id = $1::uuid`, c.Param("id")).Scan(&total); err != nil {
		httpx.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	offset := (page - 1) * pageSize
	rows, err := server.db.Query(`
		SELECT id, body, created_at, author_id, full_name
		FROM (
			SELECT m.id, m.body, m.created_at, u.id AS author_id, u.full_name
			FROM chat_messages m
			JOIN users u ON u.id = m.author_id
			WHERE m.channel_id = $1::uuid
			ORDER BY m.created_at DESC
			LIMIT $2 OFFSET $3
		) recent_messages
		ORDER BY created_at ASC
	`, c.Param("id"), pageSize, offset)
	if err != nil {
		httpx.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()

	result := make([]gin.H, 0)
	for rows.Next() {
		var id, body, authorID, authorName string
		var createdAt time.Time
		if err := rows.Scan(&id, &body, &createdAt, &authorID, &authorName); err != nil {
			httpx.Error(c, http.StatusInternalServerError, err.Error())
			return
		}
		result = append(result, gin.H{
			"id":        id,
			"body":      body,
			"createdAt": createdAt,
			"author":    gin.H{"id": authorID, "fullName": authorName},
		})
	}
	httpx.JSON(c, http.StatusOK, gin.H{
		"items":    result,
		"total":    total,
		"page":     page,
		"pageSize": pageSize,
	})
}

func (server *apiServer) chatWebsocket(c *gin.Context) {
	rawToken := extractWebSocketBearerToken(c.Request)
	channelID := strings.TrimSpace(c.Query("channelId"))
	if rawToken == "" || channelID == "" {
		httpx.Error(c, http.StatusBadRequest, "token and channelId are required")
		return
	}
	if !server.websocketOriginAllowed(c.GetHeader("Origin")) {
		httpx.Error(c, http.StatusForbidden, "origin not allowed")
		return
	}
	claims, err := server.auth.ParseToken(rawToken)
	if err != nil {
		httpx.Error(c, http.StatusUnauthorized, "invalid token")
		return
	}
	if err := server.ensureChatChannelsForUser(claims); err != nil {
		httpx.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	allowed, err := server.userIsChatMember(c.Request.Context(), channelID, claims.UserID)
	if err != nil {
		httpx.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	if !allowed {
		httpx.Error(c, http.StatusForbidden, "forbidden")
		return
	}

	responseHeader := http.Header{}
	if protocol := selectChatSubprotocol(c.Request); protocol != "" {
		responseHeader.Set("Sec-WebSocket-Protocol", protocol)
	}
	upgrader := websocket.Upgrader{CheckOrigin: func(request *http.Request) bool {
		return server.websocketOriginAllowed(request.Header.Get("Origin"))
	}}
	conn, err := upgrader.Upgrade(c.Writer, c.Request, responseHeader)
	if err != nil {
		return
	}
	server.chat.subscribe(channelID, conn)
	defer func() {
		server.chat.unsubscribe(channelID, conn)
		_ = conn.Close()
	}()

	type incomingMessage struct {
		Type      string `json:"type"`
		ChannelID string `json:"channelId"`
		Body      string `json:"body"`
		Typing    bool   `json:"typing"`
	}

	for {
		var input incomingMessage
		if err := conn.ReadJSON(&input); err != nil {
			return
		}
		if strings.TrimSpace(input.ChannelID) != channelID {
			continue
		}
		if strings.TrimSpace(input.Type) == "typing" {
			server.chat.publish(channelID, chatEnvelope{
				Type:       "typing",
				ChannelID:  channelID,
				AuthorID:   claims.UserID,
				AuthorName: claims.Name,
				Typing:     input.Typing,
				CreatedAt:  time.Now().UTC().Format(time.RFC3339Nano),
			})
			continue
		}
		body := strings.TrimSpace(input.Body)
		if body == "" || len(body) > 4000 {
			continue
		}
		var channelStatus string
		if err := server.db.QueryRow(`SELECT status FROM chat_channels WHERE id = $1::uuid`, channelID).Scan(&channelStatus); err != nil {
			continue
		}
		if channelStatus == "closed" {
			_ = conn.WriteJSON(chatEnvelope{Type: "channel_closed", ChannelID: channelID, Status: "closed", CreatedAt: time.Now().UTC().Format(time.RFC3339Nano)})
			continue
		}
		var messageID string
		var createdAt time.Time
		if err := server.db.QueryRow(`
			INSERT INTO chat_messages (channel_id, author_id, body)
			VALUES ($1::uuid, $2::uuid, $3)
			RETURNING id, created_at
		`, channelID, claims.UserID, body).Scan(&messageID, &createdAt); err != nil {
			continue
		}
		envelope := chatEnvelope{
			Type:       "message",
			ChannelID:  channelID,
			MessageID:  messageID,
			AuthorID:   claims.UserID,
			AuthorName: claims.Name,
			Body:       body,
			Typing:     false,
			CreatedAt:  createdAt.Format(time.RFC3339Nano),
		}
		server.chat.publish(channelID, envelope)
	}
}

func (server *apiServer) ensureChatChannelsForUser(claims *authn.Claims) error {
	if claims == nil {
		return nil
	}
	if claims.Role == "employee" {
		var existing bool
		if err := server.db.QueryRow(`SELECT EXISTS(SELECT 1 FROM chat_members WHERE user_id = $1::uuid)`, claims.UserID).Scan(&existing); err != nil {
			return err
		}
		if existing {
			return nil
		}
		enabled, err := server.chatAutoCreateEnabled()
		if err != nil {
			return err
		}
		if enabled {
			return nil
		}
		return server.createSupportChannelForEmployee(claims)
	}

	var channelID string
	err := server.db.QueryRow(`SELECT id FROM chat_channels WHERE kind = 'operations' ORDER BY created_at ASC LIMIT 1`).Scan(&channelID)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	if errors.Is(err, sql.ErrNoRows) {
		return server.createOperationsChannel(claims.UserID)
	}
	_, err = server.db.Exec(`INSERT INTO chat_members (channel_id, user_id) VALUES ($1::uuid, $2::uuid) ON CONFLICT DO NOTHING`, channelID, claims.UserID)
	return err
}

func (server *apiServer) createOperationsChannel(createdBy string) error {
	tx, err := server.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var channelID string
	if err := tx.QueryRow(`
		INSERT INTO chat_channels (name, kind, created_by, primary_owner_id)
		VALUES ('IT Operations', 'operations', $1::uuid, $1::uuid)
		RETURNING id
	`, createdBy).Scan(&channelID); err != nil {
		return err
	}
	memberIDs, err := server.configuredChatOwnerIDs()
	if err != nil {
		return err
	}
	for _, userID := range memberIDs {
		if _, err := tx.Exec(`INSERT INTO chat_members (channel_id, user_id) VALUES ($1::uuid, $2::uuid) ON CONFLICT DO NOTHING`, channelID, userID); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (server *apiServer) createSupportChannelForEmployee(claims *authn.Claims) error {
	tx, err := server.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	channelName := "Support"
	if strings.TrimSpace(claims.Name) != "" {
		channelName = "Support - " + strings.TrimSpace(claims.Name)
	}
	primaryOwnerID := ""
	memberIDs, err := server.configuredChatOwnerIDs()
	if err != nil {
		return err
	}
	for _, userID := range memberIDs {
		if primaryOwnerID == "" {
			primaryOwnerID = userID
		}
	}
	var channelID string
	if err := tx.QueryRow(`
		INSERT INTO chat_channels (name, kind, created_by, primary_owner_id)
		VALUES ($1, 'support', $2::uuid, NULLIF($3, '')::uuid)
		RETURNING id
	`, channelName, claims.UserID, primaryOwnerID).Scan(&channelID); err != nil {
		return err
	}
	if _, err := tx.Exec(`INSERT INTO chat_members (channel_id, user_id) VALUES ($1::uuid, $2::uuid) ON CONFLICT DO NOTHING`, channelID, claims.UserID); err != nil {
		return err
	}
	for _, userID := range memberIDs {
		if _, err := tx.Exec(`INSERT INTO chat_members (channel_id, user_id) VALUES ($1::uuid, $2::uuid) ON CONFLICT DO NOTHING`, channelID, userID); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (server *apiServer) userIsChatMember(_ any, channelID string, userID string) (bool, error) {
	var exists bool
	err := server.db.QueryRow(`SELECT EXISTS(SELECT 1 FROM chat_members WHERE channel_id = $1::uuid AND user_id = $2::uuid)`, channelID, userID).Scan(&exists)
	return exists, err
}
