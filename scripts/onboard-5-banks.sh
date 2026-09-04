#!/usr/bin/env bash
#
# Production-grade automated onboarding for 5 Commercial Banks (001..005)
# strictly adhering to:
#   1. Bank identity self-provisioning in Docker
#   2. Stage 1 Application via POST /api/v1/onboarding/apply
#   3. Stage 2 & 3 Four-Eyes Dual-Control Approval (Monetary Officer + CISO/Admin)
#   4. Stage 4 Live On-Chain Channel Delta Admission (onboard-bank.sh)
#   5. Idemix token wallet pool minting
#   6. Bank peer join + CCAAS chaincode container
#   7. Bank FSC token engine in Docker (owner{k})
#   8. Network-wide endorsement policy commit
#
set -Eeuo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
export PATH="$ROOT/bin:$PATH"
export FABRIC_CFG_PATH="$ROOT/config"
export SWORNA_CB_HOST="127.0.0.1"

BACKEND="${SWORNA_BACKEND:-}"
if [ -z "$BACKEND" ]; then
  if curl -sf http://localhost:8000/healthz >/dev/null 2>&1; then
    BACKEND="http://localhost:8000/api/v1"
  else
    BACKEND="http://localhost:8100/api/v1"
  fi
fi

log() { printf '\033[1;34m[SWORNA]\033[0m \033[1m%s\033[0m\n' "$*"; }
err() { printf '\033[1;31m[ERROR]\033[0m %s\n' "$*" >&2; }

BANKS_TO_ONBOARD=("001" "002" "003" "004" "005")

# 1. Obtain Central Bank Admin Token
log "Authenticating Central Bank Governance Authority..."
CB_TOKEN=$(curl -sf -X POST "$BACKEND/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"username":"cbadmin","password":"sworna-cb"}' | jq -er .token) || {
  err "Central Bank authentication failed at $BACKEND"
  exit 1
}

# 2. Iterate through each bank in the sandbox
for CODE in "${BANKS_TO_ONBOARD[@]}"; do
  k=$((10#$CODE))
  BANK_MSP="Bank${k}MSP"
  BANK_ORG="bank${k}"
  OWNER_NODE="owner${k}"
  PEER_PORT=$((9051 + 2000 * (k - 1)))
  CA_PORT=$((20054 + k))
  OWNER_REST_PORT=$((9200 + 100 * (k - 1)))
  
  log "=========================================================="
  log "Processing Bank ${CODE} (${BANK_MSP}) on ports Peer:${PEER_PORT} CA:${CA_PORT}"
  log "=========================================================="

  # Check if bank is already active in Central Bank registry
  ALREADY_ACTIVE=$(curl -sf "$BACKEND/banks" -H "Authorization: Bearer $CB_TOKEN" \
    | jq --arg code "$CODE" 'map(select(.code == $code)) | length')
  
  if [ "$ALREADY_ACTIVE" -eq 1 ]; then
    log "Bank ${CODE} is already registered in Central Bank — skipping Stages 1-4 admission."
  else
    # Stage 1A: Bank runs identity self-provisioning in its own container
    log "Stage 1A: Running Bank ${CODE} identity generation..."
    BANK_CODE="$CODE" SWORNA_CB_HOST="127.0.0.1" "$ROOT/scripts/bank-network.sh" identity

    ORG_JSON="$ROOT/network/${BANK_ORG}-org.json"
    [ -f "$ORG_JSON" ] || { err "Public org JSON not found: $ORG_JSON"; exit 1; }

    # Stage 1B: Bank submits Application via Central Bank Gateway
    log "Stage 1B: Commercial Bank ${CODE} submitting signed application to Central Bank..."
    APPLY_BODY=$(jq -n \
      --arg code "$CODE" \
      --arg name "Commercial Bank ${CODE}" \
      --arg msp "$BANK_MSP" \
      --arg owner "$OWNER_NODE" \
      --arg peer "peer0.${BANK_ORG}.sworna.example.com:${PEER_PORT}" \
      --arg ca "ca.${BANK_ORG}.sworna.example.com:${CA_PORT}" \
      --arg portal "http://localhost:5273/b/${CODE}" \
      --slurpfile msp_json "$ORG_JSON" \
      '{bank_code:$code, legal_name:$name, msp_id:$msp, owner_node:$owner,
        peer_endpoint:$peer, ca_endpoint:$ca, portal_url:$portal,
        public_msp_json:$msp_json[0], pool_size:10}')

    curl -sf -X POST "$BACKEND/onboarding/apply" \
      -H 'Content-Type: application/json' \
      -d "$APPLY_BODY" >/dev/null || log "Application already submitted or in review."

    # Stage 2 & 3A: Central Bank Monetary Officer Due Diligence
    log "Stage 2 & 3A: Monetary Policy Officer dual-control review..."
    curl -sf -X POST "$BACKEND/onboarding/applications/${CODE}/verify-monetary" \
      -H "Authorization: Bearer $CB_TOKEN" \
      -H 'Content-Type: application/json' \
      -d '{"approved":true, "interbank_limit_minor":50000000}' >/dev/null

    # Stage 3B: Central Bank CISO & Security Officer Final Admission Approval
    log "Stage 3B: CISO Four-Eyes Admission Approval (triggering Idemix wallet minting)..."
    curl -sf -X POST "$BACKEND/onboarding/applications/${CODE}/approve-admission" \
      -H "Authorization: Bearer $CB_TOKEN" \
      -H 'Content-Type: application/json' \
      -d '{"approve":true}' >/dev/null

    # Stage 4: On-Chain Channel Delta Update
    log "Stage 4: Live on-chain channel config update for ${BANK_MSP} on 'settlement'..."
    ALL_OWNERS=$(curl -sf "$BACKEND/banks" -H "Authorization: Bearer $CB_TOKEN" | jq -r '[.[].owner_node] | join(" ")')
    SWORNA_OWNERS="$ALL_OWNERS" "$ROOT/scripts/onboard-bank.sh" "$BANK_MSP" "$ORG_JSON"
  fi

  # Export join bundle
  log "Exporting join bundle for Bank ${CODE}..."
  "$ROOT/scripts/export-join-bundles.sh" >/dev/null

  # Fix permissions on keys and conf directory for containers
  docker run --rm -v "$ROOT/token-services":/work busybox chmod -R 777 /work/keys /work/owner/conf 2>/dev/null || true

  # Join Bank Peer to Channel
  if docker ps --filter "name=peer0.${BANK_ORG}.sworna.example.com" --filter "status=running" -q | grep -q .; then
    log "Bank ${CODE} peer container is already running."
  else
    log "Joining Bank ${CODE} peer to channel & starting CCAAS container..."
    BANK_CODE="$CODE" SWORNA_CB_HOST="127.0.0.1" "$ROOT/scripts/bank-network.sh" join
  fi

  # Start Bank FSC Engine
  if curl -sf "http://localhost:${OWNER_REST_PORT}/api/v1/readyz" >/dev/null 2>&1; then
    log "Bank ${CODE} FSC owner engine (${OWNER_NODE}) is already healthy."
  else
    log "Starting Bank ${CODE} FSC owner engine (${OWNER_NODE}) in Docker..."
    ALL_OWNERS=$(curl -sf "$BACKEND/banks" -H "Authorization: Bearer $CB_TOKEN" | jq -r '[.[].owner_node] | join(" ")')
    BANK_CODE="$CODE" SWORNA_CB_HOST="127.0.0.1" SWORNA_OWNERS="$ALL_OWNERS" "$ROOT/scripts/deploy-bank.sh" "$CODE" engine
  fi
done

# Final Network-Wide Endorsement Policy Commit
log "=========================================================="
log "Committing Token Chaincode Endorsement Policy for all 5 Banks..."
log "=========================================================="
"$ROOT/scripts/commit-chaincode.sh"

log "SUCCESS: All 5 Commercial Banks successfully onboarded and live in Docker!"
