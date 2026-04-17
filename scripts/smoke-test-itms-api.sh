#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_ENV_FILE="$REPO_ROOT/backend/.env"
API_BASE_URL="${API_BASE_URL:-http://localhost:3001}"
ADMIN_EMAIL="${DEFAULT_ADMIN_EMAIL:-admin@zerodha.com}"
ADMIN_PASSWORD="${DEFAULT_ADMIN_PASSWORD:-replace-with-a-strong-admin-password}"
SEEDED_ADMIN_PASSWORD="${SEEDED_ADMIN_PASSWORD:-}"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_command curl
require_command python3

if [[ -f "$BACKEND_ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$BACKEND_ENV_FILE"
  set +a
  ADMIN_EMAIL="${DEFAULT_ADMIN_EMAIL:-$ADMIN_EMAIL}"
  ADMIN_PASSWORD="${DEFAULT_ADMIN_PASSWORD:-$ADMIN_PASSWORD}"
fi

api_json() {
  local method="$1"
  local url="$2"
  local token="${3:-}"
  local body="${4:-}"
  local args=( -fsS -X "$method" "$url" )

  if [[ -n "$token" ]]; then
    args+=( -H "Authorization: Bearer $token" )
  fi
  if [[ -n "$body" ]]; then
    args+=( -H "Content-Type: application/json" --data "$body" )
  else
    :
  fi

  curl "${args[@]}"
}

LOGIN_STATUS=""
LOGIN_BODY=""

attempt_login() {
  local email="$1"
  local password="$2"
  local response_file

  response_file="$(mktemp)"
  LOGIN_STATUS="$(curl -sS -o "$response_file" -w '%{http_code}' -X POST "$API_BASE_URL/api/auth/login" -H "Content-Type: application/json" --data "{\"email\":\"$email\",\"password\":\"$password\"}" || true)"
  LOGIN_BODY="$(cat "$response_file")"
  rm -f "$response_file"

  [[ "$LOGIN_STATUS" == "200" ]]
}

json_field() {
  local field="$1"
  python3 -c "import json,sys; data=json.load(sys.stdin); value=data$field; print(value if value is not None else '')"
}

json_len() {
  python3 -c "import json,sys; data=json.load(sys.stdin); print(len(data))"
}

echo "Checking API health at $API_BASE_URL/api/health ..."
health_payload="$(api_json GET "$API_BASE_URL/api/health")"
echo "$health_payload"

echo
echo "Logging in as admin: $ADMIN_EMAIL"

login_source="configured backend/.env password"
if attempt_login "$ADMIN_EMAIL" "$ADMIN_PASSWORD"; then
  login_payload="$LOGIN_BODY"
elif [[ -n "$SEEDED_ADMIN_PASSWORD" && "$ADMIN_PASSWORD" != "$SEEDED_ADMIN_PASSWORD" ]] && attempt_login "$ADMIN_EMAIL" "$SEEDED_ADMIN_PASSWORD"; then
  login_payload="$LOGIN_BODY"
  login_source="seeded fallback password"
  echo "Warning: DEFAULT_ADMIN_PASSWORD in $BACKEND_ENV_FILE does not match the live admin credential." >&2
  echo "Warning: ITMS only seeds the default admin on first insert, so changing backend/.env does not rotate the stored password automatically." >&2
else
  echo "Admin login failed for $ADMIN_EMAIL." >&2
  echo "Configured password status: $LOGIN_STATUS" >&2
  if [[ -n "$LOGIN_BODY" ]]; then
    echo "$LOGIN_BODY" >&2
  fi
  exit 1
fi

token="$(printf '%s' "$login_payload" | json_field "['token']")"

if [[ -z "$token" ]]; then
  echo "Login succeeded but no token was returned." >&2
  exit 1
fi

echo "Auth token acquired using $login_source."

echo
echo "Checking authenticated profile ..."
api_json GET "$API_BASE_URL/api/auth/me" "$token"

echo
echo "Checking core live endpoints ..."
users_count="$(api_json GET "$API_BASE_URL/api/users" "$token" | json_len)"
devices_count="$(api_json GET "$API_BASE_URL/api/devices" "$token" | json_len)"
requests_count="$(api_json GET "$API_BASE_URL/api/requests" "$token" | json_len)"
announcements_count="$(api_json GET "$API_BASE_URL/api/announcements" "$token" | json_len)"

echo "users: $users_count"
echo "devices: $devices_count"
echo "requests: $requests_count"
echo "announcements: $announcements_count"

echo
echo "Smoke test completed successfully."