SHELL := /bin/bash

.PHONY: start stop restart status smoke-test install-autostart autostart-status autostart-logs watchdog-status watchdog-run

start:
	bash scripts/start-itms.sh

stop:
	bash scripts/stop-itms.sh

restart: stop start

status:
	@printf 'Frontend: '
	@curl -I -sS http://localhost:4175 >/dev/null && echo up || echo down
	@printf 'Backend: '
	@curl -fsS http://localhost:3001/api/health >/dev/null && echo up || echo down

smoke-test:
	bash scripts/smoke-test-itms-api.sh

install-autostart:
	bash scripts/install-itms-autostart.sh

autostart-status:
	systemctl --user --no-pager --full status itms-stack.service

autostart-logs:
	journalctl --user -u itms-stack.service -n 100 --no-pager

watchdog-status:
	systemctl --user --no-pager --full status itms-stack-watchdog.timer

watchdog-run:
	bash scripts/check-itms-stack-health.sh