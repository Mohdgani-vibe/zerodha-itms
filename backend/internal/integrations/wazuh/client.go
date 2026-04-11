package wazuh

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"
)

type Client struct {
	baseURL    string
	username   string
	password   string
	httpClient *http.Client
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
		baseURL:    strings.TrimRight(baseURL, "/"),
		username:   username,
		password:   password,
		httpClient: &http.Client{
			Timeout: 20 * time.Second,
			Transport: &http.Transport{TLSClientConfig: tlsConfig},
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

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, fmt.Sprintf("%s/agents/%s/alerts?limit=%d", client.baseURL, agentID, limit), nil)
	if err != nil {
		return nil, err
	}
	if client.username != "" || client.password != "" {
		req.SetBasicAuth(client.username, client.password)
	}

	resp, err := client.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= http.StatusBadRequest {
		return nil, fmt.Errorf("wazuh api returned %s", resp.Status)
	}

	var payload struct {
		Data struct {
			AffectedItems []struct {
				ID        string `json:"id"`
				Rule      struct {
					ID          string `json:"id"`
					Level       any    `json:"level"`
					Description string `json:"description"`
				} `json:"rule"`
				FullLog   string `json:"full_log"`
				Timestamp string `json:"timestamp"`
			} `json:"affected_items"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, err
	}

	alerts := make([]AgentAlert, 0, len(payload.Data.AffectedItems))
	for _, item := range payload.Data.AffectedItems {
		alerts = append(alerts, AgentAlert{
			ID:        item.ID,
			RuleID:    item.Rule.ID,
			Level:     fmt.Sprint(item.Rule.Level),
			Title:     item.Rule.Description,
			Detail:    item.FullLog,
			CreatedAt: item.Timestamp,
		})
	}
	return alerts, nil
}