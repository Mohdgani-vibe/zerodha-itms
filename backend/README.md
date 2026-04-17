# Zerodha ITMS Backend

Internal-use Go backend for the Zerodha ITMS platform.

## Stack

- Go 1.22.2
- Gin
- PostgreSQL
- `database/sql` with `pgx`
- JWT auth
- Google OAuth 2.0 entrypoints

## What is implemented

- Auth: local JWT login, Google SSO entrypoints, logout, current user
- Core APIs: entities, locations, departments, roles, users, assets, audit log
- Frontend compatibility APIs: devices, patch dashboard/jobs/run, terminal sessions, current-user assets, and user meta options
- Entity-aware access rules for `super_admin`, `it_team`, and `employee`
- Hostname suggestion and transactional hostname sequence allocation for compute assets
- Middleware-driven audit log writes for mutating routes
- Seed data for Zerodha entities, default ZBL locations, roles, permissions, and default super admin
- SaltStack and Wazuh adapter clients, enabled through environment configuration
- Backend-owned inventory sync scheduler and status endpoint for daily asset imports
- Direct machine-to-server inventory ingest endpoint for collector agents

## Local run

1. Copy `.env.example` to `.env`
2. Start PostgreSQL:

```bash
cd backend
bash ../scripts/start-itms-backend.sh
```

3. The script auto-detects `docker compose` vs `docker-compose`, removes a dead backend container if needed, clears stale host-run ITMS backend processes on port `3001`, and waits for `/api/health` before returning.

4. Normal local startup commands that recover automatically on this host:

```bash
cd backend
make run
```

or:

```bash
cd backend
make start
```

5. If you explicitly want the host-run Go server instead of Docker for debugging:

```bash
cd backend
make run-host
```

The API listens on `http://localhost:3001` by default.

## Live Port Layout On This Host

- Frontend UI: `http://10.10.21.11/` through nginx
- Primary backend API: `http://10.10.21.11/api/*` through nginx
- Backend container listener on host: `http://10.10.21.11:3001`
- Secondary backend instance: `http://10.10.21.11:3012`
- Salt API: `http://10.10.21.11:8000`

For the recommended live deployment, nginx serves the built frontend and proxies `/api` and `/ws` to the backend on port `3001`. The Vite preview server on `4175` is useful for manual preview sessions but should not be treated as the persistent production web server.

## Full Docker run

```bash
cd backend
cp .env.example .env
bash ../scripts/start-itms-backend.sh
```

If Docker is not installed yet on this Ubuntu server, run the one-shot installer from the repo root:

```bash
chmod +x scripts/install-docker-and-start-itms.sh
./scripts/install-docker-and-start-itms.sh
```

To start the stack in the background instead of attaching to logs:

```bash
./scripts/install-docker-and-start-itms.sh --detach
```

After startup, verify the stack from the repo root:

```bash
chmod +x scripts/verify-itms-stack.sh
./scripts/verify-itms-stack.sh --sudo
```

To verify live Salt, Wazuh, ClamAV, and OpenSCAP integration flows from this host:

```bash
chmod +x scripts/verify-itms-security-integrations.sh scripts/setup-itms-openscap-content.sh
./scripts/verify-itms-security-integrations.sh
```

To install only the recurring host-side OpenSCAP scan runner and timer:

```bash
chmod +x scripts/install-itms-openscap-runner.sh
sudo ./scripts/install-itms-openscap-runner.sh --server-url http://127.0.0.1:3001 --token "$INVENTORY_INGEST_TOKEN"
```

If passwordless or interactive sudo is not available, you can install a user-level timer instead:

```bash
chmod +x scripts/install-itms-openscap-user-runner.sh
./scripts/install-itms-openscap-user-runner.sh --server-url http://127.0.0.1:3001 --token "$INVENTORY_INGEST_TOKEN"
```

To inspect the active OpenSCAP timer state together with the latest ITMS OpenSCAP alert for this host:

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

To publish the built frontend behind nginx on this Ubuntu host:

```bash
chmod +x scripts/install-itms-nginx.sh
./scripts/install-itms-nginx.sh 10.10.21.11
```

Then run an authenticated API smoke test with the seeded admin:

```bash
chmod +x scripts/smoke-test-itms-api.sh
./scripts/smoke-test-itms-api.sh
```

## Default seeded admin

- Email: `DEFAULT_ADMIN_EMAIL` from `.env`
- Password: `DEFAULT_ADMIN_PASSWORD` from `.env`

Set strong values before first boot. The defaults in `.env.example` are placeholders and should not be treated as the deployed credential.

If you change `DEFAULT_ADMIN_PASSWORD` in an existing deployment, rotate the stored credential too:

```bash
cd backend
set -a
source .env
set +a
GOTOOLCHAIN=local go run ./cmd/sync_default_admin_password
```

## Build validation

```bash
cd backend
GOTOOLCHAIN=local go build ./cmd/server
GOTOOLCHAIN=local go build ./...
```

## Notes

- PostgreSQL is the source of truth for all persistent app data.
- Docker is used to run the backend and Postgres, not to store app records directly.
- Google SSO routes are present; set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URL` to enable the redirect-based flow.
- Set `SALT_API_BASE_URL` and `SALT_API_TOKEN` to send patch runs and install jobs to SaltStack.
- If you are connecting directly to a normal `salt-api` service instead of a bearer-token gateway, set `SALT_API_USERNAME`, `SALT_API_PASSWORD`, and `SALT_API_EAUTH`.
- On this Ubuntu host, the working configuration is `SALT_API_EAUTH=file`.
- If `salt-api` is installed but not listening on port `8000`, run `sudo bash /home/itteam/itms/scripts/repair-salt-api.sh` to repair the exact `contextvars`/service bootstrap issue seen on Ubuntu hosts.
- On this host, `salt-master` and `salt-api` run as the `salt` user, so Salt config files used by the repair flow must remain readable by group `salt`.
- The main install-agent action uses an OS-aware Salt state selection: Ubuntu devices use `SALT_AGENT_INSTALL_UBUNTU_STATE`, Windows devices use `SALT_AGENT_INSTALL_WINDOWS_STATE`, and unknown devices fall back to `SALT_AGENT_INSTALL_STATE`.
- The follow-up inventory refresh is also OS-aware: `SALT_INVENTORY_REFRESH_UBUNTU_STATE`, `SALT_INVENTORY_REFRESH_WINDOWS_STATE`, with `SALT_INVENTORY_REFRESH_STATE` as fallback.
- Set `WAZUH_API_BASE_URL`, `WAZUH_API_USERNAME`, and `WAZUH_API_PASSWORD` to enrich asset alerts with Wazuh data after agent enrollment.
- Set `WAZUH_API_INSECURE_SKIP_VERIFY=true` only when you are connecting to a local Wazuh API with a self-signed certificate and do not yet have a trusted internal CA.
- Set `INVENTORY_SYNC_ENABLED=true` and configure the `INVENTORY_SYNC_*` variables to pull daily inventory data into `assets` and `asset_compute_details`.
- Set `INVENTORY_INGEST_TOKEN` if you want Linux systems to push hardware and OS inventory directly to `/api/inventory-sync/ingest`.
- Inventory sync payload shape and flow are documented in `docs/inventory-sync.md`.
- Example Salt states for Ubuntu and Windows agent install plus inventory refresh are documented in `docs/salt-agent-states.md`.
