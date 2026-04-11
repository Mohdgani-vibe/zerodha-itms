package saltstack

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

type Client struct {
	baseURL    string
	token      string
	username   string
	password   string
	eauth      string
	targetType string
	httpClient *http.Client
	mu         sync.Mutex
	session    string
	expiresAt  time.Time
}

func NewClient(baseURL string, token string, username string, password string, eauth string, targetType string) *Client {
	return &Client{
		baseURL:    strings.TrimRight(baseURL, "/"),
		token:      token,
		username:   strings.TrimSpace(username),
		password:   password,
		eauth:      firstNonEmpty(strings.TrimSpace(eauth), "pam"),
		targetType: targetType,
		httpClient: &http.Client{
			Timeout: 20 * time.Second,
			CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
				return fmt.Errorf("saltstack redirects are not allowed")
			},
		},
	}
}

func (client *Client) Enabled() bool {
	return client != nil && client.baseURL != "" && (strings.TrimSpace(client.token) != "" || (client.username != "" && client.password != ""))
}

func (client *Client) Available(ctx context.Context) bool {
	if !client.Enabled() {
		return false
	}

	if client.token == "" {
		_, err := client.sessionToken(ctx)
		return err == nil
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, client.baseURL+"/", bytes.NewReader(nil))
	if err != nil {
		return false
	}
	req.Header.Set("Authorization", "Bearer "+client.token)

	resp, err := client.httpClient.Do(req)
	if err != nil {
		return false
	}
	defer resp.Body.Close()

	return resp.StatusCode < http.StatusBadRequest
}

func (client *Client) RunPatch(ctx context.Context, target string) (map[string]any, error) {
	return client.RunState(ctx, target, "patch.run")
}

func (client *Client) TargetConnected(ctx context.Context, target string) (bool, error) {
	if !client.Enabled() {
		return false, nil
	}

	payload := client.withInlineEAuth(map[string]any{
		"client":    "local",
		"tgt":       target,
		"expr_form": client.targetType,
		"fun":       "test.ping",
	})

	var result struct {
		Return []map[string]any `json:"return"`
	}
	if err := client.doJSON(ctx, http.MethodPost, "/run", payload, &result); err != nil {
		return false, err
	}

	for _, item := range result.Return {
		if len(item) == 0 {
			continue
		}
		if value, ok := item[target]; ok {
			if connected, ok := value.(bool); ok {
				return connected, nil
			}
			return true, nil
		}
		return true, nil
	}

	return false, nil
	}

func (client *Client) RunState(ctx context.Context, target string, state string) (map[string]any, error) {
	if !client.Enabled() {
		return nil, fmt.Errorf("saltstack integration is not configured")
	}

	payload := client.withInlineEAuth(map[string]any{
		"client":    "local",
		"tgt":       target,
		"expr_form": client.targetType,
		"fun":       "state.apply",
		"arg":       []string{state},
	})

	var result map[string]any
	if err := client.doJSON(ctx, http.MethodPost, "/run", payload, &result); err != nil {
		return nil, err
	}
	return result, nil
}

func (client *Client) BuildTerminalURL(target string) string {
	if !client.Enabled() {
		return ""
	}
	parsed, err := url.Parse(client.baseURL)
	if err != nil {
		return client.baseURL + "/terminal/" + target
	}
	parsed.Path = strings.TrimRight(parsed.Path, "/") + "/terminal/" + target
	return parsed.String()
}

func (client *Client) doJSON(ctx context.Context, method string, path string, body any, out any) error {
	var encoded []byte
	var requestBody *bytes.Reader
	if body != nil {
		var err error
		encoded, err = json.Marshal(body)
		if err != nil {
			return err
		}
		requestBody = bytes.NewReader(encoded)
	} else {
		requestBody = bytes.NewReader(nil)
	}

	req, err := http.NewRequestWithContext(ctx, method, client.baseURL+path, requestBody)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	if client.token != "" {
		req.Header.Set("Authorization", "Bearer "+client.token)
	} else if !client.usesInlineEAuth(path, body) {
		token, err := client.sessionToken(ctx)
		if err != nil {
			return err
		}
		req.Header.Set("X-Auth-Token", token)
	}

	resp, err := client.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusUnauthorized && client.token == "" && !client.usesInlineEAuth(path, body) {
		client.clearSessionToken()
		token, err := client.sessionToken(ctx)
		if err != nil {
			return err
		}
		req, err = http.NewRequestWithContext(ctx, method, client.baseURL+path, bytes.NewReader(encoded))
		if err != nil {
			return err
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Auth-Token", token)
		resp.Body.Close()
		resp, err = client.httpClient.Do(req)
		if err != nil {
			return err
		}
		defer resp.Body.Close()
	}

	if resp.StatusCode >= http.StatusBadRequest {
		return fmt.Errorf("saltstack api returned %s", resp.Status)
	}

	if out == nil {
		return nil
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

func (client *Client) sessionToken(ctx context.Context) (string, error) {
	client.mu.Lock()
	if client.session != "" && time.Now().Before(client.expiresAt) {
		token := client.session
		client.mu.Unlock()
		return token, nil
	}
	client.mu.Unlock()

	payload := map[string]any{
		"username": client.username,
		"password": client.password,
		"eauth":    firstNonEmpty(client.eauth, "pam"),
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, client.baseURL+"/login", bytes.NewReader(encoded))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := client.httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= http.StatusBadRequest {
		return "", fmt.Errorf("saltstack login returned %s", resp.Status)
	}

	var loginResponse struct {
		Return []struct {
			Token  string  `json:"token"`
			Expire float64 `json:"expire"`
		} `json:"return"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&loginResponse); err != nil {
		return "", err
	}
	if len(loginResponse.Return) == 0 || strings.TrimSpace(loginResponse.Return[0].Token) == "" {
		return "", fmt.Errorf("saltstack login did not return a token")
	}

	expiresAt := time.Now().Add(8 * time.Hour)
	if loginResponse.Return[0].Expire > 0 {
		expiresAt = time.Unix(int64(loginResponse.Return[0].Expire), 0)
	}

	client.mu.Lock()
	client.session = strings.TrimSpace(loginResponse.Return[0].Token)
	client.expiresAt = expiresAt.Add(-1 * time.Minute)
	token := client.session
	client.mu.Unlock()

	return token, nil
}

func (client *Client) clearSessionToken() {
	client.mu.Lock()
	defer client.mu.Unlock()
	client.session = ""
	client.expiresAt = time.Time{}
}

func (client *Client) withInlineEAuth(payload map[string]any) map[string]any {
	if client == nil || client.token != "" {
		return payload
	}
	clone := make(map[string]any, len(payload)+3)
	for key, value := range payload {
		clone[key] = value
	}
	clone["username"] = client.username
	clone["password"] = client.password
	clone["eauth"] = firstNonEmpty(client.eauth, "pam")
	return clone
}

func (client *Client) usesInlineEAuth(path string, body any) bool {
	if client == nil || client.token != "" || path != "/run" {
		return false
	}
	_, ok := body.(map[string]any)
	return ok
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}