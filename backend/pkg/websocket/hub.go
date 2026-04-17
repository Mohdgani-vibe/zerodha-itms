package websocket

import (
	"sync"

	gw "github.com/gorilla/websocket"
)

type Envelope struct {
	Type      string `json:"type"`
	ChannelID string `json:"channelId"`
	MessageID string `json:"messageId,omitempty"`
	AuthorID  string `json:"authorId,omitempty"`
	Body      string `json:"body,omitempty"`
	CreatedAt string `json:"createdAt,omitempty"`
}

type Hub struct {
	mu          sync.RWMutex
	subscribers map[string]map[*gw.Conn]struct{}
	broadcast   chan Envelope
}

func NewHub() *Hub {
	return &Hub{
		subscribers: map[string]map[*gw.Conn]struct{}{},
		broadcast:   make(chan Envelope, 64),
	}
}

func (h *Hub) Run() {
	for message := range h.broadcast {
		h.mu.RLock()
		channelSubscribers := h.subscribers[message.ChannelID]
		for conn := range channelSubscribers {
			_ = conn.WriteJSON(message)
		}
		h.mu.RUnlock()
	}
}

func (h *Hub) Subscribe(channelID string, conn *gw.Conn) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.subscribers[channelID] == nil {
		h.subscribers[channelID] = map[*gw.Conn]struct{}{}
	}
	h.subscribers[channelID][conn] = struct{}{}
}

func (h *Hub) Unsubscribe(channelID string, conn *gw.Conn) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.subscribers[channelID] == nil {
		return
	}
	delete(h.subscribers[channelID], conn)
	if len(h.subscribers[channelID]) == 0 {
		delete(h.subscribers, channelID)
	}
}

func (h *Hub) Publish(message Envelope) {
	h.broadcast <- message
}