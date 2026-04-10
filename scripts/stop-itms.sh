#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$REPO_ROOT/backend"
COMPOSE_FILE="$BACKEND_DIR/docker-compose.yml"
BACKEND_PORT="${BACKEND_PORT:-3001}"
FRONTEND_PORT="${FRONTEND_PORT:-4175}"

require_command() {
	if ! command -v "$1" >/dev/null 2>&1; then
		echo "Missing required command: $1" >&2
		exit 1
	fi
}

require_command docker
require_command ss
require_command ps

compose() {
	if docker compose version >/dev/null 2>&1; then
		docker compose -f "$COMPOSE_FILE" "$@"
		return 0
	fi
	if command -v docker-compose >/dev/null 2>&1; then
		docker-compose -f "$COMPOSE_FILE" "$@"
		return 0
	fi

	echo "Neither 'docker compose' nor 'docker-compose' is available." >&2
	exit 1
}

find_port_pids() {
	local port="$1"
	ss -ltnp "( sport = :${port} )" 2>/dev/null | sed -n 's/.*pid=\([0-9]\+\).*/\1/p' | sort -u
}

kill_processes_for_port() {
	local port="$1"
	local pid
	local cmdline

	while read -r pid; do
		[[ -z "$pid" ]] && continue
		cmdline="$(ps -p "$pid" -o args= 2>/dev/null || true)"
		[[ -z "$cmdline" ]] && continue

		if [[ "$port" == "$FRONTEND_PORT" ]]; then
			if [[ "$cmdline" != *"vite/bin/vite.js preview"* ]] && [[ "$cmdline" != *"npm run preview"* ]]; then
				continue
			fi
		else
			if [[ "$cmdline" != *"go run ./cmd/server"* ]] && [[ "$cmdline" != *"/app/itms-server"* ]] && [[ "$cmdline" != *"/bin/itms-server"* ]] && [[ "$cmdline" != *"make run"* ]] && [[ "$cmdline" != *"/cmd/server"* ]]; then
				continue
			fi
		fi

		kill "$pid" 2>/dev/null || true
		sleep 1
		if ps -p "$pid" >/dev/null 2>&1; then
			kill -9 "$pid" 2>/dev/null || true
		fi
		done < <(find_port_pids "$port")
}

kill_processes_for_port "$FRONTEND_PORT"
kill_processes_for_port "$BACKEND_PORT"

compose stop backend postgres >/dev/null 2>&1 || true

echo "ITMS frontend preview on port ${FRONTEND_PORT} and backend services have been stopped."