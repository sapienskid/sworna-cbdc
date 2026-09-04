#!/usr/bin/env bash
#
# Bring up a commercial bank's Fabric peer + CA on the bank's OWN VM, enroll
# the bank's org identity, and join the CB-hosted `settlement` channel.
#
# Subcommands:
#   up        start this bank's own CA + peer containers
#   identity  enroll the bank's org identities + render the owner conf +
#             export the bank's public org MSP JSON (bank{k}-org.json)
#   join      fetch the genesis block, join the channel, install the token
#             chaincode package and run the bank's CCAAS container
#             (run AFTER the CB runs scripts/onboard-bank.sh for this bank)
#   down      stop the CA + peer (+ chaincode) containers
#
# Env:  BANK_CODE (001..) required; SWORNA_CB_HOST (CB host IP) for up/join.
set -Eeuo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
NETWORK="$ROOT/network"
cd "$NETWORK"
export PATH="$ROOT/bin:$PATH"
export FABRIC_CFG_PATH="$ROOT/config"
. "$ROOT/scripts/bank-hosts.sh"      # owner->host registry fallback
load_bank_hosts

MODE="${1:-up}"
CHANNEL=settlement
CC_NAME=tokenchaincode
CC_VERSION="${CC_VERSION:-1.0}"
CC_SEQUENCE="${CC_SEQUENCE:-1}"
CCAAS_SERVER_PORT=9999

BANK_CODE="${BANK_CODE:?BANK_CODE (e.g. 001) must be set}"
ORDERER_ADDR="${SWORNA_ORDERER_ADDR:-${SWORNA_CB_HOST:-127.0.0.1}:7050}"
k=$((10#$BANK_CODE))                     # 1-based bank index
OWNER_NODE="owner${k}"
BANK_ORG="bank${k}"
BANK_MSP="Bank${k}MSP"
BANK_PEER_PORT=$((9051 + 2000 * (k - 1)))
BANK_CC_PORT=$((BANK_PEER_PORT + 1))
BANK_CA_PORT=${BANK_CA_PORT:-$((20054 + k))}
BANK_CA_NAME="ca-bank${k}"
BANK_CA_CONT="ca_bank${k}"
BANK_CA_DATA="../organizations/fabric-ca/${BANK_ORG}"
CCAAS_PEERNAME="peer0bank${k}"
OWNER_REST_PORT=$((9200 + 100 * (k - 1)))
OWNER_P2P_PORT=$((9201 + 100 * (k - 1)))

log_info() { printf '[%s] INFO: %s\n' "$(date +'%H:%M:%S')" "$*"; }
log_error() { printf '[%s] ERROR: %s\n' "$(date +'%H:%M:%S')" "$*" >&2; }

ORG_DIR="$NETWORK/organizations/peerOrganizations/${BANK_ORG}.sworna.example.com"
ORDERER_CA="$NETWORK/organizations/ordererOrganizations/sworna.example.com/tlsca/tlsca.sworna.example.com-cert.pem"
KEYS_DIR="$ROOT/token-services/keys"

export CORE_PEER_TLS_ENABLED=true
export CORE_PEER_LOCALMSPID="$BANK_MSP"
export CORE_PEER_MSPCONFIGPATH="$ORG_DIR/users/Admin@${BANK_ORG}.sworna.example.com/msp"
export CORE_PEER_ADDRESS="localhost:${BANK_PEER_PORT}"
export PEER_CA="$NETWORK/organizations/peerOrganizations/${BANK_ORG}.sworna.example.com/tlsca/tlsca.${BANK_ORG}.sworna.example.com-cert.pem"
export CORE_PEER_TLS_ROOTCERT_FILE="$PEER_CA"

check_bundle() {
  local missing=0
  [[ -d "$KEYS_DIR/$OWNER_NODE" ]] || { log_error "join bundle missing: $KEYS_DIR/$OWNER_NODE (token wallets + fsc identity)"; missing=1; }
  [[ -f "$ORDERER_CA" ]] || { log_error "join bundle missing: orderer TLS CA ($ORDERER_CA)"; missing=1; }
  return $missing
}

bank_ca_up() {
  export BANK_ORG BANK_MSP BANK_PEER_PORT BANK_CC_PORT BANK_CA_PORT \
         BANK_CA_NAME BANK_CA_CONT BANK_CA_DATA CCAAS_PEERNAME \
         SWORNA_CB_HOST="${SWORNA_CB_HOST:?SWORNA_CB_HOST (CB host IP) must be set}" \
         DOCKER_SOCK="${DOCKER_SOCK:-/var/run/docker.sock}"
  mkdir -p "$NETWORK/organizations/fabric-ca/${BANK_ORG}"
  log_info "starting ${BANK_ORG} CA container"
  docker compose -p "bank${BANK_CODE}" -f compose/compose-bank-peer.yaml up -d bank-ca

  log_info "waiting for ${BANK_ORG} CA to accept connections"
  for i in $(seq 1 30); do
    if curl -sk "https://localhost:${BANK_CA_PORT}/cainfo" >/dev/null 2>&1 || curl -sf "http://localhost:${BANK_CA_PORT}/cainfo" >/dev/null 2>&1; then break; fi
    sleep 1
  done
}

bank_peer_up() {
  check_bundle
  export BANK_ORG BANK_MSP BANK_PEER_PORT BANK_CC_PORT BANK_CA_PORT \
         BANK_CA_NAME BANK_CA_CONT BANK_CA_DATA CCAAS_PEERNAME \
         SWORNA_CB_HOST="${SWORNA_CB_HOST:?SWORNA_CB_HOST (CB host IP) must be set}" \
         DOCKER_SOCK="${DOCKER_SOCK:-/var/run/docker.sock}"
  COMPOSE_FILES="-f compose/compose-bank-peer.yaml"
  if [[ "$SWORNA_CB_HOST" != "127.0.0.1" && "$SWORNA_CB_HOST" != "localhost" ]]; then
    cat <<EOF > compose/compose-bank-peer.net.yaml
services:
  bank-peer:
    extra_hosts:
      - "orderer.sworna.example.com:${SWORNA_CB_HOST}"
      - "peer0.centralbank.sworna.example.com:${SWORNA_CB_HOST}"
EOF
    COMPOSE_FILES="$COMPOSE_FILES -f compose/compose-bank-peer.net.yaml"
  else
    rm -f compose/compose-bank-peer.net.yaml
  fi
  log_info "starting ${BANK_ORG} peer container"
  docker compose -p "bank${BANK_CODE}" $COMPOSE_FILES up -d bank-peer

  log_info "waiting for the ${BANK_ORG} peer to accept connections"
  local ok=0
  for i in $(seq 1 30); do
    if peer lifecycle chaincode queryinstalled >/dev/null 2>&1; then ok=1; break; fi
    sleep 2
  done
  [[ $ok -eq 1 ]] || { log_error "peer did not come up"; return 1; }
}

bank_up() {
  bank_ca_up
  enroll_org
  bank_peer_up
}

enroll_org() {
  [[ -d "$ORG_DIR/peers" ]] && { log_info "org identity already enrolled"; return 0; }
  log_info "enrolling ${BANK_MSP} identities against the bank's own CA"
  export BANK_ORG BANK_MSP BANK_CA_PORT BANK_CA_NAME
  . "$NETWORK/organizations/fabric-ca/registerEnroll-bank.sh"
}

render_conf() {
  local tpl="$ROOT/token-services/owner/conf/core.yaml.tpl"
  local out="$ROOT/token-services/owner/conf/${OWNER_NODE}/core.yaml"
  mkdir -p "$(dirname "$out")"
  log_info "rendering owner conf -> token-services/owner/conf/${OWNER_NODE}/core.yaml"
  OWNER_NODE="$OWNER_NODE" OWNER_INDEX="$k" BANK_ORG="$BANK_ORG" BANK_MSP="$BANK_MSP" \
    PEER_PORT="$BANK_PEER_PORT" OWNER_P2P="$OWNER_P2P_PORT" BANK_CODE="$BANK_CODE" \
    POOL_SIZE="${POOL_SIZE:-10}" DEMO_WALLETS="${DEMO_WALLETS:-}" \
    OWNERS="${SWORNA_OWNERS:?SWORNA_OWNERS (all owner nodes) must be set}" \
    python3 "$ROOT/scripts/render-owner-conf.py" "$tpl" > "$out"
}

export_org_json() {
  local cfgdir="$NETWORK/configtx-bank"
  mkdir -p "$cfgdir"
  sed -e "s|@@BANK_MSP@@|$BANK_MSP|g" -e "s|@@BANK_ORG@@|$BANK_ORG|g" -e "s|@@PEER_PORT@@|$BANK_PEER_PORT|g" \
    "$NETWORK/configtx/configtx.bank.yaml.tpl" > "$cfgdir/configtx.yaml"
  log_info "exporting public org MSP JSON -> network/${BANK_ORG}-org.json"
  FABRIC_CFG_PATH="$cfgdir" configtxgen -printOrg "$BANK_MSP" > "$NETWORK/${BANK_ORG}-org.json"
}

identity() {
  bank_ca_up
  enroll_org
  export_org_json
  echo
  echo "Bank ${BANK_CODE} (${BANK_MSP}) identity ready."
  echo "  -> Public org MSP JSON exported to $NETWORK/${BANK_ORG}-org.json"
  echo "  -> Submit application to Central Bank via POST /api/v1/onboarding/apply"
}

fetch_and_join() {
  log_info "fetching genesis block for channel '${CHANNEL}' from the CB orderer"
  local block="$NETWORK/channel-artifacts/${CHANNEL}.block"
  mkdir -p "$NETWORK/channel-artifacts"
  peer channel fetch 0 "$block" -c "$CHANNEL" \
    -o "$ORDERER_ADDR" --ordererTLSHostnameOverride orderer.sworna.example.com \
    --tls --cafile "$ORDERER_CA"
  log_info "joining peer0.${BANK_ORG} to '${CHANNEL}'"
  peer channel join -b "$block"
}

install_ccaas() {
  log_info "building the ${CC_NAME} CCAAS image (first run only)"
  if ! docker image inspect "${CC_NAME}_ccaas_image:latest" >/dev/null 2>&1; then
    docker build -f "$ROOT/token-services/tokenchaincode/Dockerfile" \
      -t "${CC_NAME}_ccaas_image:latest" --build-arg CC_SERVER_PORT="$CCAAS_SERVER_PORT" \
      "$ROOT/token-services/tokenchaincode"
  fi

  log_info "packaging + installing chaincode on the ${BANK_ORG} peer"
  tempdir=$(mktemp -d)
  trap 'rm -rf -- "$tempdir"' RETURN
  mkdir -p "$tempdir/src" "$tempdir/pkg"
  printf '{"address":"{{.peername}}_%s_ccaas:%s","dial_timeout":"10s","tls_required":false}\n' \
    "$CC_NAME" "$CCAAS_SERVER_PORT" > "$tempdir/src/connection.json"
  printf '{"type":"ccaas","label":"%s_%s"}\n' "$CC_NAME" "$CC_VERSION" > "$tempdir/pkg/metadata.json"
  tar -C "$tempdir/src" -czf "$tempdir/pkg/code.tar.gz" .
  tar -C "$tempdir/pkg" -czf "$NETWORK/${CC_NAME}.tar.gz" metadata.json code.tar.gz

  PACKAGE_ID=$(peer lifecycle chaincode calculatepackageid "$CC_NAME.tar.gz")

  if peer lifecycle chaincode queryinstalled --output json \
       | jq -r 'try (.installed_chaincodes[].package_id)' | grep -qx "$PACKAGE_ID"; then
    log_info "chaincode already installed (${PACKAGE_ID})"
  else
    peer lifecycle chaincode install "$CC_NAME.tar.gz"
  fi

  log_info "approving the chaincode definition for ${BANK_MSP}"
  committed_seq=$(peer lifecycle chaincode querycommitted --channelID "$CHANNEL" --name "$CC_NAME" \
    --output json 2>/dev/null | jq -r '.sequence // .chaincode_definitions[0].sequence // empty' || true)
  effective_seq="${committed_seq:-$CC_SEQUENCE}"
  peer lifecycle chaincode approveformyorg -o "$ORDERER_ADDR" \
    --ordererTLSHostnameOverride orderer.sworna.example.com --tls --cafile "$ORDERER_CA" \
    --channelID "$CHANNEL" --name "$CC_NAME" --version "$CC_VERSION" --sequence "$effective_seq" \
    --package-id "$PACKAGE_ID" --init-required || true

  log_info "starting ${CCAAS_PEERNAME}_${CC_NAME}_ccaas chaincode container"
  docker rm -f "${CCAAS_PEERNAME}_${CC_NAME}_ccaas" >/dev/null 2>&1 || true
  docker run --restart always -d --name "${CCAAS_PEERNAME}_${CC_NAME}_ccaas" --network fabric_test \
    -e CHAINCODE_SERVER_ADDRESS=0.0.0.0:${CCAAS_SERVER_PORT} \
    -e CHAINCODE_ID="$PACKAGE_ID" -e CORE_CHAINCODE_ID_NAME="$PACKAGE_ID" \
    "${CC_NAME}_ccaas_image:latest"
}

join() {
  check_bundle
  bank_up
  if peer channel list 2>/dev/null | grep -q "^${CHANNEL}$"; then
    log_info "peer already joined to '${CHANNEL}'"
  else
    if ! fetch_and_join; then
      echo
      echo "This bank is not onboarded on the CB yet."
      echo "  On the CB host run:  ./scripts/onboard-bank.sh ${BANK_MSP} <path-to-${BANK_ORG}-org.json>"
      echo "  then re-run:         ./scripts/deploy-bank.sh ${BANK_CODE}"
      exit 0
    fi
  fi
  install_ccaas
  echo
  echo "Bank ${BANK_CODE} peer joined '${CHANNEL}' and the chaincode is running."
}

down() {
  docker rm -f "${CCAAS_PEERNAME}_${CC_NAME}_ccaas" 2>/dev/null || true
  export BANK_ORG BANK_MSP BANK_PEER_PORT BANK_CC_PORT BANK_CA_PORT \
         BANK_CA_NAME BANK_CA_CONT BANK_CA_DATA CCAAS_PEERNAME \
         SWORNA_CB_HOST="${SWORNA_CB_HOST:-127.0.0.1}" \
         DOCKER_SOCK="${DOCKER_SOCK:-/var/run/docker.sock}"
  docker compose -p "bank${BANK_CODE}" -f compose/compose-bank-peer.yaml down
}

case "$MODE" in
  up)        bank_up ;;
  identity)  identity ;;
  conf)      render_conf ;;
  join)      join ;;
  down)      down ;;
  *)         echo "usage: $0 up|identity|conf|join|down" >&2; exit 1 ;;
esac

log_info "done."