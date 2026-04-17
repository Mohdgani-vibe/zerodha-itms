package middleware

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

type contextKey string

const userContextKey contextKey = "itms-user"

type Identity struct {
	ID    string `json:"id"`
	Email string `json:"email"`
	Name  string `json:"fullName"`
	Role  string `json:"role"`
	Branch string `json:"branch,omitempty"`
	Token string `json:"-"`
}

type Authenticator struct {
	secret []byte
	db     *sql.DB
}

type claims struct {
	UserID string `json:"uid"`
	Email  string `json:"email"`
	Role   string `json:"role"`
	Name   string `json:"name"`
	Branch string `json:"branch,omitempty"`
	jwt.RegisteredClaims
}

func NewAuthenticator(secret string, db *sql.DB) *Authenticator {
	return &Authenticator{secret: []byte(secret), db: db}
}

func (a *Authenticator) IssueAccessToken(user Identity) (string, error) {
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims{
		UserID: user.ID,
		Email:  user.Email,
		Role:   user.Role,
		Name:   user.Name,
		Branch: user.Branch,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(8 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			Subject:   user.ID,
		},
	})

	return token.SignedString(a.secret)
}

func (a *Authenticator) IssueRefreshToken(userID string) (string, error) {
	token := RandomID()
	_, err := a.db.Exec(`INSERT INTO refresh_tokens (id, user_id, token, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`, RandomID(), userID, token, time.Now().Add(7*24*time.Hour).Format(time.RFC3339), time.Now().UTC().Format(time.RFC3339))
	return token, err
}

func (a *Authenticator) ExchangeRefreshToken(refreshToken string) (Identity, string, string, error) {
	identity := Identity{}
	err := a.db.QueryRow(`
		SELECT u.id, u.email, u.full_name, r.name
		FROM refresh_tokens t
		JOIN users u ON u.id = t.user_id
		JOIN roles r ON r.id = u.role_id
		WHERE t.token = ? AND t.expires_at > ?
	`, refreshToken, time.Now().UTC().Format(time.RFC3339)).Scan(&identity.ID, &identity.Email, &identity.Name, &identity.Role)
	if err != nil {
		return identity, "", "", err
	}

	accessToken, err := a.IssueAccessToken(identity)
	if err != nil {
		return identity, "", "", err
	}

	newRefreshToken, err := a.IssueRefreshToken(identity.ID)
	if err != nil {
		return identity, "", "", err
	}

	_, _ = a.db.Exec(`DELETE FROM refresh_tokens WHERE token = ?`, refreshToken)

	return identity, accessToken, newRefreshToken, nil
}

func (a *Authenticator) RevokeRefreshTokens(userID string) error {
	_, err := a.db.Exec(`DELETE FROM refresh_tokens WHERE user_id = ?`, userID)
	return err
}

func (a *Authenticator) Authenticate(next http.HandlerFunc) http.HandlerFunc {
	return func(writer http.ResponseWriter, request *http.Request) {
		header := request.Header.Get("Authorization")
		if !strings.HasPrefix(header, "Bearer ") {
			ErrorJSON(writer, http.StatusUnauthorized, "Missing bearer token")
			return
		}

		rawToken := strings.TrimPrefix(header, "Bearer ")
		token, err := jwt.ParseWithClaims(rawToken, &claims{}, func(token *jwt.Token) (any, error) {
			return a.secret, nil
		})
		if err != nil || !token.Valid {
			ErrorJSON(writer, http.StatusUnauthorized, "Invalid access token")
			return
		}

		parsedClaims, ok := token.Claims.(*claims)
		if !ok {
			ErrorJSON(writer, http.StatusUnauthorized, "Invalid token claims")
			return
		}

		identity := Identity{ID: parsedClaims.UserID, Email: parsedClaims.Email, Name: parsedClaims.Name, Role: parsedClaims.Role, Branch: parsedClaims.Branch, Token: rawToken}
		ctx := context.WithValue(request.Context(), userContextKey, identity)
		next.ServeHTTP(writer, request.WithContext(ctx))
	}
}

func (a *Authenticator) Require(next http.HandlerFunc, allowedRoles ...string) http.HandlerFunc {
	return a.Authenticate(func(writer http.ResponseWriter, request *http.Request) {
		if len(allowedRoles) == 0 {
			next.ServeHTTP(writer, request)
			return
		}

		identity, ok := CurrentUser(request.Context())
		if !ok || !slices.Contains(allowedRoles, identity.Role) {
			ErrorJSON(writer, http.StatusForbidden, "Forbidden")
			return
		}

		next.ServeHTTP(writer, request)
	})
}

func CurrentUser(ctx context.Context) (Identity, bool) {
	identity, ok := ctx.Value(userContextKey).(Identity)
	return identity, ok
}

func ReadJSON[T any](request *http.Request) (T, error) {
	var payload T
	if request.Body == nil {
		return payload, errors.New("empty body")
	}
	err := json.NewDecoder(request.Body).Decode(&payload)
	return payload, err
}

func WriteJSON(writer http.ResponseWriter, status int, payload any) {
	writer.Header().Set("Content-Type", "application/json")
	writer.WriteHeader(status)
	_ = json.NewEncoder(writer).Encode(payload)
}

func ErrorJSON(writer http.ResponseWriter, status int, message string) {
	WriteJSON(writer, status, map[string]string{"error": message})
}

func RandomID() string {
	buffer := make([]byte, 16)
	_, _ = rand.Read(buffer)
	return hex.EncodeToString(buffer)
}