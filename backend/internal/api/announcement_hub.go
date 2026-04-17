package api

import (
	"encoding/json"
	"sync"

	"github.com/gorilla/websocket"
)

type announcementEnvelope struct {
	Type      string `json:"type"`
	ID        string `json:"id,omitempty"`
	Title     string `json:"title,omitempty"`
	Audience  string `json:"audience,omitempty"`
	Urgent    bool   `json:"urgent,omitempty"`
	CreatedAt string `json:"createdAt,omitempty"`
}

type announcementHub struct {
	mu          sync.RWMutex
	subscribers map[string]map[*websocket.Conn]struct{}
}

func newAnnouncementHub() *announcementHub {
	return &announcementHub{subscribers: make(map[string]map[*websocket.Conn]struct{})}
}

func (hub *announcementHub) subscribe(audience string, conn *websocket.Conn) {
	hub.mu.Lock()
	defer hub.mu.Unlock()
	if hub.subscribers[audience] == nil {
		hub.subscribers[audience] = make(map[*websocket.Conn]struct{})
	}
	hub.subscribers[audience][conn] = struct{}{}
}

func (hub *announcementHub) unsubscribe(audience string, conn *websocket.Conn) {
	hub.mu.Lock()
	defer hub.mu.Unlock()
	listeners := hub.subscribers[audience]
	if listeners == nil {
		return
	}
	delete(listeners, conn)
	if len(listeners) == 0 {
		delete(hub.subscribers, audience)
	}
}

func (hub *announcementHub) publish(audience string, envelope announcementEnvelope) {
	payload, err := json.Marshal(envelope)
	if err != nil {
		return
	}

	hub.mu.RLock()
	listeners := make([]*websocket.Conn, 0, len(hub.subscribers[audience]))
	for conn := range hub.subscribers[audience] {
		listeners = append(listeners, conn)
	}
	hub.mu.RUnlock()

	for _, conn := range listeners {
		if err := conn.WriteMessage(websocket.TextMessage, payload); err != nil {
			hub.unsubscribe(audience, conn)
			_ = conn.Close()
		}
	}
}
