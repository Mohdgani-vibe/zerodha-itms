#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONTEND_DIR="$REPO_ROOT/frontend"
BACKEND_START_SCRIPT="$REPO_ROOT/scripts/start-itms-backend.sh"
FRONTEND_START_SCRIPT="$REPO_ROOT/scripts/start-itms-frontend.sh"
FRONTEND_PORT="${FRONTEND_PORT:-4175}"

require_command() {
	if ! command -v "$1" >/dev/null 2>&1; then
		echo "Missing required command: $1" >&2
		exit 1
	fi
}

require_command npm
require_command node
require_command ss
require_command ps

latest_frontend_source_epoch() {
	{
		stat -c '%Y' \
			"$FRONTEND_DIR/package.json" \
			"$FRONTEND_DIR/package-lock.json" \
			"$FRONTEND_DIR/vite.config.ts" \
			"$FRONTEND_DIR/index.html" \
			2>/dev/null || true
		find \
			"$FRONTEND_DIR/src" \
			"$FRONTEND_DIR/public" \
			-type f -printf '%T@\n' 2>/dev/null || true
	} | awk 'BEGIN { max = 0 } { if ($1 > max) max = $1 } END { printf "%.0f\n", max }'
}

latest_frontend_build_epoch() {
	if [[ ! -d "$REPO_ROOT/dist" ]]; then
		echo 0
		return 0
	fi

	find "$REPO_ROOT/dist" -type f -printf '%T@\n' 2>/dev/null | awk 'BEGIN { max = 0 } { if ($1 > max) max = $1 } END { printf "%.0f\n", max }'
}

frontend_build_stale() {
	local source_epoch
	local build_epoch

	source_epoch="$(latest_frontend_source_epoch)"
	build_epoch="$(latest_frontend_build_epoch)"
	(( source_epoch > build_epoch ))
}

find_frontend_pids() {
	ss -ltnp "( sport = :${FRONTEND_PORT} )" 2>/dev/null | sed -n 's/.*pid=\([0-9]\+\).*/\1/p' | sort -u
}

kill_frontend_preview_processes() {
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

bash "$BACKEND_START_SCRIPT"

rebuilt_frontend=0
if frontend_build_stale; then
	echo "Frontend build is missing or stale. Rebuilding frontend..."
	cd "$FRONTEND_DIR"
	npm run build
	rebuilt_frontend=1
fi

if [[ "$rebuilt_frontend" -eq 1 ]]; then
	kill_frontend_preview_processes
fi

bash "$FRONTEND_START_SCRIPT"