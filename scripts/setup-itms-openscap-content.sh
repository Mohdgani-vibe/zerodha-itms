#!/usr/bin/env bash
set -euo pipefail

RELEASE_TAG="${OPENSCAP_CONTENT_RELEASE:-v0.1.80}"
TARGET_DIR="${OPENSCAP_TARGET_DIR:-$HOME/.local/share/itms/openscap}"
FORCE_DOWNLOAD=0
PRINT_PATH=0

usage() {
  cat <<'EOF'
Usage:
  scripts/setup-itms-openscap-content.sh [options]

Options:
  --release TAG      ComplianceAsCode release tag, default: v0.1.80
  --target-dir PATH  Directory to store the datastream, default: $HOME/.local/share/itms/openscap
  --force            Re-download even if the datastream already exists
  --print-path       Print the resulting datastream path
  --help             Show this message
EOF
}

log() {
  printf '[setup-itms-openscap-content] %s\n' "$*" >&2
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

platform_id() {
  if [[ ! -f /etc/os-release ]]; then
    echo '/etc/os-release not found' >&2
    return 1
  fi

  # shellcheck disable=SC1091
  . /etc/os-release
  if [[ -z "${ID:-}" || -z "${VERSION_ID:-}" ]]; then
    echo 'Unable to detect Linux distribution/version from /etc/os-release' >&2
    return 1
  fi

  printf '%s%s\n' "$ID" "${VERSION_ID//./}"
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --release)
        RELEASE_TAG="${2:-}"
        shift 2
        ;;
      --target-dir)
        TARGET_DIR="${2:-}"
        shift 2
        ;;
      --force)
        FORCE_DOWNLOAD=1
        shift
        ;;
      --print-path)
        PRINT_PATH=1
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

main() {
  parse_args "$@"
  require_command curl
  require_command unzip

  local distro_id datastream_name target_path release_version archive_url tmp_dir archive_path archive_member
  distro_id="$(platform_id)"
  datastream_name="ssg-${distro_id}-ds.xml"
  target_path="$TARGET_DIR/$datastream_name"

  if [[ "$FORCE_DOWNLOAD" -eq 0 && -f "$target_path" ]]; then
    [[ "$PRINT_PATH" -eq 1 ]] && printf '%s\n' "$target_path"
    return 0
  fi

  release_version="${RELEASE_TAG#v}"
  archive_url="https://github.com/ComplianceAsCode/content/releases/download/${RELEASE_TAG}/scap-security-guide-${release_version}.zip"
  tmp_dir="$(mktemp -d)"
  archive_path="$tmp_dir/scap-security-guide.zip"
  trap '[[ -n "${tmp_dir:-}" ]] && rm -rf "$tmp_dir"' EXIT

  log "Downloading ${archive_url}"
  curl -fsSL "$archive_url" -o "$archive_path"
  archive_member="$(unzip -Z1 "$archive_path" | grep "/${datastream_name}$" | head -n 1 || true)"
  if [[ -z "$archive_member" ]]; then
    echo "Datastream ${datastream_name} not found in ${archive_url}" >&2
    exit 1
  fi

  mkdir -p "$TARGET_DIR"
  unzip -p "$archive_path" "$archive_member" > "$target_path"
  chmod 0644 "$target_path"

  log "Installed ${target_path}"
  [[ "$PRINT_PATH" -eq 1 ]] && printf '%s\n' "$target_path"
}

main "$@"