#!/usr/bin/env bash
#
# Deploy a commercial bank on its OWN VM: own Fabric CA + peer + chaincode,
# owner FSC service, banking backend and bank portal. Supports any number of
# banks.
#
# Usage: ./scripts/deploy-bank.sh <CODE> [PHASE]
#   PHASE (default "all"):
#     identity   own CA + peer + org enrollment; exports bank{k}-org.json
#                (send it to the CB host: onboard-bank.sh Bank{k}MSP org.json)
#     finish     everything AFTER onboarding: join channel + chaincode, owner
#                engine, banking backend, portal
#     join       channel join + chaincode install/approve only
#     engine     owner FSC service only
#     backend    banking backend (uvicorn :8000) only
#     portal     bank web portal (vite dev :5173) only
#     all        identity + finish   (equivalent to the old behaviour)
#
# Env: SWORNA_CB_HOST       IP of the central-bank VM (required)
#      SWORNA_OWNERS        space-separated owner list, ALL banks (required;
#                           falls back to network/bank-hosts.env)
#      SWORNA_OWNER_<NAME>_HOST  bank VM IP for each owner (same fallback)
#      SWORNA_ORDERER_ADDR  host:port of the orderer (default
#                           orderer.sworna.example.com:7050 — avoids needing
#                           an /etc/hosts entry on this VM)
#      POOL_SIZE            wallet pool size (default 10)
set -euo pipefail

BANK_CODE="${1:-${BANK_CODE:-}}"
PHASE="${2:-all}"
[ -n "$BANK_CODE" ] || { echo "usage: $0 <CODE> [identity|finish|join|engine|backend|portal|all]" >&2; exit 1; }
export BANK_CODE

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="$ROOT/bin:$PATH"
. "$ROOT/scripts/bank-hosts.sh"
load_bank_hosts

export SWORNA_CB_HOST="${SWORNA_CB_HOST:?SWORNA_CB_HOST (central-bank VM IP) is required}"
export SWORNA_OWNERS="${SWORNA_OWNERS:?SWORNA_OWNERS (space-separated list of ALL owner nodes) is required — or add them to network/bank-hosts.env via add-bank.sh}"

k=$((10#$BANK_CODE))
OWNER_NODE="owner${k}"
OWNER_REST_PORT=$((9200 + 100 * (k - 1)))

bank_identity() {
  echo "==> bank ${BANK_CODE}: Fabric identity (own CA + peer + org enrollment)"
  ./scripts/bank-network.sh identity
}

bank_join() {
  echo "==> bank ${BANK_CODE}: join channel + chaincode (needs CB onboarding)"
  ./scripts/bank-network.sh join
}

bank_engine() {
  echo "==> bank ${BANK_CODE}: owner FSC service"
  "$ROOT/scripts/bank-network.sh" conf
  python3 "$ROOT/scripts/gen-net-overrides.py" bank "$ROOT/token-services/docker-compose.bank.net.yaml"
  export OWNER_NODE="owner${k}"
  export OWNER_HOSTNAME="owner${k}"
  export OWNER_REST_PORT
  export OWNER_P2P_PORT=$((9201 + 100 * (k - 1)))
  cd "$ROOT/token-services"
  docker compose -p "bank${BANK_CODE}-owner" -f docker-compose.bank.yaml -f docker-compose.bank.net.yaml up -d --build owner
}

bank_backend() {
  echo "==> bank ${BANK_CODE}: banking backend"
  if curl -sf http://localhost:8100/healthz >/dev/null 2>&1 || curl -sf http://localhost:8000/healthz >/dev/null 2>&1; then
    echo "    Banking backend already active in Docker — skipping host process."
    return 0
  fi
  cd "$ROOT/backend"
  [ -d .venv ] || python3 -m venv .venv
  ./.venv/bin/pip install -q -r requirements.txt
  ( setsid env \
      SWORNA_ISSUER_URL="http://${SWORNA_CB_HOST}:9100/api/v1" \
      SWORNA_AUDITOR_URL="http://${SWORNA_CB_HOST}:9000/api/v1" \
      SWORNA_OWNER_OWNER${k}_URL="http://localhost:${OWNER_REST_PORT}/api/v1" \
      ./.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000 \
      > /tmp/sworna-backend.log 2>&1 & )
}

bank_portal() {
  echo "==> bank ${BANK_CODE}: portal"
  if curl -sf http://localhost:5273 >/dev/null 2>&1 || curl -sf http://localhost:5173 >/dev/null 2>&1; then
    echo "    Portal already active in Docker — skipping host process."
    return 0
  fi
  cd "$ROOT/web"
  npm install --silent
  (setsid npm run dev > /tmp/sworna-web.log 2>&1 &)
}

bank_finish() {
  bank_join
  bank_engine
  bank_backend
  if [ "${1:-}" != "noportal" ]; then
    bank_portal
  fi
}

case "$PHASE" in
  identity)        bank_identity ;;
  join)            bank_join ;;
  engine)          bank_engine ;;
  backend)         bank_backend ;;
  portal)          bank_portal ;;
  finish)          bank_finish ;;
  finish-noportal) bank_finish noportal ;;
  all)             bank_identity; bank_finish ;;
  *) echo "unknown phase: $PHASE (use identity|finish|join|engine|backend|portal|all)" >&2; exit 1 ;;
esac

echo
echo "Bank ${BANK_CODE} host ready (phase: $PHASE)."
[ "$PHASE" = "identity" ] && {
  echo "  -> send network/bank${k}-org.json to the CB host, then run add-bank.sh/onboard-bank.sh there"
  echo "     and re-run this script with the 'finish' phase."
}
echo "  portal   http://localhost:5173/b/${BANK_CODE}"
echo "  backend  http://localhost:8000/docs"
echo "  owner    http://localhost:${OWNER_REST_PORT}"
