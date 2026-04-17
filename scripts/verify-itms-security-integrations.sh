#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_ENV_FILE="${BACKEND_ENV_FILE:-$REPO_ROOT/backend/.env}"
BACKEND_URL="${BACKEND_URL:-http://127.0.0.1:3001}"
ADMIN_EMAIL="${ADMIN_EMAIL:-}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"
INGEST_TOKEN="${INGEST_TOKEN:-}"
HOSTNAME_MATCH="${HOSTNAME_MATCH:-$(hostname -s)}"
ASSET_ID="${ASSET_ID:-}"
WAZUH_AGENT_ID="${WAZUH_AGENT_ID:-}"
OPENSCAP_PROFILE="${OPENSCAP_PROFILE:-xccdf_org.ssgproject.content_profile_standard}"
OPENSCAP_DATASTREAM="${OPENSCAP_DATASTREAM:-}"
OPENSCAP_RESULTS_DIR="${OPENSCAP_RESULTS_DIR:-$HOME/.local/state/itms/openscap}"
OPENSCAP_USE_SUDO="auto"
RUN_WAZUH=1
RUN_CLAMAV=1
RUN_OPENSCAP=1
CLAMAV_SCAN_PATHS=(/etc/hosts /etc/os-release)
AUTH_TOKEN=""

usage() {
  cat <<'EOF'
Usage:
  scripts/verify-itms-security-integrations.sh [options]

Options:
  --backend-url URL          Backend base URL, default: http://127.0.0.1:3001
  --admin-email EMAIL        Admin login email, default: DEFAULT_ADMIN_EMAIL from backend/.env
  --admin-password PASS      Admin login password, default: DEFAULT_ADMIN_PASSWORD from backend/.env
  --token TOKEN              Inventory ingest token, default: INVENTORY_INGEST_TOKEN from backend/.env
  --hostname NAME            Hostname to match in ITMS, default: current short hostname
  --asset-id UUID            Skip asset discovery and use this asset id
  --wazuh-agent-id ID        Wazuh agent id to report through the collector
  --clamav-scan-path PATH    Path to include in the ClamAV verification scan; can be passed multiple times
  --openscap-profile ID      OpenSCAP profile id, default: xccdf_org.ssgproject.content_profile_standard
  --openscap-datastream PATH Use an existing OpenSCAP datastream instead of auto-downloading one
  --openscap-results-dir DIR Directory for OpenSCAP result files, default: $HOME/.local/state/itms/openscap
  --openscap-sudo MODE       OpenSCAP privilege mode: auto, always, or never. Default: auto
  --skip-wazuh               Skip Wazuh verification
  --skip-clamav              Skip ClamAV verification
  --skip-openscap            Skip OpenSCAP verification
  --help                     Show this message
EOF
}

log() {
  printf '[verify-itms-security-integrations] %s\n' "$*"
}

log_err() {
  printf '[verify-itms-security-integrations] %s\n' "$*" >&2
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
    INGEST_TOKEN="${INGEST_TOKEN:-${INVENTORY_INGEST_TOKEN:-}}"
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
      --token)
        INGEST_TOKEN="${2:-}"
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
      --wazuh-agent-id)
        WAZUH_AGENT_ID="${2:-}"
        shift 2
        ;;
      --clamav-scan-path)
        CLAMAV_SCAN_PATHS+=("${2:-}")
        shift 2
        ;;
      --openscap-profile)
        OPENSCAP_PROFILE="${2:-}"
        shift 2
        ;;
      --openscap-datastream)
        OPENSCAP_DATASTREAM="${2:-}"
        shift 2
        ;;
      --openscap-results-dir)
        OPENSCAP_RESULTS_DIR="${2:-}"
        shift 2
        ;;
      --openscap-sudo)
        OPENSCAP_USE_SUDO="${2:-}"
        shift 2
        ;;
      --skip-wazuh)
        RUN_WAZUH=0
        shift
        ;;
      --skip-clamav)
        RUN_CLAMAV=0
        shift
        ;;
      --skip-openscap)
        RUN_OPENSCAP=0
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

api_get() {
  local path="$1"
  curl -fsS -H "Authorization: Bearer $AUTH_TOKEN" "$BACKEND_URL$path"
}

collector_cmd() {
  python3 "$REPO_ROOT/scripts/push-system-inventory.py" --server-url "$BACKEND_URL" --token "$INGEST_TOKEN" "$@"
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

latest_alert_line() {
  local source_name="$1"
  local alerts_json="$2"
  printf '%s' "$alerts_json" | jq -r --arg source "$source_name" '
    map(select(.source == $source))
    | sort_by(.created_at)
    | reverse
    | .[0] // empty
    | if . == "" then empty else (.title + " | resolved=" + (.resolved|tostring) + " | id=" + .id) end
  '
}

verify_salt() {
  local terminal_json
  terminal_json="$(api_get "/api/assets/$ASSET_ID/terminal")"
  printf '%s' "$terminal_json" | jq -e '.url and .minion_id' >/dev/null
  log "Salt verified: $(printf '%s' "$terminal_json" | jq -r '.minion_id + " -> " + .url')"
}

verify_wazuh() {
  local effective_wazuh_agent_id="$WAZUH_AGENT_ID"
  if [[ -z "$effective_wazuh_agent_id" ]]; then
    effective_wazuh_agent_id="$(api_get "/api/assets/$ASSET_ID" | jq -r '.wazuh_agent_id // empty')"
  fi
  if [[ -z "$effective_wazuh_agent_id" ]]; then
    echo 'Wazuh agent id is not configured for this asset. Pass --wazuh-agent-id to verify Wazuh.' >&2
    exit 1
  fi

  collector_cmd --no-software-scan --wazuh-agent-id "$effective_wazuh_agent_id" >/dev/null
  local latest
  latest="$(latest_alert_line 'wazuh' "$(fetch_asset_alerts)")"
  if [[ -z "$latest" ]]; then
    echo 'No Wazuh alert found on the asset after verification run.' >&2
    exit 1
  fi
  log "Wazuh verified: $latest"
}

verify_clamav() {
  local args=(--no-software-scan --include-clamav-report)
  local path
  for path in "${CLAMAV_SCAN_PATHS[@]}"; do
    args+=(--clamav-scan-path "$path")
  done

  collector_cmd "${args[@]}" >/dev/null
  local latest
  latest="$(latest_alert_line 'clamav' "$(fetch_asset_alerts)")"
  if [[ -z "$latest" ]]; then
    echo 'No ClamAV alert found on the asset after verification run.' >&2
    exit 1
  fi
  log "ClamAV verified: $latest"
}

ensure_openscap_datastream() {
  if [[ -n "$OPENSCAP_DATASTREAM" && -f "$OPENSCAP_DATASTREAM" ]]; then
    return 0
  fi

  OPENSCAP_DATASTREAM="$($REPO_ROOT/scripts/setup-itms-openscap-content.sh --print-path)"
  if [[ -z "$OPENSCAP_DATASTREAM" || ! -f "$OPENSCAP_DATASTREAM" ]]; then
    echo 'OpenSCAP datastream is unavailable after setup.' >&2
    exit 1
  fi
}

openscap_command_prefix() {
  case "$OPENSCAP_USE_SUDO" in
    auto)
      if [[ "$(id -u)" -eq 0 ]]; then
        return 0
      fi
      if command -v sudo >/dev/null 2>&1 && sudo -n true >/dev/null 2>&1; then
        printf 'sudo\n'
        printf '-n\n'
      fi
      ;;
    always)
      if [[ "$(id -u)" -eq 0 ]]; then
        return 0
      fi
      require_command sudo
      if ! sudo -n true >/dev/null 2>&1; then
        echo 'OpenSCAP sudo mode was set to always, but passwordless sudo is unavailable.' >&2
        exit 1
      fi
      printf 'sudo\n'
      printf '-n\n'
      ;;
    never)
      return 0
      ;;
    *)
      echo "Invalid --openscap-sudo value: ${OPENSCAP_USE_SUDO}. Use auto, always, or never." >&2
      exit 1
      ;;
  esac
}

run_openscap_eval() {
  local results_file="$1"
  local report_file="$2"
  local stderr_file scan_exit
  local -a command_prefix

  mapfile -t command_prefix < <(openscap_command_prefix)
  stderr_file="$(mktemp)"

  if [[ "${#command_prefix[@]}" -gt 0 ]]; then
    log_err 'Running OpenSCAP with sudo for fuller probe coverage.'
  elif [[ "$(id -u)" -ne 0 ]]; then
    log_err 'Running OpenSCAP without sudo; some probes may report permission-limited results.'
  fi

  set +e
  "${command_prefix[@]}" oscap xccdf eval \
    --profile "$OPENSCAP_PROFILE" \
    --results "$results_file" \
    --report "$report_file" \
    "$OPENSCAP_DATASTREAM" >/dev/null 2>"$stderr_file"
  scan_exit=$?
  set -e

  if [[ -s "$stderr_file" ]]; then
    if grep -q 'Permission denied' "$stderr_file"; then
      log_err 'OpenSCAP reported permission-limited probes; rerun with sudo/root for the cleanest result.'
    fi
    if grep -q 'Obtrusive data from probe' "$stderr_file"; then
      log_err 'OpenSCAP emitted probe warnings; the report was still generated and ingested.'
    fi
  fi

  rm -f "$stderr_file"
  printf '%s\n' "$scan_exit"
}

verify_openscap() {
  ensure_openscap_datastream
  mkdir -p "$OPENSCAP_RESULTS_DIR"

  local stamp results_file report_file
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  results_file="$OPENSCAP_RESULTS_DIR/openscap-results-$stamp.xml"
  report_file="$OPENSCAP_RESULTS_DIR/openscap-report-$stamp.html"

  local scan_exit
  scan_exit="$(run_openscap_eval "$results_file" "$report_file")"

  if [[ ! -f "$results_file" ]]; then
    echo 'OpenSCAP did not produce a results file.' >&2
    exit 1
  fi

  collector_cmd --no-software-scan --include-openscap-report --openscap-results-dir "$OPENSCAP_RESULTS_DIR" >/dev/null
  local latest
  latest="$(latest_alert_line 'openscap' "$(fetch_asset_alerts)")"
  if [[ -z "$latest" ]]; then
    echo 'No OpenSCAP alert found on the asset after verification run.' >&2
    exit 1
  fi
  log "OpenSCAP verified: exit=$scan_exit | $latest"
}

main() {
  load_env_defaults
  parse_args "$@"

  require_command curl
  require_command jq
  require_command python3

  if [[ "$RUN_OPENSCAP" -eq 1 ]]; then
    require_command oscap
  fi
  if [[ -z "$ADMIN_EMAIL" || -z "$ADMIN_PASSWORD" ]]; then
    echo 'Missing admin credentials. Set backend/.env or pass --admin-email/--admin-password.' >&2
    exit 1
  fi
  if [[ -z "$INGEST_TOKEN" ]]; then
    echo 'Missing ingest token. Set backend/.env or pass --token.' >&2
    exit 1
  fi

  login
  log 'Syncing base inventory'
  collector_cmd --no-software-scan >/dev/null
  discover_asset
  log "Using asset ${ASSET_ID} for host ${HOSTNAME_MATCH}"

  verify_salt
  if [[ "$RUN_WAZUH" -eq 1 ]]; then
    verify_wazuh
  fi
  if [[ "$RUN_CLAMAV" -eq 1 ]]; then
    verify_clamav
  fi
  if [[ "$RUN_OPENSCAP" -eq 1 ]]; then
    verify_openscap
  fi

  log 'All requested security integrations verified successfully.'
}

main "$@"