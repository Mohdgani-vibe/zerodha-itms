#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$REPO_ROOT/backend"
COMPOSE_FILE="$BACKEND_DIR/docker-compose.yml"
ENV_EXAMPLE="$BACKEND_DIR/.env.example"
ENV_FILE="$BACKEND_DIR/.env"
DETACH=0

if [[ "${1:-}" == "--detach" ]]; then
  DETACH=1
fi

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_command sudo
require_command curl
require_command gpg
require_command dpkg
require_command tee

if [[ ! -f /etc/os-release ]]; then
  echo "Cannot determine OS: /etc/os-release is missing" >&2
  exit 1
fi

. /etc/os-release

if [[ "${ID:-}" != "ubuntu" ]]; then
  echo "This installer currently supports Ubuntu only. Detected: ${ID:-unknown}" >&2
  exit 1
fi

if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "Compose file not found: $COMPOSE_FILE" >&2
  exit 1
fi

echo "Installing Docker Engine and Compose plugin for Ubuntu ${VERSION_ID:-unknown}..."
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings

if [[ ! -f /etc/apt/keyrings/docker.gpg ]]; then
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
fi

sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker

if ! getent group docker >/dev/null 2>&1; then
  sudo groupadd docker
fi

if ! id -nG "$USER" | grep -qw docker; then
  sudo usermod -aG docker "$USER"
  echo "Added $USER to the docker group. Future shells will pick that up after re-login."
fi

if [[ ! -f "$ENV_FILE" ]]; then
  cp "$ENV_EXAMPLE" "$ENV_FILE"
  echo "Created $ENV_FILE from $ENV_EXAMPLE"
fi

cd "$REPO_ROOT"

echo "Docker version:"
sudo docker --version
echo "Docker Compose version:"
sudo docker compose version

echo "Starting ITMS stack from $COMPOSE_FILE ..."
if [[ "$DETACH" -eq 1 ]]; then
  sudo docker compose -f "$COMPOSE_FILE" up --build -d
  echo "ITMS stack started in detached mode."
  echo "Use: sudo docker compose -f $COMPOSE_FILE logs -f"
else
  sudo docker compose -f "$COMPOSE_FILE" up --build
fi