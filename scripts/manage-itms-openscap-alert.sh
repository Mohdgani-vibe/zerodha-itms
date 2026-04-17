#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_ENV_FILE="${BACKEND_ENV_FILE:-$REPO_ROOT/backend/.env}"
BACKEND_URL="${BACKEND_URL:-http://127.0.0.1:3001}"
ADMIN_EMAIL="${ADMIN_EMAIL:-}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"
HOSTNAME_MATCH="${HOSTNAME_MATCH:-$(hostname -s)}"
ASSET_ID="${ASSET_ID:-}"
ALERT_ID="${ALERT_ID:-}"
ACTION=""
OUTPUT_FORMAT="text"
DRY_RUN=0
GLOBAL_ALERT_PAGE_SIZE="${GLOBAL_ALERT_PAGE_SIZE:-100}"
GLOBAL_ALERT_MAX_PAGES="${GLOBAL_ALERT_MAX_PAGES:-20}"
AUTH_TOKEN=""

usage() {
  cat <<'EOF'
Usage:
  scripts/manage-itms-openscap-alert.sh --action acknowledge|resolve [options]

Options:
  --action NAME         Alert action: acknowledge or resolve
  --backend-url URL     Backend base URL, default: http://127.0.0.1:3001
  --admin-email EMAIL   Admin login email, default: DEFAULT_ADMIN_EMAIL from backend/.env
  --admin-password PASS Admin login password, default: DEFAULT_ADMIN_PASSWORD from backend/.env
  --hostname NAME       Hostname to match in ITMS, default: current short hostname
  --asset-id UUID       Skip asset discovery and use this asset id
  --alert-id UUID       Apply the action to a specific alert id instead of auto-selecting the latest unresolved OpenSCAP alert
  --dry-run             Print the selected target without sending the action request
  --json                Print machine-readable JSON output
  --help                Show this message
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
      --action)
        ACTION="${2:-}"
        shift 2
        ;;
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
      --alert-id)
        ALERT_ID="${2:-}"
        shift 2
        ;;
      --dry-run)
        DRY_RUN=1
        shift
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

validate_action() {
  case "$ACTION" in
    acknowledge|resolve)
      ;;
    *)
      echo 'Missing or invalid --action. Use acknowledge or resolve.' >&2
      exit 1
      ;;
  esac
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

api_put() {
  local path="$1"
  curl -fsS -X PUT -H "Authorization: Bearer $AUTH_TOKEN" "$BACKEND_URL$path"
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

fetch_asset_alerts() {
  api_get "/api/assets/$ASSET_ID/alerts?paginate=1&page=1&page_size=50"
}

fetch_global_alerts() {
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

map_asset_alert_to_global() {
  local asset_alert="$1"
  local global_alerts="$2"
  printf '%s' "$global_alerts" | jq -c \
    --arg assetId "$ASSET_ID" \
    --arg title "$(printf '%s' "$asset_alert" | jq -r '.title // empty')" \
    --arg detail "$(printf '%s' "$asset_alert" | jq -r '.detail // empty')" \
    --arg createdAt "$(printf '%s' "$asset_alert" | jq -r '.created_at // empty')" '
    .items
    | map(select(.assetId == $assetId and .title == $title and .detail == $detail and .createdAt == $createdAt))
    | .[0] // null
  '
}

select_alert() {
  local global_alerts="$1"
  local asset_alerts="$2"
  if [[ -n "$ALERT_ID" ]]; then
    local selected_global
    selected_global="$(printf '%s' "$global_alerts" | jq -c --arg alertId "$ALERT_ID" '.items | map(select(.id == $alertId)) | .[0] // null')"
    if [[ "$selected_global" != 'null' ]]; then
      printf '%s\n' "$selected_global"
      return 0
    fi

    local selected_asset
    selected_asset="$(printf '%s' "$asset_alerts" | jq -c --arg alertId "$ALERT_ID" 'map(select(.id == $alertId and .source == "openscap")) | .[0] // null')"
    if [[ "$selected_asset" != 'null' ]]; then
      map_asset_alert_to_global "$selected_asset" "$global_alerts"
      return 0
    fi

    printf 'null\n'
    return 0
  fi

  printf '%s' "$global_alerts" | jq -c --arg assetId "$ASSET_ID" '
    .items
    | map(select(.assetId == $assetId and ((.resolved // false) == false)))
    | sort_by(.createdAt)
    | reverse
    | .[0] // null
  '
}

render_output() {
  local selected_alert="$1"
  local dry_run_flag="$2"
  local response_body="$3"
  local refreshed_alert="$4"

  if [[ "$OUTPUT_FORMAT" == 'json' ]]; then
    jq -n \
      --arg action "$ACTION" \
      --arg assetId "$ASSET_ID" \
      --arg hostname "$HOSTNAME_MATCH" \
      --argjson dryRun "$dry_run_flag" \
      --argjson selectedAlert "$selected_alert" \
      --argjson responseBody "$response_body" \
      --argjson refreshedAlert "$refreshed_alert" \
      '{action:$action, dryRun:$dryRun, assetId:$assetId, hostname:$hostname, selectedAlert:$selectedAlert, response:$responseBody, refreshedAlert:$refreshedAlert}'
    return 0
  fi

  printf 'OpenSCAP action: %s\n' "$ACTION"
  printf 'Host asset id: %s\n' "$ASSET_ID"
  printf '%s\n' "$selected_alert" | jq -r '
    "Target alert: " + .title + "\n" +
    "Target alert id: " + .id + "\n" +
    "Target alert time: " + (.createdAt // .created_at) + "\n" +
    "Target alert resolved: " + ((.resolved // false)|tostring) + "\n" +
    "Target alert acknowledged: " + ((.acknowledged // false)|tostring)
  '
  if [[ "$dry_run_flag" == 'true' ]]; then
    printf 'Dry run: no API mutation was sent\n'
    return 0
  fi

  printf 'API response: %s\n' "$response_body"
  printf '%s\n' "$refreshed_alert" | jq -r '
    "Updated alert resolved: " + ((.resolved // false)|tostring) + "\n" +
    "Updated alert acknowledged: " + ((.acknowledged // false)|tostring)
  '
}

main() {
  load_env_defaults
  parse_args "$@"

  require_command curl
  require_command jq
  validate_action

  if [[ -z "$ADMIN_EMAIL" || -z "$ADMIN_PASSWORD" ]]; then
    echo 'Missing admin credentials. Set backend/.env or pass --admin-email/--admin-password.' >&2
    exit 1
  fi

  login
  discover_asset

  local asset_alerts global_alerts selected_alert response_body refreshed_alert dry_run_json
  asset_alerts="$(fetch_asset_alerts)"
  global_alerts="$(fetch_global_alerts)"
  selected_alert="$(select_alert "$global_alerts" "$asset_alerts")"
  if [[ "$selected_alert" == 'null' ]]; then
    echo 'No matching actionable OpenSCAP alert was found for the target asset.' >&2
    exit 1
  fi

  dry_run_json='false'
  response_body='null'
  refreshed_alert="$selected_alert"

  if [[ "$DRY_RUN" -eq 1 ]]; then
    dry_run_json='true'
    render_output "$selected_alert" "$dry_run_json" "$response_body" "$refreshed_alert"
    return 0
  fi

  response_body="$(api_put "/api/alerts/$(printf '%s' "$selected_alert" | jq -r '.id')/$ACTION")"
  refreshed_alert="$(printf '%s' "$(fetch_global_alerts)" | jq -c --arg alertId "$(printf '%s' "$selected_alert" | jq -r '.id')" '.items | map(select(.id == $alertId)) | .[0] // null')"
  if [[ "$refreshed_alert" == 'null' ]]; then
    refreshed_alert="$selected_alert"
  fi
  if [[ "$ACTION" == 'resolve' ]]; then
    refreshed_alert="$(printf '%s' "$refreshed_alert" | jq -c '.resolved = true')"
  elif [[ "$ACTION" == 'acknowledge' ]]; then
    refreshed_alert="$(printf '%s' "$refreshed_alert" | jq -c '.acknowledged = true')"
  fi
  render_output "$selected_alert" "$dry_run_json" "$response_body" "$refreshed_alert"
}

main "$@"