#!/usr/bin/env bash
#
# Central-bank host deployment.
#
# The CB host owns ONLY the central-bank org: orderer, peer0.centralbank, the
# org1 + orderer CAs, the token CA, issuer/auditor, backend and CB portal.
# Each commercial bank self-provisions its own org + peer + owner on its own VM
# and is added to the settlement channel via scripts/onboard-bank.sh.
#
# Usage: ./scripts/deploy-centralbank.sh [--provision]
#   --provision   also generate wallet-pool keys for every registered bank
#                 (requires the token CA + backend to be running)
#
# After banks are onboarded (onboard-bank.sh) run scripts/commit-chaincode.sh
# to commit the chaincode endorsement policy.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="$ROOT/bin:$PATH"
export FABRIC_CFG_PATH="$ROOT/config"

PROVISION=0
for arg in "$@"; do
  case "$arg" in
    --provision) PROVISION=1 ;;
  esac
done

cd "$ROOT/network"

echo "==> [1/4] Fabric network (central-bank org only, channel settlement)"
./network.sh up createChannel -ca

echo "==> [2/4] Token chaincode installed + approved for the central-bank org"
./network.sh deployCCAAS -ccn tokenchaincode -ccp "$ROOT/token-services/tokenchaincode" -ccs 1

echo "==> [3/4] Token engine (issuer, auditor)"
cd "$ROOT/token-services"
docker compose -f compose-ca.yaml up -d          # token CA (idemix issuer)

# A fresh clone has no identities (keys/ is gitignored). Enroll the FSC node
# identities + demo wallets once, before the engine starts.
if [ ! -d "$ROOT/token-services/keys/issuer/fsc" ]; then
  echo "==> enrolling token identities (fsc nodes + demo wallets)"
  for i in $(seq 1 30); do
    if curl -sf http://localhost:27054/cainfo >/dev/null 2>&1; then break; fi
    sleep 2
  done
  ./scripts/enroll-users.sh
fi

COMPOSE_FILES="-f docker-compose.yaml"
if env | grep -q '^SWORNA_OWNER_.*_HOST='; then
  echo "   generating cross-host DNS override (owner hosts -> bank VMs)"
  python3 "$ROOT/scripts/gen-net-overrides.py" cb "$ROOT/token-services/docker-compose.net.yaml"
  COMPOSE_FILES="-f docker-compose.yaml -f docker-compose.net.yaml"
fi
docker compose $COMPOSE_FILES up -d --build issuer auditor

if [ "$PROVISION" = "1" ]; then
  echo "==> provisioning wallet pools for registered banks"
  sleep 10  # let the engine connect
  TOKEN=$(curl -sf -X POST http://localhost:8000/api/v1/auth/login \
    -H 'Content-Type: application/json' \
    -d '{"username":"cbadmin","password":"sworna-cb"}' | jq -r .token 2>/dev/null || true)
  if [ -n "$TOKEN" ]; then
    for code in $(curl -sf http://localhost:8000/api/v1/banks -H "Authorization: Bearer $TOKEN" \
        | jq -r '.[].code' 2>/dev/null || true); do
      curl -sf -X POST "http://localhost:8000/api/v1/admin/banks/$code/provision" \
        -H "Authorization: Bearer $TOKEN" \
        >/dev/null && echo "   provisioned bank $code" || echo "   (provision $code: not yet — run from the CB portal)"
    done
  else
    echo "   backend not up yet — provision banks from the CB portal later"
  fi
fi

echo "==> [4/4] Banking backend + CB portal"
cd "$ROOT/backend"
[ -d .venv ] || python3 -m venv .venv
./.venv/bin/pip install -q -r requirements.txt
(setsid ./.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000 > /tmp/sworna-backend.log 2>&1 &)

cd "$ROOT/web"
npm install --silent
(setsid npm run dev > /tmp/sworna-web.log 2>&1 &)

echo "==> exporting per-bank join bundles (token wallets + orderer public certs)"
"$ROOT/scripts/export-join-bundles.sh" || echo "   (export skipped — backend not ready yet; run scripts/export-join-bundles.sh later)"

echo
echo "Central-bank host ready."
echo "  portal   http://localhost:5173   (login: cbadmin / sworna-cb)"
echo "  backend  http://localhost:8000/docs"
echo "  engine   http://localhost:8080"
echo
echo "Next:"
echo "  1. each bank VM runs ./scripts/deploy-bank.sh <CODE>  -> produces <bank{k}>-org.json"
echo "  2. import it here:  ./scripts/onboard-bank.sh Bank{k}MSP <path-to-org-json>"
echo "  3. after all banks are onboarded:  ./scripts/commit-chaincode.sh"
echo "  4. re-run the bank deploy scripts to join + start each bank's owner/portal"