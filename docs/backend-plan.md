# Backend Plan

## Current Foundation

- Frontend: React + TypeScript + Vite
- Backend: Go + net/http + SQLite
- API base path: `/api`
- Frontend dev port: `5800`
- Backend dev port: `3001`

## Existing Go API Scope

- `POST /api/auth/login`
- `GET /api/health`
- `GET /api/users`
- `GET /api/users/meta/options`
- `GET /api/users/:id`
- `PATCH /api/users/:id`
- `GET /api/devices`
- `GET /api/devices/:id`
- `GET /api/patch/dashboard`
- `GET /api/patch/devices`

## Remaining Modules To Build

### 1. Stock

Schema:
- `stock_items`
- `stock_movements`
- `vendors`

API:
- `GET /api/stock`
- `POST /api/stock`
- `PATCH /api/stock/:id`
- `GET /api/stock/filters`

Frontend tasks:
- Replace in-memory inventory
- Load branch/category filters from API
- Persist item creation and status changes

### 2. Gatepass

Schema:
- `gatepasses`
- `gatepass_assets`
- `gatepass_documents`

API:
- `GET /api/gatepasses`
- `POST /api/gatepasses`
- `PATCH /api/gatepasses/:id/status`
- `GET /api/gatepasses/:id`

Frontend tasks:
- Replace mock employee and inventory lookup
- Persist create/pending/completed states
- Add signed document metadata flow

### 3. Chat

Schema:
- `chat_tickets`
- `chat_messages`
- `chat_assignments`

API:
- `GET /api/chat/tickets`
- `GET /api/chat/tickets/:id/messages`
- `POST /api/chat/tickets/:id/messages`
- `PATCH /api/chat/tickets/:id`

Frontend tasks:
- Replace local ticket list and message history
- Add polling or websocket later
- Persist assignment and status changes

### 4. Announcements

Schema:
- `announcements`

API:
- `GET /api/announcements`
- `POST /api/announcements`
- `PATCH /api/announcements/:id`

Frontend tasks:
- Replace hardcoded active and archived banners
- Add create/edit/archive operations

### 5. Settings

Schema:
- `system_settings`
- `settings_audit_logs`

API:
- `GET /api/settings`
- `PATCH /api/settings`
- `GET /api/settings/audit`

Frontend tasks:
- Load toggle values from API
- Persist setting changes
- Replace static audit log table

## Recommended Implementation Order

1. Stock
2. Gatepass
3. Announcements
4. Settings
5. Chat