SHELL := /bin/bash

APP_NAME := itms-server

.PHONY: run run-host build tidy compose-up compose-down smoke-test start

run:
	bash ../scripts/start-itms-backend.sh

run-host:
	GOTOOLCHAIN=local go run ./cmd/server

start:
	bash ../scripts/start-itms-backend.sh

build:
	GOTOOLCHAIN=local go build -o ./bin/$(APP_NAME) ./cmd/server

tidy:
	GOTOOLCHAIN=local go mod tidy

compose-up:
	bash ../scripts/start-itms-backend.sh

compose-down:
	@if docker compose version >/dev/null 2>&1; then \
		docker compose down -v; \
	elif command -v docker-compose >/dev/null 2>&1; then \
		docker-compose down -v; \
	else \
		echo "Neither 'docker compose' nor 'docker-compose' is available." >&2; \
		exit 1; \
	fi

smoke-test:
	bash ../scripts/smoke-test-itms-api.sh
