#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
XDG_CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"
XDG_DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
XDG_STATE_HOME="${XDG_STATE_HOME:-$HOME/.local/state}"
CONFIG_DIR="$XDG_CONFIG_HOME/itms"
USER_UNIT_DIR="$XDG_CONFIG_HOME/systemd/user"
INSTALL_DIR="$XDG_DATA_HOME/itms"
BIN_DIR="$HOME/.local/bin"
ENV_FILE="$CONFIG_DIR/openscap.env"
RUNNER_PATH="$BIN_DIR/itms-run-openscap-scan.sh"
COLLECTOR_SOURCE_DEFAULT="$REPO_ROOT/scripts/push-system-inventory.py"
COLLECTOR_TARGET="$INSTALL_DIR/push-system-inventory.py"
SERVICE_PATH="$USER_UNIT_DIR/itms-openscap-scan.service"
TIMER_PATH="$USER_UNIT_DIR/itms-openscap-scan.timer"
CONTENT_TARGET_DIR="$INSTALL_DIR/openscap/content"
RESULTS_DIR="$XDG_STATE_HOME/itms/openscap"
PROFILE="xccdf_org.ssgproject.content_profile_standard"
SCAN_HOURS="24"
SERVER_URL=""
INGEST_TOKEN=""
COLLECTOR_URL=""
OPENSCAP_DATASTREAM=""
CONTENT_RELEASE="${OPENSCAP_CONTENT_RELEASE:-v0.1.80}"
INCLUDE_INGEST=1

usage() {
  cat <<'EOF'
Usage:
  scripts/install-itms-openscap-user-runner.sh --server-url http://127.0.0.1:3001 --token <inventory_ingest_token> [options]

Options:
  --server-url URL          Backend base URL used for inventory ingest
  --token TOKEN             Inventory ingest token
  --openscap-profile ID     OpenSCAP profile id, default: xccdf_org.ssgproject.content_profile_standard
  --openscap-datastream PATH
                            Existing datastream path; if omitted, the helper downloads distro-matched content
  --openscap-results-dir DIR
                            Directory for scan results, default: ~/.local/state/itms/openscap
  --scan-hours N            Timer interval in hours, default: 24
  --collector-url URL       Download collector from URL instead of copying the repo version
  --no-ingest               Run scheduled scans without posting results to ITMS
  --help                    Show this message
EOF
}

log() {
  printf '[install-itms-openscap-user-runner] %s\n' "$*"
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --server-url)
        SERVER_URL="${2:-}"
        shift 2
        ;;
      --token)
        INGEST_TOKEN="${2:-}"
        shift 2
        ;;
      --openscap-profile)
        PROFILE="${2:-}"
        shift 2
        ;;
      --openscap-datastream)
        OPENSCAP_DATASTREAM="${2:-}"
        shift 2
        ;;
      --openscap-results-dir)
        RESULTS_DIR="${2:-}"
        shift 2
        ;;
      --scan-hours)
        SCAN_HOURS="${2:-}"
        shift 2
        ;;
      --collector-url)
        COLLECTOR_URL="${2:-}"
        shift 2
        ;;
      --no-ingest)
        INCLUDE_INGEST=0
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

install_collector() {
  install -d -m 0755 "$INSTALL_DIR"
  if [[ -f "$COLLECTOR_SOURCE_DEFAULT" ]]; then
    install -m 0755 "$COLLECTOR_SOURCE_DEFAULT" "$COLLECTOR_TARGET"
    return 0
  fi
  if [[ -z "$COLLECTOR_URL" ]]; then
    echo 'Collector source is unavailable; pass --collector-url or run from the repo checkout.' >&2
    exit 1
  fi
  curl -fsSL "$COLLECTOR_URL" -o "$COLLECTOR_TARGET"
  chmod 0755 "$COLLECTOR_TARGET"
}

ensure_datastream() {
  if [[ -n "$OPENSCAP_DATASTREAM" && -f "$OPENSCAP_DATASTREAM" ]]; then
    return 0
  fi

  OPENSCAP_DATASTREAM="$($REPO_ROOT/scripts/setup-itms-openscap-content.sh --release "$CONTENT_RELEASE" --target-dir "$CONTENT_TARGET_DIR" --print-path)"
  if [[ -z "$OPENSCAP_DATASTREAM" || ! -f "$OPENSCAP_DATASTREAM" ]]; then
    echo 'Failed to provision an OpenSCAP datastream.' >&2
    exit 1
  fi
}

write_env_file() {
  install -d -m 0700 "$CONFIG_DIR"
  umask 077
  : > "$ENV_FILE"
  {
    printf 'ITMS_OPENSCAP_PROFILE=%q\n' "$PROFILE"
    printf 'ITMS_OPENSCAP_DATASTREAM=%q\n' "$OPENSCAP_DATASTREAM"
    printf 'ITMS_OPENSCAP_RESULTS_DIR=%q\n' "$RESULTS_DIR"
    if [[ "$INCLUDE_INGEST" -eq 1 ]]; then
      printf 'ITMS_SERVER_URL=%q\n' "$SERVER_URL"
      printf 'ITMS_INGEST_TOKEN=%q\n' "$INGEST_TOKEN"
      printf 'ITMS_INCLUDE_OPENSCAP_REPORT=true\n'
    fi
  } >> "$ENV_FILE"
  chmod 0600 "$ENV_FILE"
}

write_runner() {
  install -d -m 0755 "$BIN_DIR" "$INSTALL_DIR" "$RESULTS_DIR"
  cat > "$RUNNER_PATH" <<EOF
#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="$ENV_FILE"
if [[ -f "\$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  . "\$ENV_FILE"
  set +a
fi

if ! command -v oscap >/dev/null 2>&1; then
  echo 'oscap not found' >&2
  exit 1
fi

if [[ -z "\${ITMS_OPENSCAP_DATASTREAM:-}" || ! -f "\${ITMS_OPENSCAP_DATASTREAM}" ]]; then
  echo 'OpenSCAP datastream is not configured' >&2
  exit 1
fi

RESULTS_DIR="\${ITMS_OPENSCAP_RESULTS_DIR:-$RESULTS_DIR}"
PROFILE="\${ITMS_OPENSCAP_PROFILE:-xccdf_org.ssgproject.content_profile_standard}"
mkdir -p "\$RESULTS_DIR"
STAMP="\$(date -u +%Y%m%dT%H%M%SZ)"
RESULTS_FILE="\$RESULTS_DIR/openscap-results-\$STAMP.xml"
REPORT_FILE="\$RESULTS_DIR/openscap-report-\$STAMP.html"

set +e
oscap xccdf eval \
  --profile "\$PROFILE" \
  --results "\$RESULTS_FILE" \
  --report "\$REPORT_FILE" \
  "\$ITMS_OPENSCAP_DATASTREAM"
SCAN_EXIT=\$?
set -e

if [[ -n "\${ITMS_SERVER_URL:-}" && -n "\${ITMS_INGEST_TOKEN:-}" && -f "$COLLECTOR_TARGET" ]]; then
  /usr/bin/python3 "$COLLECTOR_TARGET" \
    --server-url "\$ITMS_SERVER_URL" \
    --token "\$ITMS_INGEST_TOKEN" \
    --no-software-scan \
    --include-openscap-report \
    --openscap-results-dir "\$RESULTS_DIR" || true
fi

exit "\$SCAN_EXIT"
EOF
  chmod 0755 "$RUNNER_PATH"
}

write_units() {
  install -d -m 0755 "$USER_UNIT_DIR"
  cat > "$SERVICE_PATH" <<EOF
[Unit]
Description=Run scheduled ITMS OpenSCAP scan (user)
After=default.target

[Service]
Type=oneshot
EnvironmentFile=$ENV_FILE
ExecStart=$RUNNER_PATH
SuccessExitStatus=2

[Install]
WantedBy=default.target
EOF

  cat > "$TIMER_PATH" <<EOF
[Unit]
Description=Run ITMS OpenSCAP scan every $SCAN_HOURS hours (user)

[Timer]
OnBootSec=15min
OnUnitActiveSec=${SCAN_HOURS}h
Persistent=true
Unit=itms-openscap-scan.service

[Install]
WantedBy=timers.target
EOF
}

main() {
  parse_args "$@"
  require_command oscap
  require_command systemctl
  require_command python3
  require_command curl
  require_command unzip

  if [[ "$INCLUDE_INGEST" -eq 1 && ( -z "$SERVER_URL" || -z "$INGEST_TOKEN" ) ]]; then
    echo '--server-url and --token are required unless --no-ingest is used.' >&2
    exit 1
  fi

  install_collector
  ensure_datastream
  write_env_file
  write_runner
  write_units

  systemctl --user daemon-reload
  systemctl --user enable --now itms-openscap-scan.timer
  log "Installed user timer at $TIMER_PATH"
  log "Runner uses datastream $OPENSCAP_DATASTREAM"
  log 'This user-level timer runs without root privileges, so some OpenSCAP probes may remain permission-limited.'
}

main "$@"