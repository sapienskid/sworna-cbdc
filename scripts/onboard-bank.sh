#!/usr/bin/env bash
#
# Add a commercial bank's org to the `settlement` channel on the CB host.
#
# The bank self-provisions its org on its own VM and sends ONLY its public org
# MSP JSON (from `configtxgen -printOrg`) here. This updates the channel config
# to make the bank a member.
#
# Usage: ./scripts/onboard-bank.sh <MSP> <org-json>
#   e.g. ./scripts/onboard-bank.sh Bank3MSP bank3-org.json
set -euo pipefail

MSP="${1:?usage: onboard-bank.sh <MSP> <org-json>}"
ORG_JSON="${2:?usage: onboard-bank.sh <MSP> <org-json>}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NETWORK="$ROOT/network"
cd "$NETWORK"
export PATH="$ROOT/bin:$PATH"
export FABRIC_CFG_PATH="$ROOT/config"
export TEST_NETWORK_HOME="$NETWORK"

CHANNEL=settlement
ARTIFACTS="$NETWORK/channel-artifacts"

. scripts/configUpdate.sh
. scripts/envVar.sh

infoln "fetching channel config for '${CHANNEL}'"
fetchChannelConfig 1 "$CHANNEL" "$ARTIFACTS/config.json"

infoln "merging ${MSP} into the channel config"
jq -s --arg MSP "$MSP" \
  '.[0] * {"channel_group":{"groups":{"Application":{"groups":{($MSP): .[1]}}}}}' \
  "$ARTIFACTS/config.json" "$ORG_JSON" > "$ARTIFACTS/modified_config.json"

infoln "computing + signing the config update"
createConfigUpdate "$CHANNEL" "$ARTIFACTS/config.json" "$ARTIFACTS/modified_config.json" "$ARTIFACTS/update_envelope.pb"
signConfigtxAsPeerOrg 1 "$ARTIFACTS/update_envelope.pb"

infoln "submitting the config update to add ${MSP}"
setGlobals 1
peer channel update -f "$ARTIFACTS/update_envelope.pb" -c "$CHANNEL" \
  -o localhost:7050 --ordererTLSHostnameOverride orderer.sworna.example.com \
  --tls --cafile "$ORDERER_CA"

successln "${MSP} added to channel '${CHANNEL}'"
echo "Next: on the bank VM run ./scripts/deploy-bank.sh <CODE> (joins + chaincode)."
echo "After all banks are onboarded, commit the chaincode: ./scripts/commit-chaincode.sh"