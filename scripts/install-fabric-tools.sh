#!/usr/bin/env bash
#
# Install the Fabric binaries, config files and Docker images this repo needs,
# directly into the repo's own bin/ and config/ directories.
#
# No fabric-samples checkout is required (or wanted). Versions are pinned to
# what the repo is verified against: Fabric 3.1.5 binaries + CA 1.5.22, images
# hyperledger/fabric-{peer,orderer,ccenv,baseos}:3.1.5 and fabric-ca:1.5.22.
#
# Usage: ./scripts/install-fabric-tools.sh
# Env:   FABRIC_VERSION (default 3.1.5), CA_VERSION (default 1.5.22)
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
cd -- "$ROOT"

FABRIC_VERSION="${FABRIC_VERSION:-3.1.5}"
CA_VERSION="${CA_VERSION:-1.5.22}"
FABRIC_IMAGES=(peer orderer ccenv baseos)

MARCH="$(uname -m)"
case "$MARCH" in
  x86_64)  PLATFORM_ARCH="amd64" ;;
  aarch64|arm64) PLATFORM_ARCH="arm64" ;;
  *) echo "ERROR: unsupported architecture: $MARCH" >&2; exit 1 ;;
esac
PLATFORM="linux-${PLATFORM_ARCH}"

log_info() { printf '[%s] INFO: %s\n' "$(date +'%H:%M:%S')" "$*"; }
log_error() { printf '[%s] ERROR: %s\n' "$(date +'%H:%M:%S')" "$*" >&2; }

check_dependencies() {
  local -a required=("curl" "tar" "docker")
  local -a missing=()
  for cmd in "${required[@]}"; do
    command -v "$cmd" >/dev/null 2>&1 || missing+=("$cmd")
  done
  if [[ ${#missing[@]} -gt 0 ]]; then
    log_error "missing required commands: ${missing[*]}"
    return 1
  fi
}

binaries_present() {
  [[ -x "$ROOT/bin/peer" ]] && [[ -x "$ROOT/bin/fabric-ca-client" ]] && [[ -x "$ROOT/bin/configtxgen" ]]
}

download_and_extract() {
  local -r url="$1"
  local -r tmpfile="$(mktemp)"
  trap 'rm -f -- "${tmpfile:-}"' RETURN
  log_info "downloading $url"
  curl -fsSL --retry 5 --retry-delay 3 -o "$tmpfile" "$url" || {
    log_error "download failed: $url"
    return 1
  }
  tar xzf "$tmpfile" -C "$ROOT"
  rm -f -- "$tmpfile"
}

install_binaries() {
  mkdir -p "$ROOT/bin" "$ROOT/config"
  local fabric_tgz="hyperledger-fabric-${PLATFORM}-${FABRIC_VERSION}.tar.gz"
  local ca_tgz="hyperledger-fabric-ca-${PLATFORM}-${CA_VERSION}.tar.gz"

  log_info "installing Fabric ${FABRIC_VERSION} binaries + config into bin/ config/"
  download_and_extract \
    "https://github.com/hyperledger/fabric/releases/download/v${FABRIC_VERSION}/${fabric_tgz}"

  log_info "installing Fabric CA ${CA_VERSION} binaries into bin/"
  download_and_extract \
    "https://github.com/hyperledger/fabric-ca/releases/download/v${CA_VERSION}/${ca_tgz}"
}

pull_images() {
  log_info "pulling fabric images"
  for img in "${FABRIC_IMAGES[@]}"; do
    docker pull "hyperledger/fabric-${img}:${FABRIC_VERSION}"
  done
  docker pull "hyperledger/fabric-ca:${CA_VERSION}"
}

verify() {
  log_info "verify:"
  "$ROOT/bin/peer" version 2>/dev/null | sed -n '1,3p' || { log_error "peer binary broken"; return 1; }
  "$ROOT/bin/fabric-ca-client" version 2>/dev/null | sed -n '1,3p' || { log_error "fabric-ca-client binary broken"; return 1; }
  docker image inspect "hyperledger/fabric-peer:${FABRIC_VERSION}" >/dev/null 2>&1 \
    && log_info "image hyperledger/fabric-peer:${FABRIC_VERSION} present" \
    || { log_error "image hyperledger/fabric-peer:${FABRIC_VERSION} missing"; return 1; }
}

check_dependencies
if binaries_present; then
  log_info "binaries already installed in bin/ (peer + fabric-ca-client + configtxgen) — skipping download"
else
  install_binaries
fi
pull_images
verify

log_info "done. bin/ and config/ are ready; images pulled."