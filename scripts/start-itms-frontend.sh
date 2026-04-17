#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONTEND_DIR="$REPO_ROOT/frontend"
FRONTEND_HOST="${FRONTEND_HOST:-0.0.0.0}"
FRONTEND_PORT="${FRONTEND_PORT:-4175}"
FRONTEND_URL="${FRONTEND_URL:-http://localhost:${FRONTEND_PORT}}"

require_command() {
	if ! command -v "$1" >/dev/null 2>&1; then
		echo "Missing required command: $1" >&2
		exit 1
	fi
}

require_command curl
require_command node
require_command npm
require_command ss
require_command ps

ensure_frontend_dependencies() {
	if [[ -d "$FRONTEND_DIR/node_modules" ]]; then
		return 0
	fi

	echo "Frontend dependencies are missing. Installing them in $FRONTEND_DIR..."
	cd "$FRONTEND_DIR"
	npm install
}

frontend_healthy() {
	curl -fsS -I "$FRONTEND_URL" >/dev/null 2>&1
}

find_frontend_pids() {
	ss -ltnp "( sport = :${FRONTEND_PORT} )" 2>/dev/null | sed -n 's/.*pid=\([0-9]\+\).*/\1/p' | sort -u
}

kill_stale_frontend_processes() {
	local pid
	local cmdline

	while read -r pid; do
		[[ -z "$pid" ]] && continue
		cmdline="$(ps -p "$pid" -o args= 2>/dev/null || true)"
		[[ -z "$cmdline" ]] && continue

		if [[ "$cmdline" == *"vite/bin/vite.js preview"* ]] || [[ "$cmdline" == *"npm run preview"* ]]; then
			kill "$pid" 2>/dev/null || true
			sleep 1
			if ps -p "$pid" >/dev/null 2>&1; then
				kill -9 "$pid" 2>/dev/null || true
			fi
		fi
	done < <(find_frontend_pids)
}

port_in_use() {
	ss -ltn "( sport = :${FRONTEND_PORT} )" 2>/dev/null | grep -q ":${FRONTEND_PORT} "
}

if port_in_use; then
	if frontend_healthy; then
		echo "Frontend preview already healthy at $FRONTEND_URL"
		exit 0
	fi

	kill_stale_frontend_processes
	if port_in_use; then
		echo "Port ${FRONTEND_PORT} is in use by a non-preview process. Stop it or set FRONTEND_PORT to a free port." >&2
		exit 1
	fi
fi

cd "$FRONTEND_DIR"
ensure_frontend_dependencies
exec node node_modules/vite/bin/vite.js preview --host "$FRONTEND_HOST" --port "$FRONTEND_PORT" --strictPort