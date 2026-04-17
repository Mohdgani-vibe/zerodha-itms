#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_LIVE_INTEGRATIONS=0
LIVE_WAZUH_AGENT_ID="${LIVE_WAZUH_AGENT_ID:-}"

usage() {
  cat <<'EOF'
Usage:
  scripts/check-itms-release-readiness.sh [options]

Options:
  --with-live-integrations  Also run the live Salt/Wazuh/ClamAV/OpenSCAP workflow verification
  --wazuh-agent-id ID       Optional Wazuh agent id override for the live verification step
  --help                    Show this message
EOF
}

log_step() {
  printf '\n[check-itms-release-readiness] %s\n' "$*"
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --with-live-integrations)
        RUN_LIVE_INTEGRATIONS=1
        shift
        ;;
      --wazuh-agent-id)
        LIVE_WAZUH_AGENT_ID="${2:-}"
        shift 2
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

main() {
  parse_args "$@"

  cd "$REPO_ROOT"

  log_step 'Checking Docker stack health'
  ./scripts/verify-itms-stack.sh

  log_step 'Running authenticated API smoke test'
  ./scripts/smoke-test-itms-api.sh

  log_step 'Checking server integration readiness'
  ./scripts/check-itms-server-integrations.sh

  if [[ "$RUN_LIVE_INTEGRATIONS" -eq 1 ]]; then
    log_step 'Running live integration verification'
    if [[ -n "$LIVE_WAZUH_AGENT_ID" ]]; then
      ./scripts/verify-itms-security-integrations.sh --wazuh-agent-id "$LIVE_WAZUH_AGENT_ID"
    else
      ./scripts/verify-itms-security-integrations.sh
    fi
  fi

  log_step 'Building frontend production bundle'
  (
    cd frontend
    npm run build
  )

  log_step 'Running backend compile and test pass'
  (
    cd backend
    go test ./...
  )

  log_step 'Summarizing OpenSCAP deployment state'
  bash "$REPO_ROOT/scripts/check-itms-openscap-status.sh" --json | jq -r '
    "OpenSCAP timer scope: " + .timer.scope + "\n" +
    "OpenSCAP timer state: " + .timer.timer.state + " / " + .timer.timer.active + "\n" +
    "OpenSCAP timer next run: " + .timer.timer.nextRun + "\n" +
    "OpenSCAP latest alert id: " + (.latestAlert.id // "none") + "\n" +
    "OpenSCAP latest alert resolved: " + ((.latestAlert.resolved // false)|tostring) + "\n" +
    "OpenSCAP latest alert detail: " + (.latestAlert.detail // "none")
  '

  log_step 'Release readiness checks completed successfully'
}

main "$@"