SHELL := /bin/bash

.PHONY: start stop restart status smoke-test

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