# ITMS

## Stack

- Frontend: React + TypeScript + Vite
- Backend: Go + Gin + PostgreSQL
- API routing: frontend calls `/api/*` through the shared API helper in `frontend/src/lib/api.ts`
- Live modules: users, assets, devices, patching, alerts, stock, gatepass, chat, announcements, requests

## Port Layout

- Frontend UI is served on `http://10.10.21.11:4175`
- Live backend API is served on `http://10.10.21.11:3013`
- Secondary local backend instance is available on `http://10.10.21.11:3012`
- Salt API is served on `http://10.10.21.11:8000`

In production, the frontend bundle uses explicit origins from `frontend/.env.production`:

- `VITE_API_ORIGIN=http://10.10.21.11:3013`
- `VITE_WS_ORIGIN=ws://10.10.21.11:3013`

That means all frontend options and routes resolve to the backend on port `3013` instead of inferring a backend port from the browser location.

## Development

Start backend plus stable frontend together from the repo root:

```bash
bash scripts/start-itms.sh
```

This command ensures the backend is healthy, rebuilds the frontend if the built assets are stale, and keeps preview pinned to `4175`.

Equivalent Make targets from the repo root:

```bash
make start
make stop
make restart
make status
make smoke-test
```

Stop backend plus stable frontend together:

```bash
bash scripts/stop-itms.sh
```

Install frontend dependencies:

```bash
cd frontend
npm install
```

Build the frontend:

```bash
cd frontend
npm run build
```

Start the frontend preview on the fixed live port:

```bash
cd frontend
npm run preview:stable
```

Build the backend:

```bash
cd backend
GOTOOLCHAIN=local go build ./...
```

Frontend-specific implementation and bundle notes are documented in `frontend/README.md`.

## Docker Setup On This Server

If Docker is not installed yet, use the one-shot Ubuntu installer from the repo root:

```bash
chmod +x scripts/install-docker-and-start-itms.sh
./scripts/install-docker-and-start-itms.sh
```

For detached startup:

```bash
./scripts/install-docker-and-start-itms.sh --detach
```

After the stack starts, verify service and API health:

```bash
chmod +x scripts/verify-itms-stack.sh
./scripts/verify-itms-stack.sh --sudo
```

Then run the API smoke test:

```bash
chmod +x scripts/smoke-test-itms-api.sh
./scripts/smoke-test-itms-api.sh
```

## Direct Compose Run

```bash
cd backend
cp .env.example .env
docker compose up --build
```

## Backend Notes

- PostgreSQL is the source of truth for persistent data.
- Docker is used for runtime and service orchestration.
- Linux systems can push hardware and OS inventory directly to the backend with `scripts/push-system-inventory.py` and `INVENTORY_INGEST_TOKEN`.
- Backend-specific setup details are documented in `backend/README.md`.
