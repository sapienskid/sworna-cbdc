#!/usr/bin/env bash
#
# Commit (or upgrade) the token chaincode on the CB host with an OR endorsement
# policy over the central bank + every onboarded commercial bank.
#
# Upgrade-aware: if the chaincode is already committed, the sequence is
# incremented and the CB org re-approves before committing, so adding a new
# bank later is just: onboard-bank.sh -> bank join -> commit-chaincode.sh.
#
# Usage: ./scripts/commit-chaincode.sh [MSP1 MSP2 ...]
#   With no args, the bank list is read from the backend registry.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NETWORK="$ROOT/network"
cd "$NETWORK"
export PATH="$ROOT/bin:$PATH"
export FABRIC_CFG_PATH="$ROOT/config"

CHANNEL=settlement
CC_NAME=tokenchaincode

. scripts/envVar.sh
setGlobals 1

if [ "$#" -gt 0 ]; then
  BANK_MSP_LIST="$*"
else
  TOKEN=$(curl -sf -X POST http://localhost:8000/api/v1/auth/login \
    -H 'Content-Type: application/json' \
    -d '{"username":"cbadmin","password":"sworna-cb"}' | jq -r .token)
  BANK_MSP_LIST=$(curl -sf http://localhost:8000/api/v1/banks \
    -H "Authorization: Bearer $TOKEN" | jq -r '.[].msp_id' | sort)
fi

policy="OR('CentralBankMSP.peer'"
for msp in $BANK_MSP_LIST; do
  policy="$policy,'${msp}.peer'"
done
policy="$policy)"
echo "endorsement policy: $policy"

# Determine the next sequence + version from the committed definition.
committed_seq=$(peer lifecycle chaincode querycommitted --channelID "$CHANNEL" --name "$CC_NAME" \
  --output json 2>/dev/null | jq -r '.sequence // .chaincode_definitions[0].sequence // empty' || true)
if [ -n "$committed_seq" ]; then
  CC_SEQUENCE=$((committed_seq + 1))
  CC_VERSION="$CC_SEQUENCE"
  echo "chaincode is committed at sequence ${committed_seq}; upgrading to ${CC_SEQUENCE}"
else
  CC_SEQUENCE=1
  CC_VERSION=1
  echo "chaincode not committed yet; committing at sequence 1"
fi

PACKAGE_ID=$(peer lifecycle chaincode queryinstalled --output json \
  | jq -r '.installed_chaincodes[] | select(.label | startswith("tokenchaincode_")) | .package_id' | head -1)
[ -n "$PACKAGE_ID" ] || { echo "ERROR: no tokenchaincode package installed on peer0.centralbank" >&2; exit 1; }

infoln "approving the definition for CentralBankMSP (v${CC_VERSION} seq ${CC_SEQUENCE})"
peer lifecycle chaincode approveformyorg -o localhost:7050 \
  --ordererTLSHostnameOverride orderer.sworna.example.com --tls --cafile "$ORDERER_CA" \
  --channelID "$CHANNEL" --name "$CC_NAME" --version "$CC_VERSION" --sequence "$CC_SEQUENCE" \
  --package-id "$PACKAGE_ID" --init-required

# Build peerAddresses and tlsRootCertFiles list for all onboarded peers
PEER_FLAGS=(--peerAddresses localhost:7051 --tlsRootCertFiles "$PEER0_ORG1_CA")
for msp in $BANK_MSP_LIST; do
  bank_org="$(echo "$msp" | sed 's/Bank/bank/;s/MSP//')"
  tls_cert="$NETWORK/organizations/peerOrganizations/${bank_org}.sworna.example.com/tlsca/tlsca.${bank_org}.sworna.example.com-cert.pem"
  if [ -f "$tls_cert" ]; then
    PEER_FLAGS+=(--peerAddresses "peer0.${bank_org}.sworna.example.com:9051" --tlsRootCertFiles "$tls_cert")
  fi
done

infoln "committing chaincode ${CC_NAME} v${CC_VERSION} seq ${CC_SEQUENCE} on '${CHANNEL}' across peers: ${PEER_FLAGS[*]}"
peer lifecycle chaincode commit -o localhost:7050 \
  --ordererTLSHostnameOverride orderer.sworna.example.com --tls --cafile "$ORDERER_CA" \
  --channelID "$CHANNEL" --name "$CC_NAME" --version "$CC_VERSION" --sequence "$CC_SEQUENCE" \
  --init-required "${PEER_FLAGS[@]}"

infoln "committed. querying the committed definition:"
peer lifecycle chaincode querycommitted --channelID "$CHANNEL" --name "$CC_NAME"

infoln "initializing public parameters via chaincode Init..."
peer chaincode invoke -o localhost:7050 \
  --ordererTLSHostnameOverride orderer.sworna.example.com --tls --cafile "$ORDERER_CA" \
  --channelID "$CHANNEL" --name "$CC_NAME" --isInit -c '{"Args":[]}' \
  "${PEER_FLAGS[@]}"