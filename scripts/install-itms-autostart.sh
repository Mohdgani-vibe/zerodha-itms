#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SYSTEMD_USER_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
UNIT_NAME="itms-stack.service"
UNIT_PATH="$SYSTEMD_USER_DIR/$UNIT_NAME"
WATCHDOG_UNIT_NAME="itms-stack-watchdog.service"
WATCHDOG_UNIT_PATH="$SYSTEMD_USER_DIR/$WATCHDOG_UNIT_NAME"
WATCHDOG_TIMER_NAME="itms-stack-watchdog.timer"
WATCHDOG_TIMER_PATH="$SYSTEMD_USER_DIR/$WATCHDOG_TIMER_NAME"
ENABLE_LINGER=0

if [[ "${1:-}" == "--enable-linger" ]]; then
	ENABLE_LINGER=1
fi

require_command() {
	if ! command -v "$1" >/dev/null 2>&1; then
		echo "Missing required command: $1" >&2
		exit 1
	fi
}

require_command systemctl

chmod +x "$REPO_ROOT/scripts/check-itms-stack-health.sh"

mkdir -p "$SYSTEMD_USER_DIR"

cat > "$UNIT_PATH" <<EOF
[Unit]
Description=ITMS stack frontend supervisor
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$REPO_ROOT
Environment=FRONTEND_FORCE_RESTART=1
ExecStart=$REPO_ROOT/scripts/start-itms.sh
Restart=always
RestartSec=5
TimeoutStopSec=15
KillMode=control-group

[Install]
WantedBy=default.target
EOF

cat > "$WATCHDOG_UNIT_PATH" <<EOF
[Unit]
Description=ITMS stack health watchdog
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
WorkingDirectory=$REPO_ROOT
ExecStart=$REPO_ROOT/scripts/check-itms-stack-health.sh
EOF

cat > "$WATCHDOG_TIMER_PATH" <<EOF
[Unit]
Description=Run ITMS stack health watchdog every minute

[Timer]
OnBootSec=1min
OnUnitActiveSec=1min
Unit=$WATCHDOG_UNIT_NAME

[Install]
WantedBy=timers.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now "$UNIT_NAME"
systemctl --user enable --now "$WATCHDOG_TIMER_NAME"

linger_state="unknown"
if command -v loginctl >/dev/null 2>&1; then
	linger_state="$(loginctl show-user "$USER" -p Linger --value 2>/dev/null || echo unknown)"
	if [[ "$ENABLE_LINGER" == "1" && "$linger_state" != "yes" ]]; then
		if command -v sudo >/dev/null 2>&1 && sudo -n loginctl enable-linger "$USER" >/dev/null 2>&1; then
			linger_state="yes"
		else
			echo "Could not enable linger automatically. Run: sudo loginctl enable-linger $USER" >&2
		fi
		fi
	fi

echo "Installed and started user service: $UNIT_NAME"
echo "Unit file: $UNIT_PATH"
echo "Installed and started user timer: $WATCHDOG_TIMER_NAME"
echo "Timer file: $WATCHDOG_TIMER_PATH"
if [[ "$linger_state" == "yes" ]]; then
	echo "User linger is enabled, so the service can survive logout and start on boot."
elif [[ "$linger_state" == "no" ]]; then
	echo "User linger is disabled. To keep ITMS up across logout and reboot, run: sudo loginctl enable-linger $USER"
fi

systemctl --user --no-pager --full status "$UNIT_NAME" | sed -n '1,40p'
systemctl --user --no-pager --full status "$WATCHDOG_TIMER_NAME" | sed -n '1,30p'