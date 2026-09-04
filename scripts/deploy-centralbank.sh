#!/usr/bin/env bash
#
# Central-bank host deployment.
#
# The CB host owns ONLY the central-bank org: orderer, peer0.centralbank, the
# org1 + orderer CAs, the token CA, issuer/auditor, backend and CB portal.
# Each commercial bank self-provisions its own org + peer + owner on its own VM,
# is added to the settlement channel via scripts/onboard-bank.sh — all while
# this host stays up.
#
# Usage: ./scripts/deploy-centralbank.sh [--provision]
#   --provision   mint wallet pools for every registered bank (the registry
#                 starts EMPTY; create banks via POST /api/v1/banks first)
#
# After banks are onboarded (onboard-bank.sh) run scripts/commit-chaincode.sh
# to commit the chaincode endorsement policy.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="$ROOT/bin:$PATH"
export FABRIC_CFG_PATH="$ROOT/config"
. "$ROOT/scripts/bank-hosts.sh"      # owner->host registry fallback
load_bank_hosts

PROVISION=0
for arg in "$@"; do
  case "$arg" in
    --provision) PROVISION=1 ;;
  esac
done

cd "$ROOT/network"

echo "==> [1/5] Fabric network (central-bank org only, channel settlement)"
./network.sh up createChannel -ca

echo "==> [2/5] Token chaincode installed + approved for the central-bank org"
./network.sh deployCCAAS -ccn tokenchaincode -ccp "$ROOT/token-services/tokenchaincode" -ccs 1

echo "==> [3/5] Token engine (issuer, auditor)"
cd "$ROOT/token-services"
docker compose -f compose-ca.yaml up -d          # token CA (idemix issuer)

# A fresh clone has no identities (keys/ is gitignored). Enroll the CB's own
# identities once, before the engine starts.
if [ ! -d "$ROOT/token-services/keys/issuer/fsc" ]; then
  echo "==> enrolling CB token identities (issuer + auditor)"
  for i in $(seq 1 30); do
    if curl -sf http://localhost:27054/cainfo >/dev/null 2>&1; then break; fi
    sleep 2
  done
  ./scripts/enroll-users.sh
fi

# Render the engine confs (owner resolvers come from SWORNA_OWNERS; empty on a
# fresh CB — banks are onboarded at runtime and onboard-bank.sh re-renders).
echo "==> rendering engine confs"
for svc in auditor issuer; do
  OWNERS="${SWORNA_OWNERS:-}" \
    python3 "$ROOT/scripts/render-owner-conf.py" "$svc/conf/core.yaml.tpl" \
    > "$svc/conf/core.yaml"
done

COMPOSE_FILES="-f docker-compose.yaml"
if env | grep -q '^SWORNA_OWNER_.*_HOST='; then
  echo "   generating cross-host DNS override (owner hosts -> bank VMs)"
  python3 "$ROOT/scripts/gen-net-overrides.py" cb docker-compose.net.yaml
  COMPOSE_FILES="-f docker-compose.yaml -f docker-compose.net.yaml"
fi
docker compose $COMPOSE_FILES up -d --build issuer auditor

echo "==> [4/5] Banking backend + CB portal"
cd "$ROOT/backend"
[ -d .venv ] || python3 -m venv .venv
./.venv/bin/pip install -q -r requirements.txt
BACKEND_PORT="${SWORNA_BACKEND_PORT:-8000}"
if ss -lnt 2>/dev/null | grep -q ":$BACKEND_PORT "; then
  echo "   Port $BACKEND_PORT is in use, using 8100"
  BACKEND_PORT=8100
fi
PORTAL_PORT="${SWORNA_PORTAL_PORT:-5173}"
if ss -lnt 2>/dev/null | grep -q ":$PORTAL_PORT "; then
  echo "   Port $PORTAL_PORT is in use, using 5273"
  PORTAL_PORT=5273
fi

(setsid ./.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port "$BACKEND_PORT" > /tmp/sworna-backend.log 2>&1 &)

cd "$ROOT/web"
npm install --silent
(setsid npm run dev -- --port "$PORTAL_PORT" > /tmp/sworna-web.log 2>&1 &)

if [ "$PROVISION" = "1" ]; then
  echo "==> [5/5] Provisioning wallet pools for registered banks"
  for i in $(seq 1 60); do
    if curl -sf "http://localhost:${BACKEND_PORT}/healthz" >/dev/null 2>&1; then break; fi
    sleep 2
  done
  TOKEN=$(curl -sf -X POST "http://localhost:${BACKEND_PORT}/api/v1/auth/login" \
    -H 'Content-Type: application/json' \
    -d '{"username":"cbadmin","password":"sworna-cb"}' | jq -r .token 2>/dev/null || true)
  codes=""
  if [ -n "$TOKEN" ]; then
    codes=$(curl -sf "http://localhost:${BACKEND_PORT}/api/v1/banks" -H "Authorization: Bearer $TOKEN" \
        | jq -r '.[].code' 2>/dev/null || true)
  fi
  if [ -z "$codes" ]; then
    echo "   registry is empty — no banks to provision."
    echo "   Create banks via POST /api/v1/banks (or the portal), then:"
    echo "     ./scripts/export-join-bundles.sh   # re-export their bundles"
  fi
  for code in $codes; do
    curl -sf -X POST "http://localhost:8000/api/v1/admin/banks/$code/provision" \
      -H "Authorization: Bearer $TOKEN" \
      >/dev/null && echo "   provisioned bank $code" || echo "   (provision $code failed — retry from the CB portal)"
  done
fi

echo "==> exporting per-bank join bundles (token wallets + orderer public certs)"
"$ROOT/scripts/export-join-bundles.sh" || echo "   (export skipped — run scripts/export-join-bundles.sh once banks exist)"

echo
echo "Central-bank host ready."
echo "  portal   http://localhost:5173   (login: cbadmin / sworna-cb)"
echo "  backend  http://localhost:8000/docs"
echo "  engine   http://localhost:8080"
echo
echo "Onboard a bank in ONE step (while this host stays up):"
echo
echo "  ./scripts/add-bank.sh <CODE>                 # bank on this VM (all-in-one demo)"
echo "  ./scripts/add-bank.sh <CODE> <BANK-VM-IP>    # bank on its own VM (driven over SSH)"
echo
echo "  That registers, provisions, syncs the repo, runs the bank's identity,"
echo "  admits it to the channel, joins + starts its services and commits the"
echo "  chaincode. Idempotent — re-run to resume. (The manual step-by-step path"
echo "  is documented in docs/SETUP.md §5-6.)"