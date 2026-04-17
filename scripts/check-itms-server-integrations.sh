#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_ENV_FILE="${BACKEND_ENV_FILE:-$REPO_ROOT/backend/.env}"
BACKEND_ENV_DIR="$(dirname "$BACKEND_ENV_FILE")"

if [[ -f "$BACKEND_ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$BACKEND_ENV_FILE"
  set +a
fi

print_check() {
  local label="$1"
  local value="$2"
  printf '%-28s %s\n' "$label" "$value"
}

command_status() {
  local name="$1"
  if command -v "$name" >/dev/null 2>&1; then
    command -v "$name"
  else
    echo "missing"
  fi
}

listener_status() {
  local port="$1"
  if ss -ltn 2>/dev/null | grep -q ":${port} "; then
    echo "listening"
  else
    echo "not-listening"
  fi
}

listener_owner() {
  local port="$1"
  local pid
  pid=$(ss -ltnp "( sport = :${port} )" 2>/dev/null | sed -n 's/.*pid=\([0-9]\+\).*/\1/p' | head -n 1)
  if [[ -z "$pid" ]]; then
    echo "-"
    return 0
  fi
  ps -o user=,pid=,comm= -p "$pid" 2>/dev/null | awk '{$1=$1; print}'
}

service_status() {
  local service_name="$1"
  if command -v systemctl >/dev/null 2>&1; then
    systemctl is-active "$service_name" 2>/dev/null || true
  else
    echo "unknown"
  fi
}

env_value() {
  local key="$1"
  if [[ -f "$BACKEND_ENV_FILE" ]]; then
    grep -E "^${key}=" "$BACKEND_ENV_FILE" | tail -n 1 | cut -d'=' -f2-
  fi
}

resolved_path() {
  local raw_path="$1"
  if [[ -z "$raw_path" ]]; then
    return 0
  fi
  if [[ "$raw_path" = /* ]]; then
    printf '%s\n' "$raw_path"
    return 0
  fi
  printf '%s/%s\n' "$BACKEND_ENV_DIR" "$raw_path"
}

salt_api_status() {
  local base_url="${SALT_API_BASE_URL:-}"
  local username="${SALT_API_USERNAME:-}"
  local password="${SALT_API_PASSWORD:-}"
  local eauth="${SALT_API_EAUTH:-}"
  local code
  local body_file

  if [[ -z "$base_url" ]]; then
    echo "not-configured"
    return 0
  fi

  body_file="$(mktemp)"
  code="$(curl -sS -o "$body_file" -w '%{http_code}' \
    -X POST "$base_url/run" \
    -H 'Accept: application/json' \
    --data-urlencode "username=$username" \
    --data-urlencode "password=$password" \
    --data-urlencode "eauth=$eauth" \
    --data-urlencode 'client=local' \
    --data-urlencode 'tgt=itms-integration-check-target' \
    --data-urlencode 'fun=test.ping' || true)"

  case "$code" in
    200)
      echo "auth-ok"
      ;;
    401|403)
      printf 'auth-failed (%s)' "$code"
      ;;
    000)
      echo "unreachable"
      ;;
    *)
      printf 'unexpected-http-%s' "$code"
      ;;
  esac
  rm -f "$body_file"
}

wazuh_api_status() {
  local base_url="${WAZUH_API_BASE_URL:-}"
  local username="${WAZUH_API_USERNAME:-}"
  local password="${WAZUH_API_PASSWORD:-}"
  local ca_file
  local curl_args=()
  local code
  local body_file

  if [[ -z "$base_url" ]]; then
    echo "not-configured"
    return 0
  fi

  if [[ "${WAZUH_API_INSECURE_SKIP_VERIFY:-false}" == "true" ]]; then
    curl_args+=(--insecure)
  fi

  ca_file="$(resolved_path "${WAZUH_API_CA_FILE:-}")"
  if [[ -n "$ca_file" && -f "$ca_file" ]]; then
    curl_args+=(--cacert "$ca_file")
  fi

  body_file="$(mktemp)"
  code="$(curl -sS -o "$body_file" -w '%{http_code}' \
    "${curl_args[@]}" \
    -u "$username:$password" \
    "$base_url/security/user/authenticate" || true)"

  case "$code" in
    200)
      echo "auth-ok"
      ;;
    401|403)
      printf 'auth-failed (%s)' "$code"
      ;;
    000)
      echo "unreachable"
      ;;
    *)
      printf 'unexpected-http-%s' "$code"
      ;;
  esac
  rm -f "$body_file"
}

echo "ITMS server integration status"
echo
print_check "salt-master" "$(command_status salt-master)"
print_check "salt-api" "$(command_status salt-api)"
print_check "oscap" "$(command_status oscap)"
print_check "salt-master.service" "$(service_status salt-master)"
print_check "salt-api.service" "$(service_status salt-api)"
print_check "port 8000" "$(listener_status 8000)"
print_check "port 8000 owner" "$(listener_owner 8000)"
print_check "port 55000" "$(listener_status 55000)"
print_check "port 55000 owner" "$(listener_owner 55000)"
print_check "salt api auth" "$(salt_api_status)"
print_check "wazuh api auth" "$(wazuh_api_status)"
echo
print_check "SALT_API_BASE_URL" "$(env_value SALT_API_BASE_URL || true)"
print_check "SALT_API_USERNAME" "$(env_value SALT_API_USERNAME || true)"
print_check "SALT_API_EAUTH" "$(env_value SALT_API_EAUTH || true)"
print_check "WAZUH_API_BASE_URL" "$(env_value WAZUH_API_BASE_URL || true)"
print_check "WAZUH_API_USERNAME" "$(env_value WAZUH_API_USERNAME || true)"
print_check "WAZUH_API_CA_FILE" "$(env_value WAZUH_API_CA_FILE || true)"
print_check "WAZUH_API_INSECURE" "$(env_value WAZUH_API_INSECURE_SKIP_VERIFY || true)"
print_check "PUBLIC_SERVER_URL" "$(env_value PUBLIC_SERVER_URL || true)"
print_check "SALT_MASTER_HOST" "$(env_value SALT_MASTER_HOST || true)"
print_check "WAZUH_MANAGER_HOST" "$(env_value WAZUH_MANAGER_HOST || true)"