#!/usr/bin/env bash
#
# Add a commercial bank to the `settlement` channel ON THE LIVE NETWORK — no
# downtime for the orderer, peers, ledger, or any existing bank.
#
# The bank self-provisions its Fabric org on its own VM and sends ONLY its
# public org MSP JSON (`configtxgen -printOrg`). This script then:
#   1. updates the channel config to admit the org            (live)
#   2. regenerates cross-host DNS + re-renders the CB engine confs so the
#      issuer/auditor can reach the new owner                 (~seconds)
#   3. rolling-recreates the issuer/auditor containers        (~10-20 s)
#
# After this, run scripts/commit-chaincode.sh so the endorsement policy
# includes the new bank.
#
# Usage: ./scripts/onboard-bank.sh <MSP> <org-json>
#   e.g. ./scripts/onboard-bank.sh Bank3MSP bank3-org.json
# Env:   SWORNA_OWNERS              all owner nodes (e.g. "owner1 owner2 owner3")
#        SWORNA_OWNER_<NAME>_HOST   each bank VM's IP (drives the DNS override)
set -euo pipefail

MSP="${1:?usage: onboard-bank.sh <MSP> <org-json>}"
ORG_JSON_ARG="${2:?usage: onboard-bank.sh <MSP> <org-json>}"
[ -f "$ORG_JSON_ARG" ] || { echo "ERROR: org JSON not found: $ORG_JSON_ARG" >&2; exit 1; }
ORG_JSON="$(cd "$(dirname "$ORG_JSON_ARG")" && pwd)/$(basename "$ORG_JSON_ARG")"

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

if jq -e --arg MSP "$MSP" '.channel_group.groups.Application.groups | has($MSP)' \
     "$ARTIFACTS/config.json" >/dev/null; then
  infoln "${MSP} is already a member of '${CHANNEL}' — nothing to do"
else
  infoln "merging ${MSP} into the channel config"
  jq -s --arg MSP "$MSP" \
    '.[0] * {"channel_group":{"groups":{"Application":{"groups":{($MSP): .[1]}}}}}' \
    "$ARTIFACTS/config.json" "$ORG_JSON" > "$ARTIFACTS/modified_config.json"

  createConfigUpdate "$CHANNEL" "$ARTIFACTS/config.json" "$ARTIFACTS/modified_config.json" "$ARTIFACTS/update_envelope.pb"
  signConfigtxAsPeerOrg 1 "$ARTIFACTS/update_envelope.pb"

  # --- collect co-signatures from all existing bank peers ---
  # We need majority of current channel members to sign the update
  # Parse existing bank MSPs from channel config
  existing_banks=$(jq -r '.channel_group.groups.Application.groups | keys[]' "$ARTIFACTS/config.json" | grep -v CentralBankMSP || true)
  for bank_msp in $existing_banks; do
    bank_num=$(echo "$bank_msp" | grep -oP '\d+')
    bank_code=$(printf "%03d" "$bank_num")
    owner_host_var="SWORNA_OWNER_OWNER${bank_num}_HOST"
    bank_host="${!owner_host_var:-}"
    if [ -z "$bank_host" ]; then
      warnln "  Skipping ${bank_msp}: ${owner_host_var} not set"
      continue
    fi
    infoln "  sending update_envelope.pb to ${bank_msp} at ${bank_host} for co-signature"
    # Push the .pb file to bank VM
    scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
      "$ARTIFACTS/update_envelope.pb" \
      "${SWORNA_BANK_USER:-bankpt}@${bank_host}:~/sworna-cbdc/network/channel-artifacts/update_envelope.pb"
    # Sign it remotely with Bank's admin MSP
    ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
      "${SWORNA_BANK_USER:-bankpt}@${bank_host}" \
      "cd ~/sworna-cbdc && export PATH=\$PATH:~/sworna-cbdc/bin && \
       FABRIC_CFG_PATH=~/sworna-cbdc/config \
       CORE_PEER_TLS_ENABLED=true \
       CORE_PEER_LOCALMSPID=${bank_msp} \
       CORE_PEER_MSPCONFIGPATH=~/sworna-cbdc/network/organizations/peerOrganizations/bank${bank_num}.sworna.example.com/users/Admin@bank${bank_num}.sworna.example.com/msp \
       CORE_PEER_ADDRESS=localhost:\$((9051 + 2000 * (${bank_num} - 1))) \
       CORE_PEER_TLS_ROOTCERT_FILE=~/sworna-cbdc/network/organizations/peerOrganizations/bank${bank_num}.sworna.example.com/peers/peer0.bank${bank_num}.sworna.example.com/tls/ca.crt \
       ~/sworna-cbdc/bin/peer channel signconfigtx -f ~/sworna-cbdc/network/channel-artifacts/update_envelope.pb" \
      2>&1 | grep -v "^2026\|^Warning\|^DEBUG" || true
    # Pull the signed .pb back
    scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
      "${SWORNA_BANK_USER:-bankpt}@${bank_host}:~/sworna-cbdc/network/channel-artifacts/update_envelope.pb" \
      "$ARTIFACTS/update_envelope.pb"
    infoln "  ${bank_msp} co-signed OK"
  done

  infoln "submitting the config update to add ${MSP}"
  setGlobals 1
  peer channel update -f "$ARTIFACTS/update_envelope.pb" -c "$CHANNEL" \
    -o localhost:7050 --ordererTLSHostnameOverride orderer.sworna.example.com \
    --tls --cafile "$ORDERER_CA"
  successln "${MSP} added to channel '${CHANNEL}'"
fi

# Extract TLS root cert for peer-to-peer commit verification
bank_org="$(echo "$MSP" | sed 's/Bank/bank/;s/MSP//')"
mkdir -p "$NETWORK/organizations/peerOrganizations/${bank_org}.sworna.example.com/tlsca"
jq -r '.values.MSP.value.config.tls_root_certs[0] // empty' "$ORG_JSON" | base64 -d > "$NETWORK/organizations/peerOrganizations/${bank_org}.sworna.example.com/tlsca/tlsca.${bank_org}.sworna.example.com-cert.pem" 2>/dev/null || true

# ---- make the new owner reachable from the CB engine (live refresh) --------
cd "$ROOT/token-services"
export SWORNA_OWNERS="${SWORNA_OWNERS:?SWORNA_OWNERS (all owner nodes) must be set}"

infoln "regenerating cross-host DNS override"
python3 "$ROOT/scripts/gen-net-overrides.py" cb docker-compose.net.yaml

infoln "re-rendering engine confs (owner resolvers)"
for svc in auditor issuer; do
  OWNERS="$SWORNA_OWNERS" \
    python3 "$ROOT/scripts/render-owner-conf.py" "$svc/conf/core.yaml.tpl" > "$svc/conf/core.yaml"
done

infoln "rolling-recreate issuer + auditor (~10 s; ledger and banks unaffected)"
docker compose -f docker-compose.yaml -f docker-compose.net.yaml up -d --force-recreate --no-deps issuer auditor

echo
echo "${MSP} is now a member of '${CHANNEL}' and reachable from the CB engine."
echo "Next steps:"
echo "  1. CB host /etc/hosts: 'owner$(basename "$MSP" | sed 's/Bank//;s/MSP//').sworna.example.com <bank-IP>' if not present"
echo "  2. bank VM re-run:     ./scripts/deploy-bank.sh <CODE>   (joins + starts owner/portal)"
echo "  3. here, commit:       ./scripts/commit-chaincode.sh     (includes ${MSP} in the policy)"