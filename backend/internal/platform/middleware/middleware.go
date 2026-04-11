package middleware

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"net/http"
	"slices"
	"strings"

	"github.com/gin-gonic/gin"

	"itms/backend/internal/platform/authn"
	"itms/backend/internal/platform/httpx"
)

const (
	ClaimsKey    = "claims"
	AuditMetaKey = "audit_meta"
	AuditBodyKey = "audit_body"
)

type AuditMeta struct {
	Action     string
	TargetType string
	TargetID   string
	Detail     any
	ActorID    string
	EntityID   string
	AuthMethod string
}

func CORS(origin string) gin.HandlerFunc {
	allowedOrigins := make([]string, 0)
	for _, candidate := range strings.Split(origin, ",") {
		trimmed := strings.TrimSpace(candidate)
		if trimmed != "" {
			allowedOrigins = append(allowedOrigins, trimmed)
		}
	}

	return func(c *gin.Context) {
		requestOrigin := strings.TrimSpace(c.GetHeader("Origin"))
		if requestOrigin != "" {
			if len(allowedOrigins) > 0 && !slices.Contains(allowedOrigins, requestOrigin) {
				c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "origin not allowed"})
				return
			}
			c.Header("Access-Control-Allow-Origin", requestOrigin)
			c.Header("Vary", "Origin")
		}
		c.Header("Access-Control-Allow-Headers", "Authorization, Content-Type")
		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	}
}

func AuthRequired(manager *authn.Manager) gin.HandlerFunc {
	return func(c *gin.Context) {
		header := c.GetHeader("Authorization")
		if !strings.HasPrefix(header, "Bearer ") {
			httpx.Error(c, http.StatusUnauthorized, "missing bearer token")
			return
		}
		claims, err := manager.ParseToken(strings.TrimPrefix(header, "Bearer "))
		if err != nil {
			httpx.Error(c, http.StatusUnauthorized, "invalid token")
			return
		}
		c.Set(ClaimsKey, claims)
		c.Next()
	}
}

func Audit(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.Request.Method == http.MethodPost || c.Request.Method == http.MethodPatch || c.Request.Method == http.MethodDelete {
			if body, err := c.GetRawData(); err == nil && len(body) > 0 {
				c.Set(AuditBodyKey, string(body))
				c.Request.Body = ioNopCloser(bytes.NewBuffer(body))
			}
		}

		c.Next()

		if c.Writer.Status() >= http.StatusBadRequest {
			return
		}
		value, exists := c.Get(AuditMetaKey)
		if !exists {
			return
		}
		meta, ok := value.(AuditMeta)
		if !ok || meta.Action == "" {
			return
		}

		claims := CurrentClaims(c)
		actorID := meta.ActorID
		entityID := meta.EntityID
		if actorID == "" && claims != nil {
			actorID = claims.UserID
		}
		if entityID == "" && claims != nil {
			entityID = claims.EntityID
		}

		detail := meta.Detail
		if detail == nil {
			if body, exists := c.Get(AuditBodyKey); exists {
				detail = gin.H{"request": body}
			}
		}
		payload, _ := json.Marshal(detail)

		_, _ = db.Exec(`
			INSERT INTO audit_log (actor_id, entity_id, action, target_type, target_id, detail, ip_address, auth_method)
			VALUES (NULLIF($1, '')::uuid, NULLIF($2, '')::uuid, $3, $4, NULLIF($5, '')::uuid, $6::jsonb, NULLIF($7, '')::inet, $8)
		`, actorID, entityID, meta.Action, meta.TargetType, meta.TargetID, string(payload), clientIP(c), meta.AuthMethod)
	}
}

func CurrentClaims(c *gin.Context) *authn.Claims {
	value, exists := c.Get(ClaimsKey)
	if !exists {
		return nil
	}
	claims, ok := value.(*authn.Claims)
	if !ok {
		return nil
	}
	return claims
}

func TagAudit(c *gin.Context, meta AuditMeta) {
	c.Set(AuditMetaKey, meta)
}

func RequireRoles(c *gin.Context, allowed ...string) bool {
	claims := CurrentClaims(c)
	if claims == nil {
		httpx.Error(c, http.StatusUnauthorized, "unauthorized")
		return false
	}
	for _, role := range allowed {
		if claims.Role == role {
			return true
		}
	}
	httpx.Error(c, http.StatusForbidden, "forbidden")
	return false
}

func clientIP(c *gin.Context) string {
	forwarded := c.GetHeader("X-Forwarded-For")
	if forwarded != "" {
		parts := strings.Split(forwarded, ",")
		return strings.TrimSpace(parts[0])
	}
	return c.ClientIP()
}

type nopCloser struct {
	*bytes.Buffer
}

func ioNopCloser(buffer *bytes.Buffer) *nopCloser {
	return &nopCloser{Buffer: buffer}
}

func (closer *nopCloser) Close() error {
	return nil
}
