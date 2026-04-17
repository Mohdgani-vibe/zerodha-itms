#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  echo "Run this script with sudo or as root."
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_ENV_FILE="${BACKEND_ENV_FILE:-$REPO_ROOT/backend/.env}"
SALT_API_PORT="${SALT_API_PORT:-8000}"
SALT_API_EAUTH="${SALT_API_EAUTH:-file}"
SALT_API_USER="${SALT_API_USER:-itms-salt}"
SALT_API_PASSWORD="${SALT_API_PASSWORD:-ChangeMe-Salt-API!}"
SALT_API_AUTH_FILE="${SALT_API_AUTH_FILE:-/etc/salt/itms-api-users.conf}"

pip_install_compat() {
  if python3 -m pip install --help 2>/dev/null | grep -q -- '--break-system-packages'; then
    python3 -m pip install --break-system-packages "$@"
    return 0
  fi

  python3 -m pip install "$@"
}

ensure_salt_api_user() {
  if ! id -u "$SALT_API_USER" >/dev/null 2>&1; then
    useradd --create-home --shell /bin/bash "$SALT_API_USER"
  fi

  usermod --shell /bin/bash "$SALT_API_USER"
  echo "${SALT_API_USER}:${SALT_API_PASSWORD}" | chpasswd
  usermod --unlock "$SALT_API_USER" || true
  chage -E -1 -I -1 -m 0 -M 99999 "$SALT_API_USER" || true
}

fix_salt_config_permissions() {
  if getent group salt >/dev/null 2>&1; then
    chgrp salt /etc/salt/itms-api-users.conf /etc/salt/master.d/itms-api.conf 2>/dev/null || true
    chmod 640 /etc/salt/itms-api-users.conf 2>/dev/null || true
    chmod 644 /etc/salt/master.d/itms-api.conf 2>/dev/null || true

    if [[ -f /etc/salt/minion.d/itms.conf ]]; then
      chgrp salt /etc/salt/minion.d/itms.conf 2>/dev/null || true
      chmod 640 /etc/salt/minion.d/itms.conf 2>/dev/null || true
    fi
  fi
}

write_salt_auth_config() {
  install -m 600 /dev/null "$SALT_API_AUTH_FILE"
  printf '%s:%s\n' "$SALT_API_USER" "$SALT_API_PASSWORD" >"$SALT_API_AUTH_FILE"

  mkdir -p /etc/salt/master.d
  cat >/etc/salt/master.d/itms-api.conf <<EOF
rest_cherrypy:
  port: ${SALT_API_PORT}
  host: 0.0.0.0
  disable_ssl: true

external_auth:
  file:
    ^filename: ${SALT_API_AUTH_FILE}
    ${SALT_API_USER}:
      - .*
      - '@wheel'
      - '@runner'
      - '@jobs'
EOF
}

wait_for_salt_api_login() {
  local probe_output=""
  local attempt

  for attempt in $(seq 1 15); do
    probe_output=$(curl -i -sS -X POST "http://127.0.0.1:${SALT_API_PORT}/login" \
      -H 'Content-Type: application/json' \
      -d "{\"username\":\"${SALT_API_USER}\",\"password\":\"${SALT_API_PASSWORD}\",\"eauth\":\"${SALT_API_EAUTH}\"}" 2>/dev/null || true)
    if printf '%s\n' "$probe_output" | grep -q "HTTP/1.1 200"; then
      printf '%s\n' "$probe_output" | sed -n '1,20p'
      return 0
    fi
    sleep 1
  done

  printf '%s\n' "$probe_output" | sed -n '1,20p'
  return 1
}

cleanup_rogue_salt_api() {
  local pids
  pids=$(ss -ltnp "( sport = :${SALT_API_PORT} )" 2>/dev/null | sed -n 's/.*pid=\([0-9]\+\).*/\1/p' | sort -u)
  if [[ -z "$pids" ]]; then
    return 0
  fi

  while read -r pid; do
    [[ -z "$pid" ]] && continue
    local owner
    owner=$(ps -o user= -p "$pid" 2>/dev/null | awk '{print $1}')
    if [[ "$owner" != "root" && "$owner" != "salt" ]]; then
      echo "Stopping rogue salt-api listener pid=${pid} owner=${owner}" >&2
      kill "$pid" || true
    fi
  done <<< "$pids"

  sleep 1
}

ensure_python_distribution() {
  local module_name="$1"
  local package_name="$2"

  if python3 - <<PY >/dev/null 2>&1
import importlib.metadata
import sys

try:
    importlib.metadata.version(${module_name@Q})
except importlib.metadata.PackageNotFoundError:
    sys.exit(1)
PY
  then
    return 0
  fi

  pip_install_compat "$package_name"
}

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y python3-pip salt-api python3-cherrypy3 apache2-utils

ensure_python_distribution "contextvars" "contextvars"

if ! python3 - <<'PY' >/dev/null 2>&1
import cherrypy
PY
then
  pip_install_compat cherrypy
fi

ensure_salt_api_user

cleanup_rogue_salt_api

write_salt_auth_config
fix_salt_config_permissions

systemctl enable --now salt-master
systemctl restart salt-master
systemctl restart salt-api

if [[ -f "$BACKEND_ENV_FILE" ]]; then
  python3 - "$BACKEND_ENV_FILE" "$SALT_API_PORT" "$SALT_API_USER" "$SALT_API_PASSWORD" "$SALT_API_EAUTH" <<'PY'
import pathlib
import sys

env_path = pathlib.Path(sys.argv[1])
salt_api_port = sys.argv[2]
salt_api_user = sys.argv[3]
salt_api_password = sys.argv[4]
salt_api_eauth = sys.argv[5]
text = env_path.read_text() if env_path.exists() else ""
updates = {
    "SALT_API_BASE_URL": f"http://127.0.0.1:{salt_api_port}",
    "SALT_API_TOKEN": "",
    "SALT_API_USERNAME": salt_api_user,
    "SALT_API_PASSWORD": salt_api_password,
    "SALT_API_EAUTH": salt_api_eauth,
}

lines = text.splitlines()
present = {line.split('=', 1)[0]: idx for idx, line in enumerate(lines) if '=' in line and not line.lstrip().startswith('#')}
for key, value in updates.items():
    rendered = f"{key}={value}"
    if key in present:
        lines[present[key]] = rendered
    else:
        lines.append(rendered)
env_path.write_text("\n".join(lines).rstrip() + "\n")
PY
fi

echo
echo "salt-api repair complete"
echo "status:"
systemctl --no-pager --full status salt-api | sed -n '1,40p'
echo
echo "login probe:"
if ! wait_for_salt_api_login; then
  echo "salt-api login probe did not return HTTP 200" >&2
  exit 1
fi