package api

import (
	"encoding/json"
	"sync"

	"github.com/gorilla/websocket"
)

type chatEnvelope struct {
	Type         string `json:"type"`
	ChannelID    string `json:"channelId,omitempty"`
	MessageID    string `json:"messageId,omitempty"`
	AuthorID     string `json:"authorId,omitempty"`
	AuthorName   string `json:"authorName,omitempty"`
	Body         string `json:"body,omitempty"`
	Typing       bool   `json:"typing"`
	CreatedAt    string `json:"createdAt,omitempty"`
	Status       string `json:"status,omitempty"`
	TicketID     string `json:"ticketId,omitempty"`
	TicketNumber string `json:"ticketNumber,omitempty"`
}

type chatHub struct {
	mu          sync.RWMutex
	subscribers map[string]map[*websocket.Conn]struct{}
}

func newChatHub() *chatHub {
	return &chatHub{subscribers: make(map[string]map[*websocket.Conn]struct{})}
}

func (hub *chatHub) subscribe(channelID string, conn *websocket.Conn) {
	hub.mu.Lock()
	defer hub.mu.Unlock()
	if hub.subscribers[channelID] == nil {
		hub.subscribers[channelID] = make(map[*websocket.Conn]struct{})
	}
	hub.subscribers[channelID][conn] = struct{}{}
}

func (hub *chatHub) unsubscribe(channelID string, conn *websocket.Conn) {
	hub.mu.Lock()
	defer hub.mu.Unlock()
	listeners := hub.subscribers[channelID]
	if listeners == nil {
		return
	}
	delete(listeners, conn)
	if len(listeners) == 0 {
		delete(hub.subscribers, channelID)
	}
}

func (hub *chatHub) publish(channelID string, envelope chatEnvelope) {
	payload, err := json.Marshal(envelope)
	if err != nil {
		return
	}

	hub.mu.RLock()
	listeners := make([]*websocket.Conn, 0, len(hub.subscribers[channelID]))
	for conn := range hub.subscribers[channelID] {
		listeners = append(listeners, conn)
	}
	hub.mu.RUnlock()

	for _, conn := range listeners {
		if err := conn.WriteMessage(websocket.TextMessage, payload); err != nil {
			hub.unsubscribe(channelID, conn)
			_ = conn.Close()
		}
	}
}
