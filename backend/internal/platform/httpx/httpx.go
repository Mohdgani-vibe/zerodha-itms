package httpx

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

func JSON(c *gin.Context, status int, payload any) {
	c.JSON(status, payload)
}

func Error(c *gin.Context, status int, message string) {
	c.JSON(status, gin.H{"error": message})
	c.Abort()
}

func Created(c *gin.Context, payload any) {
	JSON(c, http.StatusCreated, payload)
}