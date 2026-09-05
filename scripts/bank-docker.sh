#!/usr/bin/env bash
#
# bank-docker.sh — 100% Automated, Dockerized Commercial Bank Onboarding
#
# Usage: ./scripts/bank-docker.sh [up|down] [BANK_CODE] [CB_HOST] [MY_HOST]
# Example: ./scripts/bank-docker.sh up 001 100.72.112.29
#
set -Eeuo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
export PATH="$ROOT/bin:$PATH"
export FABRIC_CFG_PATH="$ROOT/config"

ACTION="${1:-up}"
BANK_CODE="${2:-${BANK_CODE:-}}"
CB_HOST="${3:-${SWORNA_CB_HOST:-}}"
MY_HOST="${4:-${SWORNA_MY_HOST:-}}"

usage() {
  echo "Usage: $0 [up|down] <BANK_CODE> <CB_HOST> [MY_HOST]"
  echo "  Example: $0 up 001 100.64.0.10"
  exit 1
}

[ -n "$BANK_CODE" ] || usage
[[ "$BANK_CODE" =~ ^[0-9]{3}$ ]] || { echo "ERROR: Bank code must be 3 digits (e.g. 001, 002)"; exit 1; }

k=$((10#$BANK_CODE))
BANK_ORG="bank${k}"
BANK_MSP="Bank${k}MSP"
OWNER_NODE="owner${k}"
BANK_PEER_PORT=$((9051 + 2000 * (k - 1)))
BANK_CA_PORT=$((20054 + k))
OWNER_REST_PORT=$((9200 + 100 * (k - 1)))
OWNER_P2P_PORT=$((9201 + 100 * (k - 1)))
PORTAL_PORT="${PORTAL_PORT:-5173}"

down() {
  echo "==> [Bank ${BANK_CODE}] Tearing down services..."
  docker stop "sworna-bank-web-${BANK_CODE}" 2>/dev/null || true
  docker rm -f "sworna-bank-web-${BANK_CODE}" 2>/dev/null || true
  (cd "$ROOT" && BANK_CODE="$BANK_CODE" ./scripts/bank-network.sh down) || true
  docker compose -p "bank${BANK_CODE}-owner" -f "$ROOT/token-services/docker-compose.bank.yaml" down 2>/dev/null || true
  echo "==> [Bank ${BANK_CODE}] Stopped."
  exit 0
}

[ "$ACTION" = "down" ] && down

[ -n "$CB_HOST" ] || { echo "ERROR: CB_HOST is required for 'up' action"; usage; }

# Auto-detect this VM's IP if not provided
if [ -z "$MY_HOST" ]; then
  # 1. Try Tailscale IP
  if command -v tailscale >/dev/null 2>&1 && tailscale ip -4 >/dev/null 2>&1; then
    MY_HOST=$(tailscale ip -4 | head -1)
  else
    # 2. Try default route IP
    MY_HOST=$(ip route get 1.1.1.1 2>/dev/null | grep -oP 'src \K\S+' || hostname -I 2>/dev/null | awk '{print $1}')
  fi
fi
[ -n "$MY_HOST" ] || MY_HOST="127.0.0.1"

echo "================================================================"
echo "    SWORNA CBDC — DOCKERIZED COMMERCIAL BANK ONBOARDING         "
echo "================================================================"
echo " Bank Code      : ${BANK_CODE} (${BANK_MSP})"
echo " Central Bank   : ${CB_HOST}"
echo " Local Node IP  : ${MY_HOST}"
echo " Peer Port      : ${BANK_PEER_PORT}"
echo " FSC Owner Port : ${OWNER_REST_PORT}"
echo "================================================================"

CB_API="http://${CB_HOST}:8100/api/v1"

# Verify CB API is reachable
echo "==> [1/5] Checking connection to Central Bank (${CB_HOST})..."
if ! curl -sf -m 5 "${CB_API%/api/v1}/healthz" >/dev/null 2>&1 && ! curl -sf -m 5 "http://${CB_HOST}:8000/healthz" >/dev/null 2>&1; then
  # Fallback to port 8000 if 8100 is not answering
  if curl -sf -m 5 "http://${CB_HOST}:8000/healthz" >/dev/null 2>&1; then
    CB_API="http://${CB_HOST}:8000/api/v1"
  else
    echo "ERROR: Cannot connect to Central Bank API at http://${CB_HOST}:8100 or :8000"
    echo "       Verify CB VM is running and firewall/Tailscale allows port 8100/8000."
    exit 1
  fi
fi
echo "    Central Bank API is reachable!"

# Step 2: Generate local keys via Bank CA in Docker
echo "==> [2/5] Generating local Fabric keys & CA identities..."
export BANK_CODE SWORNA_CB_HOST="$CB_HOST"
(cd "$ROOT" && ./scripts/bank-network.sh identity)

ORG_JSON="$ROOT/network/${BANK_ORG}-org.json"
[ -f "$ORG_JSON" ] || { echo "ERROR: ${ORG_JSON} not found"; exit 1; }

# Step 3: Submit application to Central Bank
echo "==> [3/5] Submitting admission application to Central Bank..."
APP_JSON=$(jq -n \
  --arg code "$BANK_CODE" \
  --arg name "Bank ${BANK_CODE}" \
  --arg msp "$BANK_MSP" \
  --arg owner "$OWNER_NODE" \
  --arg peer "${MY_HOST}:${BANK_PEER_PORT}" \
  --arg ca "${MY_HOST}:${BANK_CA_PORT}" \
  --arg portal "http://${MY_HOST}:${PORTAL_PORT}" \
  --slurpfile msp_json "$ORG_JSON" \
  '{bank_code: $code, legal_name: $name, msp_id: $msp, owner_node: $owner,
    peer_endpoint: $peer, ca_endpoint: $ca, portal_url: $portal,
    public_msp_json: $msp_json[0], pool_size: 10}')

APPLY_RES=$(curl -s -f -X POST "${CB_API}/onboarding/apply" \
  -H "Content-Type: application/json" \
  -d "$APP_JSON" 2>/dev/null || curl -s -X POST "${CB_API}/onboarding/apply" -H "Content-Type: application/json" -d "$APP_JSON")

echo "    Application registered in Central Bank registry."

# Step 4: Poll approval and stream credentials
echo "==> [4/5] Waiting for Central Bank admission approval..."
echo "    (If using Central Bank Web Portal, approve at: http://${CB_HOST}:5273/cb/banks)"

APPROVED=0
for i in $(seq 1 60); do
  STATUS=$(curl -sf "${CB_API}/onboarding/applications/${BANK_CODE}" 2>/dev/null | jq -r .status || true)
  if [ "$STATUS" = "approved" ]; then
    APPROVED=1
    echo "    Application APPROVED by Central Bank!"
    break
  elif [ "$STATUS" = "rejected" ]; then
    echo "ERROR: Central Bank rejected the admission application."
    exit 1
  fi
  printf "."
  sleep 2
done
echo

[ "$APPROVED" = "1" ] || { echo "ERROR: Admission timed out waiting for approval."; exit 1; }

echo "==> Streaming minted Idemix keys & Orderer TLS certificates from Central Bank..."
CREDS_JSON=$(curl -sf "${CB_API}/onboarding/applications/${BANK_CODE}/credentials")
[ -n "$CREDS_JSON" ] || { echo "ERROR: Failed to fetch credentials from Central Bank."; exit 1; }

BUNDLE_B64=$(echo "$CREDS_JSON" | jq -r .bundle_base64)
[ -n "$BUNDLE_B64" ] || { echo "ERROR: Empty credential payload."; exit 1; }

echo "$BUNDLE_B64" | base64 -d | tar -xzf - -C "$ROOT"
echo "    Credentials and TLS certificates imported successfully!"

# Step 5: Join channel, launch CCaaS, FSC Owner, and Bank Web Portal
echo "==> [5/5] Joining channel 'settlement' and launching containers..."
(cd "$ROOT" && BANK_CODE="$BANK_CODE" SWORNA_CB_HOST="$CB_HOST" ./scripts/bank-network.sh join)

echo "==> Starting FSC Owner engine..."
"$ROOT/scripts/bank-network.sh" conf
SWORNA_OWNERS="${SWORNA_OWNERS:-owner1 owner2 owner3 owner4 owner5}" \
SWORNA_CB_HOST="$CB_HOST" \
  python3 "$ROOT/scripts/gen-net-overrides.py" bank "$ROOT/token-services/docker-compose.bank.net.yaml"

export OWNER_NODE OWNER_HOSTNAME="$OWNER_NODE" OWNER_REST_PORT OWNER_P2P_PORT
(cd "$ROOT/token-services" && docker compose -p "bank${BANK_CODE}-owner" \
  -f docker-compose.bank.yaml -f docker-compose.bank.net.yaml up -d --build owner)

# Build and start the containerized Web Portal
echo "==> Starting containerized Bank Web Portal on :${PORTAL_PORT}..."
docker build -q -t sworna-web:latest "$ROOT/web" >/dev/null 2>&1 || true
docker rm -f "sworna-bank-web-${BANK_CODE}" >/dev/null 2>&1 || true

docker run -d --restart unless-stopped \
  --name "sworna-bank-web-${BANK_CODE}" \
  --network host \
  -e PORTAL_PORT="${PORTAL_PORT}" \
  -e BACKEND_URL="http://${CB_HOST}:8100" \
  sworna-web:latest >/dev/null

echo
echo "================================================================"
echo "   BANK ${BANK_CODE} (${BANK_MSP}) IS LIVE & CONNECTED!        "
echo "================================================================"
echo "  Bank Web Portal : http://localhost:${PORTAL_PORT}/b/${BANK_CODE}"
echo "                    (or http://${MY_HOST}:${PORTAL_PORT}/b/${BANK_CODE})"
echo "  Staff Login     : bank${k}_admin / sworna-bank"
echo "  FSC Owner REST  : http://localhost:${OWNER_REST_PORT}/api/v1"
echo "================================================================"
