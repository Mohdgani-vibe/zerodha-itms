package authn

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
	"golang.org/x/oauth2"
	googleoauth "golang.org/x/oauth2/google"
)

type Manager struct {
	secret []byte
	ttl    time.Duration
}

type Claims struct {
	UserID   string `json:"user_id"`
	Email    string `json:"email"`
	Role     string `json:"role"`
	EntityID string `json:"entity_id"`
	DeptID   string `json:"dept_id,omitempty"`
	Name     string `json:"name,omitempty"`
	jwt.RegisteredClaims
}

type UserTokenInput struct {
	UserID   string
	EmpID    string
	Email    string
	Role     string
	EntityID string
	DeptID   string
	Name     string
}

var (
	passwordUpperPattern   = regexp.MustCompile(`[A-Z]`)
	passwordLowerPattern   = regexp.MustCompile(`[a-z]`)
	passwordDigitPattern   = regexp.MustCompile(`[0-9]`)
	passwordSymbolPattern  = regexp.MustCompile(`[^A-Za-z0-9]`)
)

func NewManager(secret string, ttl time.Duration) *Manager {
	return &Manager{secret: []byte(secret), ttl: ttl}
}

func (manager *Manager) IssueToken(input UserTokenInput) (string, error) {
	now := time.Now().UTC()
	claims := Claims{
		UserID:   input.UserID,
		Email:    strings.ToLower(input.Email),
		Role:     input.Role,
		EntityID: input.EntityID,
		DeptID:   input.DeptID,
		Name:     input.Name,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   input.EmpID,
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(manager.ttl)),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(manager.secret)
}

func (manager *Manager) ParseToken(raw string) (*Claims, error) {
	token, err := jwt.ParseWithClaims(raw, &Claims{}, func(token *jwt.Token) (any, error) {
		return manager.secret, nil
	})
	if err != nil {
		return nil, err
	}
	claims, ok := token.Claims.(*Claims)
	if !ok || !token.Valid {
		return nil, fmt.Errorf("invalid token claims")
	}
	return claims, nil
}

func (manager *Manager) IssueState(kind string) (string, error) {
	claims := jwt.MapClaims{
		"kind": kind,
		"exp":  time.Now().UTC().Add(10 * time.Minute).Unix(),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(manager.secret)
}

func (manager *Manager) ValidateState(raw string, kind string) error {
	token, err := jwt.Parse(raw, func(token *jwt.Token) (any, error) {
		return manager.secret, nil
	})
	if err != nil {
		return err
	}
	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok || !token.Valid {
		return fmt.Errorf("invalid oauth state")
	}
	if claims["kind"] != kind {
		return fmt.Errorf("unexpected oauth state kind")
	}
	return nil
}

func HashPassword(password string) (string, error) {
	if err := ValidatePasswordStrength(password); err != nil {
		return "", err
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return "", err
	}
	return string(hash), nil
}

func CheckPassword(password string, hash string) error {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
}

func ValidatePasswordStrength(password string) error {
	trimmed := strings.TrimSpace(password)
	if len(trimmed) < 12 {
		return fmt.Errorf("password must be at least 12 characters")
	}
	if len(trimmed) > 128 {
		return fmt.Errorf("password must be at most 128 characters")
	}
	if !passwordUpperPattern.MatchString(trimmed) {
		return fmt.Errorf("password must include at least one uppercase letter")
	}
	if !passwordLowerPattern.MatchString(trimmed) {
		return fmt.Errorf("password must include at least one lowercase letter")
	}
	if !passwordDigitPattern.MatchString(trimmed) {
		return fmt.Errorf("password must include at least one number")
	}
	if !passwordSymbolPattern.MatchString(trimmed) {
		return fmt.Errorf("password must include at least one symbol")
	}
	return nil
}

type GoogleSSO struct {
	config       *oauth2.Config
	hostedDomain string
}

type GoogleProfile struct {
	Sub           string `json:"sub"`
	Email         string `json:"email"`
	VerifiedEmail bool   `json:"verified_email"`
	Name          string `json:"name"`
	HostedDomain  string `json:"hd"`
}

func NewGoogleSSO(clientID string, clientSecret string, redirectURL string, hostedDomain string) *GoogleSSO {
	if clientID == "" || clientSecret == "" || redirectURL == "" {
		return nil
	}
	return &GoogleSSO{
		config: &oauth2.Config{
			ClientID:     clientID,
			ClientSecret: clientSecret,
			RedirectURL:  redirectURL,
			Scopes:       []string{"openid", "email", "profile"},
			Endpoint:     googleoauth.Endpoint,
		},
		hostedDomain: hostedDomain,
	}
}

func (google *GoogleSSO) Enabled() bool {
	return google != nil && google.config != nil
}

func (google *GoogleSSO) AuthCodeURL(state string) string {
	return google.config.AuthCodeURL(state, oauth2.AccessTypeOnline)
}

func (google *GoogleSSO) ExchangeCode(ctx context.Context, code string) (*GoogleProfile, error) {
	token, err := google.config.Exchange(ctx, code)
	if err != nil {
		return nil, fmt.Errorf("exchange google oauth code: %w", err)
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://openidconnect.googleapis.com/v1/userinfo", nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Authorization", "Bearer "+token.AccessToken)

	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return nil, fmt.Errorf("fetch google userinfo: %w", err)
	}
	defer response.Body.Close()

	if response.StatusCode >= http.StatusBadRequest {
		return nil, fmt.Errorf("google userinfo returned status %d", response.StatusCode)
	}

	var profile GoogleProfile
	if err := json.NewDecoder(response.Body).Decode(&profile); err != nil {
		return nil, fmt.Errorf("decode google userinfo: %w", err)
	}
	if google.hostedDomain != "" && !strings.EqualFold(profile.HostedDomain, google.hostedDomain) {
		return nil, fmt.Errorf("non-zerodha domain is not allowed")
	}
	return &profile, nil
}