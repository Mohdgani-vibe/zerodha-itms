package api

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"itms/backend/internal/platform/httpx"
	"itms/backend/internal/platform/middleware"
)

const workflowSettingsKey = "workflow_settings"

type workflowRoute struct {
	Match      string `json:"match"`
	AssigneeID string `json:"assigneeId"`
}

type workflowSettings struct {
	RequestAutoAssignEnabled  bool            `json:"requestAutoAssignEnabled"`
	ChatAutoCreateEnabled     bool            `json:"chatAutoCreateEnabled"`
	ChatAutoRouteEnabled      bool            `json:"chatAutoRouteEnabled"`
	RequestFallbackAssigneeID string          `json:"requestFallbackAssigneeId"`
	ChatFallbackAssigneeID    string          `json:"chatFallbackAssigneeId"`
	TicketAssigneeIDs         []string        `json:"ticketAssigneeIds"`
	ChatMemberIDs             []string        `json:"chatMemberIds"`
	RequestTypeRoutes         []workflowRoute `json:"requestTypeRoutes"`
	RequestSubjectRoutes      []workflowRoute `json:"requestSubjectRoutes"`
	ChatSubjectRoutes         []workflowRoute `json:"chatSubjectRoutes"`
	UpdatedAt                 string          `json:"updatedAt,omitempty"`
}

type workflowSettingsResponse struct {
	RequestAutoAssignEnabled  bool            `json:"requestAutoAssignEnabled"`
	ChatAutoCreateEnabled     bool            `json:"chatAutoCreateEnabled"`
	ChatAutoRouteEnabled      bool            `json:"chatAutoRouteEnabled"`
	RequestFallbackAssigneeID any             `json:"requestFallbackAssigneeId"`
	ChatFallbackAssigneeID    any             `json:"chatFallbackAssigneeId"`
	TicketAssigneeIDs         []string        `json:"ticketAssigneeIds"`
	ChatMemberIDs             []string        `json:"chatMemberIds"`
	RequestTypeRoutes         []workflowRoute `json:"requestTypeRoutes"`
	RequestSubjectRoutes      []workflowRoute `json:"requestSubjectRoutes"`
	ChatSubjectRoutes         []workflowRoute `json:"chatSubjectRoutes"`
	UpdatedAt                 string          `json:"updatedAt,omitempty"`
}

func defaultWorkflowSettings() workflowSettings {
	return workflowSettings{
		RequestAutoAssignEnabled: false,
		ChatAutoCreateEnabled:    true,
		ChatAutoRouteEnabled:     false,
		TicketAssigneeIDs:        []string{},
		ChatMemberIDs:            []string{},
		RequestTypeRoutes:        []workflowRoute{},
		RequestSubjectRoutes:     []workflowRoute{},
		ChatSubjectRoutes:        []workflowRoute{},
	}
}

func normalizeWorkflowRoute(route workflowRoute) workflowRoute {
	return workflowRoute{
		Match:      strings.Join(strings.Fields(strings.ToLower(strings.TrimSpace(route.Match))), " "),
		AssigneeID: strings.TrimSpace(route.AssigneeID),
	}
}

func normalizeWorkflowSettings(settings workflowSettings) workflowSettings {
	settings.RequestFallbackAssigneeID = strings.TrimSpace(settings.RequestFallbackAssigneeID)
	settings.ChatFallbackAssigneeID = strings.TrimSpace(settings.ChatFallbackAssigneeID)
	settings.TicketAssigneeIDs = normalizeWorkflowIDs(settings.TicketAssigneeIDs)
	settings.ChatMemberIDs = normalizeWorkflowIDs(settings.ChatMemberIDs)
	settings.RequestTypeRoutes = normalizeWorkflowRoutes(settings.RequestTypeRoutes)
	settings.RequestSubjectRoutes = normalizeWorkflowRoutes(settings.RequestSubjectRoutes)
	settings.ChatSubjectRoutes = normalizeWorkflowRoutes(settings.ChatSubjectRoutes)
	return settings
}

func normalizeWorkflowIDs(ids []string) []string {
	normalized := make([]string, 0, len(ids))
	seen := make(map[string]struct{}, len(ids))
	for _, id := range ids {
		id = strings.TrimSpace(id)
		if id == "" {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		normalized = append(normalized, id)
	}
	return normalized
}

func normalizeWorkflowRoutes(routes []workflowRoute) []workflowRoute {
	normalized := make([]workflowRoute, 0, len(routes))
	for _, route := range routes {
		route = normalizeWorkflowRoute(route)
		if route.Match == "" || route.AssigneeID == "" {
			continue
		}
		normalized = append(normalized, route)
	}
	return normalized
}

func workflowSettingsAPIResponse(settings workflowSettings) workflowSettingsResponse {
	return workflowSettingsResponse{
		RequestAutoAssignEnabled:  settings.RequestAutoAssignEnabled,
		ChatAutoCreateEnabled:     settings.ChatAutoCreateEnabled,
		ChatAutoRouteEnabled:      settings.ChatAutoRouteEnabled,
		RequestFallbackAssigneeID: emptyToNil(settings.RequestFallbackAssigneeID),
		ChatFallbackAssigneeID:    emptyToNil(settings.ChatFallbackAssigneeID),
		TicketAssigneeIDs:         settings.TicketAssigneeIDs,
		ChatMemberIDs:             settings.ChatMemberIDs,
		RequestTypeRoutes:         settings.RequestTypeRoutes,
		RequestSubjectRoutes:      settings.RequestSubjectRoutes,
		ChatSubjectRoutes:         settings.ChatSubjectRoutes,
		UpdatedAt:                 settings.UpdatedAt,
	}
}

func (server *apiServer) getWorkflowSettingsRecord() (workflowSettings, error) {
	settings := defaultWorkflowSettings()
	var raw string
	var updatedAt time.Time
	err := server.db.QueryRow(`SELECT value, updated_at FROM settings WHERE key = $1`, workflowSettingsKey).Scan(&raw, &updatedAt)
	if err != nil {
		if err == sql.ErrNoRows {
			return settings, nil
		}
		return settings, err
	}
	if strings.TrimSpace(raw) != "" {
		if err := json.Unmarshal([]byte(raw), &settings); err != nil {
			return defaultWorkflowSettings(), nil
		}
	}
	settings = normalizeWorkflowSettings(settings)
	settings.UpdatedAt = updatedAt.Format(time.RFC3339)
	return settings, nil
}

func (server *apiServer) saveWorkflowSettings(settings workflowSettings) (workflowSettings, error) {
	settings = normalizeWorkflowSettings(settings)
	payload, err := json.Marshal(settings)
	if err != nil {
		return settings, err
	}
	var updatedAt time.Time
	err = server.db.QueryRow(`
		INSERT INTO settings (key, value, updated_at)
		VALUES ($1, $2, NOW())
		ON CONFLICT (key)
		DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
		RETURNING updated_at
	`, workflowSettingsKey, string(payload)).Scan(&updatedAt)
	if err != nil {
		return settings, err
	}
	settings.UpdatedAt = updatedAt.Format(time.RFC3339)
	return settings, nil
}

func (server *apiServer) validateActiveWorkflowUser(id string) (string, error) {
	if strings.TrimSpace(id) == "" {
		return "", nil
	}
	var role string
	var active bool
	err := server.db.QueryRow(`
		SELECT r.name, u.is_active
		FROM users u
		JOIN roles r ON r.id = u.role_id
		WHERE u.id = $1::uuid
	`, id).Scan(&role, &active)
	if err != nil {
		if err == sql.ErrNoRows {
			return "", fmt.Errorf("assignee %s not found", id)
		}
		return "", err
	}
	if !active {
		return "", fmt.Errorf("assignee %s is inactive", id)
	}
	return role, nil
	}

func (server *apiServer) validateWorkflowAssignee(id string) error {
	_, err := server.validateActiveWorkflowUser(id)
	return err
	}

func (server *apiServer) validateITWorkflowAssignee(id string) error {
	role, err := server.validateActiveWorkflowUser(id)
	if err != nil {
		return err
	}
	if strings.TrimSpace(id) == "" {
		return nil
	}
	if role != "it_team" && role != "super_admin" {
		return fmt.Errorf("assignee %s must be IT team or super admin", id)
	}
	return nil
}

func workflowSettingsAssigneeIDs(settings workflowSettings) []string {
	ids := []string{}
	appendID := func(id string) {
		id = strings.TrimSpace(id)
		if id != "" {
			ids = append(ids, id)
		}
	}
	for _, id := range settings.TicketAssigneeIDs {
		appendID(id)
	}
	for _, id := range settings.ChatMemberIDs {
		appendID(id)
	}
	appendID(settings.RequestFallbackAssigneeID)
	appendID(settings.ChatFallbackAssigneeID)
	for _, route := range settings.RequestTypeRoutes {
		appendID(route.AssigneeID)
	}
	for _, route := range settings.RequestSubjectRoutes {
		appendID(route.AssigneeID)
	}
	for _, route := range settings.ChatSubjectRoutes {
		appendID(route.AssigneeID)
	}
	return ids
}

func containsWorkflowID(ids []string, target string) bool {
	target = strings.TrimSpace(target)
	if target == "" {
		return false
	}
	for _, id := range ids {
		if strings.TrimSpace(id) == target {
			return true
		}
	}
	return false
}

func (server *apiServer) validateWorkflowScopeAssignments(settings workflowSettings) error {
	if len(settings.TicketAssigneeIDs) > 0 {
		if settings.RequestFallbackAssigneeID != "" && !containsWorkflowID(settings.TicketAssigneeIDs, settings.RequestFallbackAssigneeID) {
			return fmt.Errorf("request fallback assignee must be in the ticket assignee list")
		}
		for _, route := range settings.RequestTypeRoutes {
			if !containsWorkflowID(settings.TicketAssigneeIDs, route.AssigneeID) {
				return fmt.Errorf("request type route for %q must use a listed ticket assignee", route.Match)
			}
		}
		for _, route := range settings.RequestSubjectRoutes {
			if !containsWorkflowID(settings.TicketAssigneeIDs, route.AssigneeID) {
				return fmt.Errorf("request subject route for %q must use a listed ticket assignee", route.Match)
			}
		}
	}
	if len(settings.ChatMemberIDs) > 0 {
		if settings.ChatFallbackAssigneeID != "" && !containsWorkflowID(settings.ChatMemberIDs, settings.ChatFallbackAssigneeID) {
			return fmt.Errorf("chat fallback assignee must be in the chat member list")
		}
		for _, route := range settings.ChatSubjectRoutes {
			if !containsWorkflowID(settings.ChatMemberIDs, route.AssigneeID) {
				return fmt.Errorf("chat subject route for %q must use a listed chat member", route.Match)
			}
		}
	}
	return nil
}

func (server *apiServer) validateTicketAssignee(id string) error {
	id = strings.TrimSpace(id)
	if id == "" {
		return nil
	}
	settings, err := server.getWorkflowSettingsRecord()
	if err != nil {
		return err
	}
	if len(settings.TicketAssigneeIDs) > 0 && !containsWorkflowID(settings.TicketAssigneeIDs, id) {
		return fmt.Errorf("assignee %s is not enabled in ticket settings", id)
	}
	return server.validateWorkflowAssignee(id)
}

func (server *apiServer) validateChatMemberAssignee(id string) error {
	id = strings.TrimSpace(id)
	if id == "" {
		return nil
	}
	settings, err := server.getWorkflowSettingsRecord()
	if err != nil {
		return err
	}
	if len(settings.ChatMemberIDs) > 0 && !containsWorkflowID(settings.ChatMemberIDs, id) {
		return fmt.Errorf("member %s is not enabled in chat member settings", id)
	}
	return server.validateITWorkflowAssignee(id)
}

func (server *apiServer) configuredChatOwnerIDs() ([]string, error) {
	settings, err := server.getWorkflowSettingsRecord()
	if err != nil {
		return nil, err
	}
	if len(settings.ChatMemberIDs) > 0 {
		return append([]string(nil), settings.ChatMemberIDs...), nil
	}
	rows, err := server.db.Query(`
		SELECT u.id
		FROM users u
		JOIN roles r ON r.id = u.role_id
		WHERE u.is_active = TRUE AND r.name IN ('super_admin', 'it_team')
		ORDER BY CASE WHEN r.name = 'it_team' THEN 0 ELSE 1 END, u.full_name ASC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	memberIDs := make([]string, 0)
	for rows.Next() {
		var userID string
		if err := rows.Scan(&userID); err != nil {
			return nil, err
		}
		memberIDs = append(memberIDs, userID)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return memberIDs, nil
}

func (server *apiServer) getWorkflowSettings(c *gin.Context) {
	if !server.requireRoles(c, "super_admin", "it_team") {
		return
	}
	settings, err := server.getWorkflowSettingsRecord()
	if err != nil {
		httpx.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	httpx.JSON(c, http.StatusOK, workflowSettingsAPIResponse(settings))
}

func (server *apiServer) updateWorkflowSettings(c *gin.Context) {
	if !server.requireRoles(c, "super_admin", "it_team") {
		return
	}
	var input workflowSettings
	if err := c.ShouldBindJSON(&input); err != nil {
		httpx.Error(c, http.StatusBadRequest, "invalid workflow settings payload")
		return
	}
	input = normalizeWorkflowSettings(input)
	for _, id := range input.TicketAssigneeIDs {
		if err := server.validateWorkflowAssignee(id); err != nil {
			httpx.Error(c, http.StatusBadRequest, err.Error())
			return
		}
	}
	if err := server.validateWorkflowAssignee(input.RequestFallbackAssigneeID); err != nil {
		httpx.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	for _, route := range input.RequestTypeRoutes {
		if err := server.validateWorkflowAssignee(route.AssigneeID); err != nil {
			httpx.Error(c, http.StatusBadRequest, err.Error())
			return
		}
	}
	for _, route := range input.RequestSubjectRoutes {
		if err := server.validateWorkflowAssignee(route.AssigneeID); err != nil {
			httpx.Error(c, http.StatusBadRequest, err.Error())
			return
		}
	}
	for _, id := range input.ChatMemberIDs {
		if err := server.validateITWorkflowAssignee(id); err != nil {
			httpx.Error(c, http.StatusBadRequest, err.Error())
			return
		}
	}
	if err := server.validateITWorkflowAssignee(input.ChatFallbackAssigneeID); err != nil {
		httpx.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	for _, route := range input.ChatSubjectRoutes {
		if err := server.validateITWorkflowAssignee(route.AssigneeID); err != nil {
			httpx.Error(c, http.StatusBadRequest, err.Error())
			return
		}
	}
	if err := server.validateWorkflowScopeAssignments(input); err != nil {
		httpx.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	settings, err := server.saveWorkflowSettings(input)
	if err != nil {
		httpx.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	middleware.TagAudit(c, middleware.AuditMeta{Action: "settings_changed", TargetType: "settings", TargetID: workflowSettingsKey, Detail: settings})
	httpx.JSON(c, http.StatusOK, workflowSettingsAPIResponse(settings))
}

func firstMatchingWorkflowRoute(routes []workflowRoute, subject string, exact bool) string {
	subject = strings.Join(strings.Fields(strings.ToLower(strings.TrimSpace(subject))), " ")
	if subject == "" {
		return ""
	}
	for _, route := range routes {
		match := strings.Join(strings.Fields(strings.ToLower(strings.TrimSpace(route.Match))), " ")
		if match == "" || strings.TrimSpace(route.AssigneeID) == "" {
			continue
		}
		if exact {
			if subject == match {
				return strings.TrimSpace(route.AssigneeID)
			}
			continue
		}
		if strings.Contains(subject, match) {
			return strings.TrimSpace(route.AssigneeID)
		}
	}
	return ""
}

func (server *apiServer) resolveRequestRouting(typeValue string, title string, description string) (string, error) {
	settings, err := server.getWorkflowSettingsRecord()
	if err != nil {
		return "", err
	}
	if !settings.RequestAutoAssignEnabled {
		return "", nil
	}
	if assigneeID := firstMatchingWorkflowRoute(settings.RequestTypeRoutes, typeValue, true); assigneeID != "" {
		return assigneeID, nil
	}
	combined := strings.TrimSpace(title + " " + description)
	if assigneeID := firstMatchingWorkflowRoute(settings.RequestSubjectRoutes, combined, false); assigneeID != "" {
		return assigneeID, nil
	}
	return strings.TrimSpace(settings.RequestFallbackAssigneeID), nil
}

func (server *apiServer) resolveChatRouting(name string) (string, error) {
	settings, err := server.getWorkflowSettingsRecord()
	if err != nil {
		return "", err
	}
	if !settings.ChatAutoRouteEnabled {
		return "", nil
	}
	if assigneeID := firstMatchingWorkflowRoute(settings.ChatSubjectRoutes, name, false); assigneeID != "" {
		return assigneeID, nil
	}
	return strings.TrimSpace(settings.ChatFallbackAssigneeID), nil
}

func (server *apiServer) chatAutoCreateEnabled() (bool, error) {
	settings, err := server.getWorkflowSettingsRecord()
	if err != nil {
		return false, err
	}
	return settings.ChatAutoCreateEnabled, nil
}
