package wazuh

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"itms/backend/internal/integrations/hostbridge"
)

type Client struct {
	baseURL    string
	username   string
	password   string
	httpClient *http.Client

	mu          sync.Mutex
	token       string
	tokenExpiry time.Time
}

type AgentAlert struct {
	ID        string
	RuleID    string
	Level     string
	Title     string
	Detail    string
	CreatedAt string
}

func NewClient(baseURL string, username string, password string, caFile string, insecureSkipVerify bool) *Client {
	tlsConfig := &tls.Config{InsecureSkipVerify: insecureSkipVerify}
	if strings.TrimSpace(caFile) != "" {
		pool, err := x509.SystemCertPool()
		if err != nil || pool == nil {
			pool = x509.NewCertPool()
		}
		if pemBytes, err := os.ReadFile(caFile); err == nil {
			if pool.AppendCertsFromPEM(pemBytes) {
				tlsConfig.RootCAs = pool
			}
		}
	}

	return &Client{
		baseURL:  strings.TrimRight(baseURL, "/"),
		username: username,
		password: password,
		httpClient: &http.Client{
			Timeout:   20 * time.Second,
			Transport: &http.Transport{TLSClientConfig: tlsConfig, DialContext: hostbridge.DialContext},
			CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
				return fmt.Errorf("wazuh redirects are not allowed")
			},
		},
	}
}

func (client *Client) Enabled() bool {
	return client != nil && client.baseURL != ""
}

func (client *Client) ListAgentAlerts(ctx context.Context, agentID string, limit int) ([]AgentAlert, error) {
	if !client.Enabled() {
		return nil, fmt.Errorf("wazuh integration is not configured")
	}
	if limit <= 0 {
		limit = 20
	}
	token, err := client.authToken(ctx)
	if err != nil {
		return nil, err
	}

	findings := make([]AgentAlert, 0, 3)
	syscheckFinding, err := client.listSyscheckAlert(ctx, token, agentID, limit)
	if err != nil {
		return nil, err
	}
	if syscheckFinding != nil {
		findings = append(findings, *syscheckFinding)
	}
	scaFindings, err := client.listSCAAlerts(ctx, token, agentID, limit)
	if err != nil {
		return nil, err
	}
	findings = append(findings, scaFindings...)
	rootcheckFinding, err := client.listRootcheckAlert(ctx, token, agentID, limit)
	if err != nil {
		return nil, err
	}
	if rootcheckFinding != nil {
		findings = append(findings, *rootcheckFinding)
	}
	return findings, nil
}

func (client *Client) listSyscheckAlert(ctx context.Context, token string, agentID string, limit int) (*AgentAlert, error) {
	var payload struct {
		Data struct {
			AffectedItems []struct {
				File    string `json:"file"`
				Date    string `json:"date"`
				Changes int    `json:"changes"`
				SHA256  string `json:"sha256"`
			} `json:"affected_items"`
			TotalAffectedItems int `json:"total_affected_items"`
		} `json:"data"`
	}
	if err := client.getJSON(ctx, token, fmt.Sprintf("/syscheck/%s?limit=%d", agentID, limit), &payload); err != nil {
		return nil, err
	}
	if payload.Data.TotalAffectedItems == 0 || len(payload.Data.AffectedItems) == 0 {
		return nil, nil
	}
	detailLines := []string{fmt.Sprintf("Wazuh reported %d file integrity changes.", payload.Data.TotalAffectedItems)}
	for _, item := range payload.Data.AffectedItems {
		line := strings.TrimSpace(item.File)
		if line == "" {
			continue
		}
		if item.Changes > 0 {
			line = fmt.Sprintf("%s (changes: %d)", line, item.Changes)
		}
		detailLines = append(detailLines, "- "+line)
	}
	createdAt := strings.TrimSpace(payload.Data.AffectedItems[0].Date)
	if createdAt == "" {
		createdAt = time.Now().UTC().Format(time.RFC3339)
	}
	return &AgentAlert{
		ID:        fmt.Sprintf("syscheck-%s-%s", agentID, strings.ReplaceAll(createdAt, ":", "-")),
		RuleID:    "syscheck",
		Level:     "warning",
		Title:     "Wazuh file integrity changes detected",
		Detail:    strings.Join(detailLines, "\n"),
		CreatedAt: createdAt,
	}, nil
}

func (client *Client) listSCAAlerts(ctx context.Context, token string, agentID string, limit int) ([]AgentAlert, error) {
	var payload struct {
		Data struct {
			AffectedItems []struct {
				PolicyID    string `json:"policy_id"`
				Name        string `json:"name"`
				Description string `json:"description"`
				Score       int    `json:"score"`
				Pass        int    `json:"pass"`
				Fail        int    `json:"fail"`
				Invalid     int    `json:"invalid"`
				StartScan   string `json:"start_scan"`
				EndScan     string `json:"end_scan"`
			} `json:"affected_items"`
		} `json:"data"`
	}
	if err := client.getJSON(ctx, token, fmt.Sprintf("/sca/%s?limit=%d", agentID, limit), &payload); err != nil {
		return nil, err
	}
	findings := make([]AgentAlert, 0, len(payload.Data.AffectedItems))
	for _, item := range payload.Data.AffectedItems {
		if item.Fail <= 0 && item.Invalid <= 0 {
			continue
		}
		severity := "medium"
		if item.Score < 50 || item.Fail >= 100 {
			severity = "high"
		}
		createdAt := strings.TrimSpace(item.EndScan)
		if createdAt == "" {
			createdAt = strings.TrimSpace(item.StartScan)
		}
		if createdAt == "" {
			createdAt = time.Now().UTC().Format(time.RFC3339)
		}
		detailParts := []string{}
		if text := strings.TrimSpace(item.Description); text != "" {
			detailParts = append(detailParts, text)
		}
		detailParts = append(detailParts, fmt.Sprintf("Score: %d • Passed: %d • Failed: %d • Invalid: %d", item.Score, item.Pass, item.Fail, item.Invalid))
		findings = append(findings, AgentAlert{
			ID:        fmt.Sprintf("sca-%s-%s", agentID, strings.TrimSpace(item.PolicyID)),
			RuleID:    strings.TrimSpace(item.PolicyID),
			Level:     severity,
			Title:     "Wazuh compliance findings",
			Detail:    strings.TrimSpace(strings.Join(detailParts, "\n")),
			CreatedAt: createdAt,
		})
	}
	return findings, nil
}

func (client *Client) listRootcheckAlert(ctx context.Context, token string, agentID string, limit int) (*AgentAlert, error) {
	var payload struct {
		Data struct {
			AffectedItems []struct {
				Status      string `json:"status"`
				Title       string `json:"title"`
				Description string `json:"description"`
				Event       string `json:"event"`
				DateFirst   string `json:"date_first"`
				DateLast    string `json:"date_last"`
			} `json:"affected_items"`
			TotalAffectedItems int `json:"total_affected_items"`
		} `json:"data"`
	}
	if err := client.getJSON(ctx, token, fmt.Sprintf("/rootcheck/%s?limit=%d", agentID, limit), &payload); err != nil {
		return nil, err
	}
	if payload.Data.TotalAffectedItems == 0 || len(payload.Data.AffectedItems) == 0 {
		return nil, nil
	}
	detailLines := []string{fmt.Sprintf("Wazuh rootcheck returned %d findings.", payload.Data.TotalAffectedItems)}
	for _, item := range payload.Data.AffectedItems {
		parts := []string{strings.TrimSpace(item.Title), strings.TrimSpace(item.Description), strings.TrimSpace(item.Event)}
		line := strings.TrimSpace(strings.Join(filterEmpty(parts), " - "))
		if line != "" {
			detailLines = append(detailLines, "- "+line)
		}
	}
	createdAt := strings.TrimSpace(payload.Data.AffectedItems[0].DateLast)
	if createdAt == "" {
		createdAt = strings.TrimSpace(payload.Data.AffectedItems[0].DateFirst)
	}
	if createdAt == "" {
		createdAt = time.Now().UTC().Format(time.RFC3339)
	}
	return &AgentAlert{
		ID:        fmt.Sprintf("rootcheck-%s-%s", agentID, strings.ReplaceAll(createdAt, ":", "-")),
		RuleID:    "rootcheck",
		Level:     "warning",
		Title:     "Wazuh rootcheck findings",
		Detail:    strings.Join(detailLines, "\n"),
		CreatedAt: createdAt,
	}, nil
}

func (client *Client) getJSON(ctx context.Context, token string, path string, dest any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, client.baseURL+path, nil)
	if err != nil {
		return err
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := client.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= http.StatusBadRequest {
		if resp.StatusCode == http.StatusNotFound {
			return nil
		}
		return fmt.Errorf("wazuh api returned %s for %s", resp.Status, path)
	}
	return json.NewDecoder(resp.Body).Decode(dest)
}

func filterEmpty(values []string) []string {
	filtered := make([]string, 0, len(values))
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed != "" {
			filtered = append(filtered, trimmed)
		}
	}
	return filtered
}

func tokenExpiry(token string) time.Time {
	parts := strings.Split(token, ".")
	if len(parts) < 2 {
		return time.Time{}
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return time.Time{}
	}
	var claims struct {
		Exp int64 `json:"exp"`
	}
	if err := json.Unmarshal(payload, &claims); err != nil || claims.Exp <= 0 {
		return time.Time{}
	}
	expiresAt := time.Unix(claims.Exp, 0).UTC().Add(-30 * time.Second)
	if expiresAt.Before(time.Now().UTC()) {
		return time.Time{}
	}
	return expiresAt
}

func (client *Client) authToken(ctx context.Context) (string, error) {
	if client.username == "" && client.password == "" {
		return "", nil
	}

	client.mu.Lock()
	defer client.mu.Unlock()

	if client.token != "" && time.Now().UTC().Before(client.tokenExpiry) {
		return client.token, nil
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, client.baseURL+"/security/user/authenticate", nil)
	if err != nil {
		return "", err
	}
	req.SetBasicAuth(client.username, client.password)

	resp, err := client.httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= http.StatusBadRequest {
		var payload struct {
			Title  string `json:"title"`
			Detail string `json:"detail"`
		}
		if decodeErr := json.NewDecoder(resp.Body).Decode(&payload); decodeErr == nil && strings.TrimSpace(payload.Detail) != "" {
			return "", fmt.Errorf("wazuh auth failed: %s", payload.Detail)
		}
		return "", fmt.Errorf("wazuh auth failed: %s", resp.Status)
	}

	var payload struct {
		Data struct {
			Token string `json:"token"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return "", err
	}
	if strings.TrimSpace(payload.Data.Token) == "" {
		return "", fmt.Errorf("wazuh auth failed: empty token")
	}

	client.token = strings.TrimSpace(payload.Data.Token)
	client.tokenExpiry = tokenExpiry(client.token)
	if client.tokenExpiry.IsZero() {
		client.tokenExpiry = time.Now().UTC().Add(9 * time.Minute)
	}
	return client.token, nil
}
