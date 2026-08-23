#!/usr/bin/env bash
#
# Deploy a commercial bank on its OWN VM: own Fabric CA + peer + chaincode,
# owner FSC service and bank portal. Supports any number of banks.
#
# Usage: ./scripts/deploy-bank.sh <CODE>      (e.g. 001, 002, 003, ...)
# Env:   SWORNA_CB_HOST            IP of the central-bank VM (required)
#        SWORNA_OWNERS             space-separated owner list, ALL banks (required)
#        SWORNA_OWNER_<NAME>_HOST  bank VM IP for each owner, e.g.
#                                  SWORNA_OWNER_OWNER1_HOST / SWORNA_OWNER_OWNER2_HOST
#        POOL_SIZE                 wallet pool size (default 10)
set -euo pipefail

BANK_CODE="${1:-${BANK_CODE:-}}"
[ -n "$BANK_CODE" ] || { echo "usage: $0 <CODE>  (e.g. 001, 002, ...)" >&2; exit 1; }
export BANK_CODE
export SWORNA_CB_HOST="${SWORNA_CB_HOST:?SWORNA_CB_HOST (central-bank VM IP) is required}"
export SWORNA_OWNERS="${SWORNA_OWNERS:?SWORNA_OWNERS (space-separated list of ALL owner nodes) is required}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="$ROOT/bin:$PATH"

echo "==> bank ${BANK_CODE}: Fabric identity (own CA + peer + org enrollment)"
./scripts/bank-network.sh identity

echo "==> bank ${BANK_CODE}: join channel + chaincode (needs CB onboarding)"
./scripts/bank-network.sh join

echo "==> bank ${BANK_CODE}: owner FSC service"
python3 "$ROOT/scripts/gen-net-overrides.py" bank "$ROOT/token-services/docker-compose.bank.net.yaml"
k=$((10#$BANK_CODE))
export OWNER_NODE="owner${k}"
export OWNER_HOSTNAME="owner${k}"
export OWNER_REST_PORT=$((9200 + 100 * (k - 1)))
export OWNER_P2P_PORT=$((9201 + 100 * (k - 1)))
cd "$ROOT/token-services"
docker compose -f docker-compose.bank.yaml -f docker-compose.bank.net.yaml up -d --build owner

echo "==> bank ${BANK_CODE}: portal"
cd "$ROOT/web"
npm install --silent
(setsid npm run dev > /tmp/sworna-web.log 2>&1 &)

echo
echo "Bank ${BANK_CODE} host ready."
echo "  portal   http://localhost:5173/b/${BANK_CODE}"
echo "  owner    http://localhost:${OWNER_REST_PORT}"