#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_ENV_FILE="${BACKEND_ENV_FILE:-$REPO_ROOT/backend/.env}"
BACKEND_URL="${BACKEND_URL:-http://127.0.0.1:3001}"
ADMIN_EMAIL="${ADMIN_EMAIL:-}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"
HOSTNAME_MATCH="${HOSTNAME_MATCH:-$(hostname -s)}"
ASSET_ID="${ASSET_ID:-}"
SCOPE="auto"
OUTPUT_FORMAT="text"
GLOBAL_ALERT_PAGE_SIZE="${GLOBAL_ALERT_PAGE_SIZE:-100}"
GLOBAL_ALERT_MAX_PAGES="${GLOBAL_ALERT_MAX_PAGES:-20}"
AUTH_TOKEN=""

usage() {
  cat <<'EOF'
Usage:
  scripts/check-itms-openscap-status.sh [options]

Options:
  --backend-url URL      Backend base URL, default: http://127.0.0.1:3001
  --admin-email EMAIL    Admin login email, default: DEFAULT_ADMIN_EMAIL from backend/.env
  --admin-password PASS  Admin login password, default: DEFAULT_ADMIN_PASSWORD from backend/.env
  --hostname NAME        Hostname to match in ITMS, default: current short hostname
  --asset-id UUID        Skip asset discovery and use this asset id
  --scope MODE           Timer scope: auto, user, or system. Default: auto
  --json                 Print machine-readable JSON output
  --help                 Show this message
EOF
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

load_env_defaults() {
  if [[ -f "$BACKEND_ENV_FILE" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$BACKEND_ENV_FILE"
    set +a
    ADMIN_EMAIL="${ADMIN_EMAIL:-${DEFAULT_ADMIN_EMAIL:-}}"
    ADMIN_PASSWORD="${ADMIN_PASSWORD:-${DEFAULT_ADMIN_PASSWORD:-}}"
  fi
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --backend-url)
        BACKEND_URL="${2:-}"
        shift 2
        ;;
      --admin-email)
        ADMIN_EMAIL="${2:-}"
        shift 2
        ;;
      --admin-password)
        ADMIN_PASSWORD="${2:-}"
        shift 2
        ;;
      --hostname)
        HOSTNAME_MATCH="${2:-}"
        shift 2
        ;;
      --asset-id)
        ASSET_ID="${2:-}"
        shift 2
        ;;
      --scope)
        SCOPE="${2:-}"
        shift 2
        ;;
      --json)
        OUTPUT_FORMAT="json"
        shift
        ;;
      --help|-h)
        usage
        exit 0
        ;;
      *)
        echo "Unknown argument: $1" >&2
        usage >&2
        exit 1
        ;;
    esac
  done
}

login() {
  local response
  response="$(curl -fsS -X POST "$BACKEND_URL/api/auth/login" \
    -H 'Content-Type: application/json' \
    -d "$(jq -cn --arg email "$ADMIN_EMAIL" --arg password "$ADMIN_PASSWORD" '{email: $email, password: $password}')")"
  AUTH_TOKEN="$(printf '%s' "$response" | jq -r '.token')"
  if [[ -z "$AUTH_TOKEN" || "$AUTH_TOKEN" == "null" ]]; then
    echo 'Failed to obtain auth token from backend login' >&2
    exit 1
  fi
}

api_get() {
  local path="$1"
  curl -fsS -H "Authorization: Bearer $AUTH_TOKEN" "$BACKEND_URL$path"
}

fetch_global_openscap_alerts() {
  local page=1
  local combined='[]'
  while [[ "$page" -le "$GLOBAL_ALERT_MAX_PAGES" ]]; do
    local response items_count
    response="$(api_get "/api/alerts?paginate=1&page=${page}&page_size=${GLOBAL_ALERT_PAGE_SIZE}&source=openscap")"
    combined="$(jq -cn --argjson existing "$combined" --argjson response "$response" '$existing + ($response.items // [])')"
    items_count="$(printf '%s' "$response" | jq '(.items // []) | length')"
    if [[ "$items_count" -lt "$GLOBAL_ALERT_PAGE_SIZE" ]]; then
      break
    fi
    page=$((page + 1))
  done
  jq -cn --argjson items "$combined" '{items:$items}'
}

discover_asset() {
  if [[ -n "$ASSET_ID" ]]; then
    return 0
  fi

  local assets_response
  assets_response="$(api_get '/api/assets')"
  ASSET_ID="$(printf '%s' "$assets_response" | jq -r --arg host "$HOSTNAME_MATCH" '
    map(select((.hostname // "") == $host or (.name // "") == $host or (.asset_tag // "") == $host))
    | .[0].id // empty
  ')"

  if [[ -z "$ASSET_ID" ]]; then
    echo "Unable to find asset for hostname ${HOSTNAME_MATCH}" >&2
    exit 1
  fi
}

determine_scope() {
  case "$SCOPE" in
    user|system)
      printf '%s\n' "$SCOPE"
      return 0
      ;;
    auto)
      local user_load user_state system_load system_state
      user_load="$(systemctl --user show itms-openscap-scan.timer --property=LoadState --value 2>/dev/null || true)"
      user_state="$(systemctl --user show itms-openscap-scan.timer --property=UnitFileState --value 2>/dev/null || true)"
      system_load="$(systemctl show itms-openscap-scan.timer --property=LoadState --value 2>/dev/null || true)"
      system_state="$(systemctl show itms-openscap-scan.timer --property=UnitFileState --value 2>/dev/null || true)"

      if [[ "$system_load" != 'not-found' && -n "$system_load" && "$system_state" != 'disabled' ]]; then
        printf 'system\n'
        return 0
      fi
      if [[ "$user_load" != 'not-found' && -n "$user_load" && "$user_state" != 'disabled' ]]; then
        printf 'user\n'
        return 0
      fi
      if [[ "$system_load" != 'not-found' && -n "$system_load" ]]; then
        printf 'system\n'
        return 0
      fi
      if [[ "$user_load" != 'not-found' && -n "$user_load" ]]; then
        printf 'user\n'
        return 0
      fi
      printf 'none\n'
      ;;
    *)
      echo "Invalid --scope value: ${SCOPE}. Use auto, user, or system." >&2
      exit 1
      ;;
  esac
}

print_timer_status() {
  local scope_mode="$1"
  if [[ "$scope_mode" == 'none' ]]; then
    jq -cn '{scope:"none", installed:false, timer:{state:null, active:null, nextRun:null, lastRun:null}, service:{active:null, result:null, exitStatus:null}}'
    return 0
  fi

  local systemctl_cmd=(systemctl)
  if [[ "$scope_mode" == 'user' ]]; then
    systemctl_cmd+=(--user)
  fi

  local enabled active next_trigger last_trigger
  enabled="$(${systemctl_cmd[@]} show itms-openscap-scan.timer --property=UnitFileState --value 2>/dev/null || true)"
  active="$(${systemctl_cmd[@]} show itms-openscap-scan.timer --property=ActiveState --value 2>/dev/null || true)"
  next_trigger="$(${systemctl_cmd[@]} show itms-openscap-scan.timer --property=NextElapseUSecRealtime --value 2>/dev/null || true)"
  last_trigger="$(${systemctl_cmd[@]} show itms-openscap-scan.timer --property=LastTriggerUSec --value 2>/dev/null || true)"
  if [[ -z "$next_trigger" ]]; then
    next_trigger="$(${systemctl_cmd[@]} list-timers --all --no-pager --no-legend 2>/dev/null | grep 'itms-openscap-scan.timer' | awk 'NR == 1 {print $1 " " $2 " " $3 " " $4}')"
  fi

  local service_active service_result exec_status
  service_active="$(${systemctl_cmd[@]} show itms-openscap-scan.service --property=ActiveState --value 2>/dev/null || true)"
  service_result="$(${systemctl_cmd[@]} show itms-openscap-scan.service --property=Result --value 2>/dev/null || true)"
  exec_status="$(${systemctl_cmd[@]} show itms-openscap-scan.service --property=ExecMainStatus --value 2>/dev/null || true)"

  jq -cn \
    --arg scope "$scope_mode" \
    --arg enabled "${enabled:-unknown}" \
    --arg active "${active:-unknown}" \
    --arg nextRun "${next_trigger:-n/a}" \
    --arg lastRun "${last_trigger:-n/a}" \
    --arg serviceActive "${service_active:-unknown}" \
    --arg serviceResult "${service_result:-unknown}" \
    --arg exitStatus "${exec_status:-n/a}" \
    '{scope:$scope, installed:true, timer:{state:$enabled, active:$active, nextRun:$nextRun, lastRun:$lastRun}, service:{active:$serviceActive, result:$serviceResult, exitStatus:$exitStatus}}'
}

print_latest_alert() {
  local alert_json
  alert_json="$(fetch_global_openscap_alerts)"
  printf '%s' "$alert_json" | jq -c --arg assetId "$ASSET_ID" '
    .items
    | map(select(.assetId == $assetId))
    | sort_by(.createdAt)
    | reverse
    | .[0] // null
    | if . == null then null else {
        title: .title,
        time: .createdAt,
        severity: (.severity // "unknown"),
        resolved: (.resolved // false),
        id: .id,
        detail: ((.detail // "") | split("\n") | .[0])
      } end
  '
}

main() {
  load_env_defaults
  parse_args "$@"

  require_command curl
  require_command jq
  require_command systemctl

  if [[ -z "$ADMIN_EMAIL" || -z "$ADMIN_PASSWORD" ]]; then
    echo 'Missing admin credentials. Set backend/.env or pass --admin-email/--admin-password.' >&2
    exit 1
  fi

  login
  discover_asset

  local timer_json alert_json
  timer_json="$(print_timer_status "$(determine_scope)")"
  alert_json="$(print_latest_alert)"

  if [[ "$OUTPUT_FORMAT" == 'json' ]]; then
    jq -n \
      --arg assetId "$ASSET_ID" \
      --arg hostname "$HOSTNAME_MATCH" \
      --argjson timer "$timer_json" \
      --argjson latestAlert "$alert_json" \
      '{assetId:$assetId, hostname:$hostname, timer:$timer, latestAlert:$latestAlert}'
    return 0
  fi

  printf 'Host asset id: %s\n' "$ASSET_ID"
  printf '%s\n' "$timer_json" | jq -r '
    if .installed == false then
      "OpenSCAP timer: not installed"
    else
      "OpenSCAP timer scope: " + .scope + "\n" +
      "OpenSCAP timer state: " + .timer.state + " / " + .timer.active + "\n" +
      "OpenSCAP timer next run: " + .timer.nextRun + "\n" +
      "OpenSCAP timer last run: " + .timer.lastRun + "\n" +
      "OpenSCAP service state: " + .service.active + " / " + .service.result + " / exit=" + .service.exitStatus
    end
  '
  if [[ "$alert_json" == 'null' ]]; then
    printf 'OpenSCAP alert: none found for asset %s\n' "$ASSET_ID"
    return 0
  fi
  printf '%s\n' "$alert_json" | jq -r '
    "OpenSCAP alert: " + .title + "\n" +
    "OpenSCAP alert time: " + .time + "\n" +
    "OpenSCAP alert severity: " + .severity + "\n" +
    "OpenSCAP alert resolved: " + (.resolved|tostring) + "\n" +
    "OpenSCAP alert id: " + .id + "\n" +
    "OpenSCAP alert detail: " + .detail
  '
}

main "$@"