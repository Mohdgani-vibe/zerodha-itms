# ITMS

## Stack

- Frontend: React + TypeScript + Vite
- Backend: Go + Gin + PostgreSQL
- API routing: frontend calls `/api/*` through the shared API helper in `frontend/src/lib/api.ts`
- Live modules: users, assets, devices, patching, alerts, stock, gatepass, chat, announcements, requests

## Port Layout

- Frontend UI should be served on `http://10.10.21.11/` through nginx
- Backend API is proxied through the same origin at `http://10.10.21.11/api/*`
- Backend container listens on `http://10.10.21.11:3001` internally on the host
- Secondary local backend instance is available on `http://10.10.21.11:3012`
- Salt API is served on `http://10.10.21.11:8000`

In production, the frontend should use same-origin `/api` and `/ws` through nginx. Leave `VITE_API_ORIGIN` and `VITE_WS_ORIGIN` empty in `frontend/.env.production` unless you intentionally want to bypass the reverse proxy.

## Development

Start backend plus stable frontend together from the repo root:

```bash
bash scripts/start-itms.sh
```

This command ensures the backend is healthy, rebuilds the frontend if the built assets are stale, and keeps preview pinned to `4175`.

If `frontend/node_modules` is missing, the helper will install frontend dependencies before it rebuilds or starts preview.

Use this for operator-driven preview sessions, not as the long-running production web server.

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

If dependencies are missing, the helper installs them before starting preview.

## Production nginx Deployment

Build and install the frontend behind nginx from the repo root:

```bash
chmod +x scripts/install-itms-nginx.sh
./scripts/install-itms-nginx.sh 10.10.21.11
```

The helper script will:

- install frontend dependencies first when `frontend/node_modules` is missing
- build `frontend/dist`
- copy the built files to `/var/www/itms`
- install the nginx site from `deploy/nginx/itms.conf`
- proxy `/api` and `/ws` to `127.0.0.1:3001`
- enable and restart nginx

After deployment, the browser should use `http://10.10.21.11/` for both the UI and backend API access through nginx.

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

To verify the live Salt, Wazuh, ClamAV, and OpenSCAP workflows against the current host:

```bash
chmod +x scripts/verify-itms-security-integrations.sh scripts/setup-itms-openscap-content.sh
./scripts/verify-itms-security-integrations.sh
```

The verifier auto-uses passwordless sudo for OpenSCAP when available. To force or disable that behavior explicitly:

```bash
./scripts/verify-itms-security-integrations.sh --openscap-sudo always
./scripts/verify-itms-security-integrations.sh --openscap-sudo never
```

If Ubuntu or Debian package sources do not include the SCAP datastream you need, fetch it into the current user's ITMS content directory:

```bash
chmod +x scripts/setup-itms-openscap-content.sh
./scripts/setup-itms-openscap-content.sh --print-path
```

To install a persistent host-side OpenSCAP scan timer without running the full agent bootstrap:

```bash
chmod +x scripts/install-itms-openscap-runner.sh
sudo ./scripts/install-itms-openscap-runner.sh --server-url http://127.0.0.1:3001 --token "$INVENTORY_INGEST_TOKEN"
```

If root-level installation is not available, install a user-level OpenSCAP timer instead:

```bash
chmod +x scripts/install-itms-openscap-user-runner.sh
./scripts/install-itms-openscap-user-runner.sh --server-url http://127.0.0.1:3001 --token "$INVENTORY_INGEST_TOKEN"
```

To check the current OpenSCAP timer state and latest ingested OpenSCAP alert in one command:

```bash
chmod +x scripts/check-itms-openscap-status.sh
./scripts/check-itms-openscap-status.sh
./scripts/check-itms-openscap-status.sh --json
```

To run the full deployment readiness suite in one command:

```bash
chmod +x scripts/check-itms-release-readiness.sh
./scripts/check-itms-release-readiness.sh
./scripts/check-itms-release-readiness.sh --with-live-integrations
```

To acknowledge or resolve the latest unresolved OpenSCAP alert for this host:

```bash
chmod +x scripts/manage-itms-openscap-alert.sh
./scripts/manage-itms-openscap-alert.sh --action acknowledge --dry-run
./scripts/manage-itms-openscap-alert.sh --action resolve
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
bash ../scripts/start-itms-backend.sh
```

The backend start helper auto-detects `docker compose` vs `docker-compose`, which matters on this host because the legacy standalone compose binary is still the working path.

## Backend Notes

- PostgreSQL is the source of truth for persistent data.
- Docker is used for runtime and service orchestration.
- Linux systems can push hardware and OS inventory directly to the backend with `scripts/push-system-inventory.py` and `INVENTORY_INGEST_TOKEN`.
- Linux hosts can self-bootstrap Ubuntu or Debian OpenSCAP content with `scripts/setup-itms-openscap-content.sh` and verify Salt, Wazuh, ClamAV, and OpenSCAP end to end with `scripts/verify-itms-security-integrations.sh`.
- A standalone scheduled OpenSCAP runner can be installed with `scripts/install-itms-openscap-runner.sh` when you want recurring scans without the full agent bootstrap.
- A non-root fallback timer can be installed with `scripts/install-itms-openscap-user-runner.sh` when `sudo` is unavailable, with the tradeoff that some OpenSCAP probes remain permission-limited.
- The current timer state and latest ingested OpenSCAP alert can be checked together with `scripts/check-itms-openscap-status.sh`.
- The full non-root deployment readiness suite can be run with `scripts/check-itms-release-readiness.sh`.
- Backend-specific setup details are documented in `backend/README.md`.
