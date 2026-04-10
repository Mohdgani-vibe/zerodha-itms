#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_HEALTH_URL="${BACKEND_HEALTH_URL:-http://127.0.0.1:3001/api/health}"
FRONTEND_URL="${FRONTEND_URL:-http://127.0.0.1:4175/}"
STACK_UNIT="${STACK_UNIT:-itms-stack.service}"

backend_ok=0
frontend_ok=0

if curl -fsS "$BACKEND_HEALTH_URL" >/dev/null 2>&1; then
	backend_ok=1
fi

if curl -fsSI "$FRONTEND_URL" >/dev/null 2>&1; then
	frontend_ok=1
fi

if [[ "$backend_ok" -eq 0 ]]; then
	echo "Backend health probe failed. Running backend recovery."
	bash "$REPO_ROOT/scripts/start-itms-backend.sh"
	if curl -fsS "$BACKEND_HEALTH_URL" >/dev/null 2>&1; then
		backend_ok=1
	fi
fi

if [[ "$frontend_ok" -eq 0 ]]; then
	echo "Frontend health probe failed. Restarting $STACK_UNIT."
	systemctl --user restart "$STACK_UNIT"
	if curl -fsSI "$FRONTEND_URL" >/dev/null 2>&1; then
		frontend_ok=1
	fi
fi

if [[ "$backend_ok" -eq 0 || "$frontend_ok" -eq 0 ]]; then
	echo "ITMS watchdog detected an unhealthy stack after recovery attempts." >&2
	exit 1
fi

echo "ITMS stack healthy."