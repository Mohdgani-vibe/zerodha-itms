package app

import (
	"fmt"
	"net"
	"net/url"
	"os"
	"strings"
	"time"
)

const (
	defaultJWTSecret        = "change-me-in-production"
	defaultAdminPassword    = "ChangeMe123!"
	minimumRecommendedJWTLen = 32
)

type Config struct {
	Address                          string
	EnforceSecurity                  bool
	FrontendOrigin                   string
	DatabaseURL                      string
	MigrationDir                     string
	InventorySyncEnabled             bool
	InventorySyncSourceType          string
	InventorySyncSourceURL           string
	InventorySyncSourceToken         string
	InventoryIngestToken             string
	InventorySyncInterval            time.Duration
	InventorySyncRunOnStartup        bool
	InventorySyncDefaultEntityID     string
	InventorySyncDefaultDeptID       string
	InventorySyncDefaultLocationID   string
	PublicServerURL                  string
	SaltMasterHost                   string
	WazuhManagerHost                 string
	JWTSecret                        string
	JWTTTL                           time.Duration
	SaltAPIBaseURL                   string
	SaltAPIToken                     string
	SaltAPIUsername                  string
	SaltAPIPassword                  string
	SaltAPIEAuth                     string
	SaltTargetType                   string
	SaltAgentInstallState            string
	SaltAgentInstallUbuntuState      string
	SaltAgentInstallWindowsState     string
	SaltInventoryRefreshState        string
	SaltInventoryRefreshUbuntuState  string
	SaltInventoryRefreshWindowsState string
	WazuhAPIBaseURL                  string
	WazuhAPIUsername                 string
	WazuhAPIPassword                 string
	WazuhAPICAFile                   string
	WazuhAPIInsecureSkipVerify       bool
	GoogleClientID                   string
	GoogleClientSecret               string
	GoogleRedirectURL                string
	GoogleHostedDomain               string
	DefaultAdminEmail                string
	DefaultAdminPassword             string
	DefaultAdminName                 string
}

func LoadConfig() (Config, error) {
	ttl, err := time.ParseDuration(getEnv("JWT_TTL", "24h"))
	if err != nil {
		return Config{}, fmt.Errorf("parse JWT_TTL: %w", err)
	}
	inventorySyncInterval, err := time.ParseDuration(getEnv("INVENTORY_SYNC_INTERVAL", "24h"))
	if err != nil {
		return Config{}, fmt.Errorf("parse INVENTORY_SYNC_INTERVAL: %w", err)
	}

	return Config{
		Address:                          getEnv("BACKEND_ADDR", ":3001"),
		EnforceSecurity:                  strings.EqualFold(getEnv("ITMS_ENFORCE_SECURITY", "false"), "true"),
		FrontendOrigin:                   getEnv("FRONTEND_ORIGIN", "http://localhost:5173"),
		DatabaseURL:                      getEnv("DATABASE_URL", "postgres://postgres:postgres@localhost:5432/itms?sslmode=disable"),
		MigrationDir:                     getEnv("MIGRATION_DIR", "db/postgres_migrations"),
		InventorySyncEnabled:             strings.EqualFold(getEnv("INVENTORY_SYNC_ENABLED", "false"), "true"),
		InventorySyncSourceType:          strings.ToLower(getEnv("INVENTORY_SYNC_SOURCE_TYPE", "json")),
		InventorySyncSourceURL:           strings.TrimSpace(getEnv("INVENTORY_SYNC_SOURCE_URL", "")),
		InventorySyncSourceToken:         strings.TrimSpace(os.Getenv("INVENTORY_SYNC_SOURCE_TOKEN")),
		InventoryIngestToken:             strings.TrimSpace(os.Getenv("INVENTORY_INGEST_TOKEN")),
		InventorySyncInterval:            inventorySyncInterval,
		InventorySyncRunOnStartup:        strings.EqualFold(getEnv("INVENTORY_SYNC_RUN_ON_STARTUP", "false"), "true"),
		InventorySyncDefaultEntityID:     strings.TrimSpace(getEnv("INVENTORY_SYNC_DEFAULT_ENTITY_ID", "")),
		InventorySyncDefaultDeptID:       strings.TrimSpace(getEnv("INVENTORY_SYNC_DEFAULT_DEPT_ID", "")),
		InventorySyncDefaultLocationID:   strings.TrimSpace(getEnv("INVENTORY_SYNC_DEFAULT_LOCATION_ID", "")),
		PublicServerURL:                  strings.TrimRight(strings.TrimSpace(getEnv("PUBLIC_SERVER_URL", "")), "/"),
		SaltMasterHost:                   strings.TrimSpace(getEnv("SALT_MASTER_HOST", "")),
		WazuhManagerHost:                 strings.TrimSpace(getEnv("WAZUH_MANAGER_HOST", "")),
		JWTSecret:                        getEnv("JWT_SECRET", "change-me-in-production"),
		JWTTTL:                           ttl,
		SaltAPIBaseURL:                   strings.TrimRight(getEnv("SALT_API_BASE_URL", ""), "/"),
		SaltAPIToken:                     os.Getenv("SALT_API_TOKEN"),
		SaltAPIUsername:                  os.Getenv("SALT_API_USERNAME"),
		SaltAPIPassword:                  os.Getenv("SALT_API_PASSWORD"),
		SaltAPIEAuth:                     getEnv("SALT_API_EAUTH", "pam"),
		SaltTargetType:                   getEnv("SALT_TARGET_TYPE", "glob"),
		SaltAgentInstallState:            getEnv("SALT_AGENT_INSTALL_STATE", "itms_agent.install"),
		SaltAgentInstallUbuntuState:      getEnv("SALT_AGENT_INSTALL_UBUNTU_STATE", "itms_agent.ubuntu"),
		SaltAgentInstallWindowsState:     getEnv("SALT_AGENT_INSTALL_WINDOWS_STATE", "itms_agent.windows"),
		SaltInventoryRefreshState:        getEnv("SALT_INVENTORY_REFRESH_STATE", "itms_inventory.refresh"),
		SaltInventoryRefreshUbuntuState:  getEnv("SALT_INVENTORY_REFRESH_UBUNTU_STATE", "itms_inventory.ubuntu"),
		SaltInventoryRefreshWindowsState: getEnv("SALT_INVENTORY_REFRESH_WINDOWS_STATE", "itms_inventory.windows"),
		WazuhAPIBaseURL:                  strings.TrimRight(getEnv("WAZUH_API_BASE_URL", ""), "/"),
		WazuhAPIUsername:                 os.Getenv("WAZUH_API_USERNAME"),
		WazuhAPIPassword:                 os.Getenv("WAZUH_API_PASSWORD"),
		WazuhAPICAFile:                   strings.TrimSpace(getEnv("WAZUH_API_CA_FILE", "")),
		WazuhAPIInsecureSkipVerify:       strings.EqualFold(getEnv("WAZUH_API_INSECURE_SKIP_VERIFY", "false"), "true"),
		GoogleClientID:                   os.Getenv("GOOGLE_CLIENT_ID"),
		GoogleClientSecret:               os.Getenv("GOOGLE_CLIENT_SECRET"),
		GoogleRedirectURL:                getEnv("GOOGLE_REDIRECT_URL", "http://localhost:3001/api/auth/google/callback"),
		GoogleHostedDomain:               getEnv("GOOGLE_HOSTED_DOMAIN", "zerodha.com"),
		DefaultAdminEmail:                getEnv("DEFAULT_ADMIN_EMAIL", "gani@zerodha.com"),
		DefaultAdminPassword:             getEnv("DEFAULT_ADMIN_PASSWORD", "ChangeMe123!"),
		DefaultAdminName:                 getEnv("DEFAULT_ADMIN_NAME", "Gani"),
	}, nil
}

func (config Config) FrontendOrigins() []string {
	origins := make([]string, 0)
	for _, candidate := range strings.Split(config.FrontendOrigin, ",") {
		trimmed := strings.TrimSpace(candidate)
		if trimmed != "" {
			origins = append(origins, trimmed)
		}
	}
	return origins
}

func (config Config) SecurityWarnings() []string {
	warnings := make([]string, 0, 4)
	if strings.TrimSpace(config.JWTSecret) == "" || strings.TrimSpace(config.JWTSecret) == defaultJWTSecret {
		warnings = append(warnings, "JWT_SECRET is using the default insecure value; set a long random secret before exposing the service")
	} else if len(strings.TrimSpace(config.JWTSecret)) < minimumRecommendedJWTLen {
		warnings = append(warnings, "JWT_SECRET is shorter than 32 characters; use a longer random secret")
	}
	if strings.TrimSpace(config.DefaultAdminPassword) == defaultAdminPassword {
		warnings = append(warnings, "DEFAULT_ADMIN_PASSWORD is still using the seeded default; rotate it immediately")
	}
	if config.InventorySyncEnabled && strings.TrimSpace(config.InventoryIngestToken) == "" {
		warnings = append(warnings, "INVENTORY_SYNC_ENABLED is true but INVENTORY_INGEST_TOKEN is empty; ingest endpoint cannot be safely exposed")
	}
	if config.isExternalURL(config.PublicServerURL) && strings.HasPrefix(strings.ToLower(strings.TrimSpace(config.PublicServerURL)), "http://") {
		warnings = append(warnings, "PUBLIC_SERVER_URL is using http:// on a non-local host; use HTTPS in production")
	}
	if config.GoogleClientID != "" && config.isExternalURL(config.GoogleRedirectURL) && strings.HasPrefix(strings.ToLower(strings.TrimSpace(config.GoogleRedirectURL)), "http://") {
		warnings = append(warnings, "GOOGLE_REDIRECT_URL is using http:// on a non-local host; use HTTPS in production")
	}
	if config.WazuhAPIInsecureSkipVerify {
		warnings = append(warnings, "WAZUH_API_INSECURE_SKIP_VERIFY is enabled; TLS certificate verification is disabled")
	} else if strings.TrimSpace(config.WazuhAPIBaseURL) != "" && strings.HasPrefix(strings.ToLower(strings.TrimSpace(config.WazuhAPIBaseURL)), "https://") && strings.TrimSpace(config.WazuhAPICAFile) == "" {
		warnings = append(warnings, "WAZUH_API_CA_FILE is not set; self-signed internal Wazuh deployments may fail TLS verification unless the CA is trusted by the system")
	}
	if config.looksLikeDefaultDatabaseURL() {
		warnings = append(warnings, "DATABASE_URL appears to use default postgres credentials or sslmode=disable; review database transport security")
	}
	return warnings
}

func (config Config) SecurityErrors() []string {
	if !config.EnforceSecurity {
		return nil
	}

	errors := make([]string, 0, 6)
	if strings.TrimSpace(config.JWTSecret) == "" || strings.TrimSpace(config.JWTSecret) == defaultJWTSecret || len(strings.TrimSpace(config.JWTSecret)) < minimumRecommendedJWTLen {
		errors = append(errors, "JWT_SECRET must be set to a non-default random value with at least 32 characters")
	}
	if strings.TrimSpace(config.DefaultAdminPassword) == "" || strings.TrimSpace(config.DefaultAdminPassword) == defaultAdminPassword {
		errors = append(errors, "DEFAULT_ADMIN_PASSWORD must be changed from the seeded default")
	}
	if config.InventorySyncEnabled && strings.TrimSpace(config.InventoryIngestToken) == "" {
		errors = append(errors, "INVENTORY_INGEST_TOKEN is required when inventory sync is enabled")
	}
	if config.isExternalURL(config.PublicServerURL) && strings.HasPrefix(strings.ToLower(strings.TrimSpace(config.PublicServerURL)), "http://") {
		errors = append(errors, "PUBLIC_SERVER_URL must use HTTPS for non-local deployments")
	}
	if config.GoogleClientID != "" && config.isExternalURL(config.GoogleRedirectURL) && strings.HasPrefix(strings.ToLower(strings.TrimSpace(config.GoogleRedirectURL)), "http://") {
		errors = append(errors, "GOOGLE_REDIRECT_URL must use HTTPS for non-local deployments")
	}
	if config.WazuhAPIInsecureSkipVerify {
		errors = append(errors, "WAZUH_API_INSECURE_SKIP_VERIFY must be false when ITMS_ENFORCE_SECURITY=true")
	}
	return errors
}

func (config Config) isExternalURL(rawValue string) bool {
	parsed, err := url.Parse(strings.TrimSpace(rawValue))
	if err != nil || parsed.Hostname() == "" {
		return false
	}
	host := strings.ToLower(strings.TrimSpace(parsed.Hostname()))
	if host == "localhost" || host == "127.0.0.1" || host == "::1" {
		return false
	}
	ip := net.ParseIP(host)
	if ip == nil {
		return true
	}
	if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() {
		return false
	}
	return true
}

func (config Config) looksLikeDefaultDatabaseURL() bool {
	value := strings.ToLower(strings.TrimSpace(config.DatabaseURL))
	if value == "" {
		return false
	}
	return strings.Contains(value, "postgres:postgres@") || strings.Contains(value, "sslmode=disable")
}

func getEnv(key string, fallback string) string {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	return value
}
