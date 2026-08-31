#!/usr/bin/env bash
#
# Export a join bundle per registered bank to dist-bank-bundles/.
#
# Each bundle now contains ONLY what the bank cannot generate itself and what
# is not secret to the CB network:
#   - token-services/keys/<owner_node>     idemix wallets (minted by the CB's
#                                          token CA: the bank's fsc identity,
#                                          demo wallets and pool wallets)
#   - orderer TLS CA cert + tlsca cert      public certs needed to reach the
#                                          CB-hosted orderer
#
# NO bank Fabric keys, NO CA data, NO genesis block — the bank generates its
# own org identity on its own VM and fetches the genesis block from the orderer.
#
# Requires the backend to be up (it reads the bank registry).
set -Eeuo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
OUT="$ROOT/dist-bank-bundles"
mkdir -p "$OUT"

log_info() { printf '[%s] INFO: %s\n' "$(date +'%H:%M:%S')" "$*"; }

BACKEND="${SWORNA_BACKEND:-http://localhost:8000/api/v1}"
TOKEN=$(curl -sf -X POST "$BACKEND/auth/login" -H 'Content-Type: application/json' \
  -d '{"username":"cbadmin","password":"sworna-cb"}' | jq -r .token)
BANKS=$(curl -sf "$BACKEND/banks" -H "Authorization: Bearer $TOKEN")

if [ "$(echo "$BANKS" | jq 'length')" -eq 0 ]; then
  log_info "no banks registered yet — nothing to export"
  exit 0
fi

for row in $(echo "$BANKS" | jq -r '.[] | @base64'); do
  code=$(echo "$row" | base64 -d | jq -r .code)
  owner=$(echo "$row" | base64 -d | jq -r .owner_node)
  tarfile="$OUT/bank${code}.tar.gz"
  log_info "packing bank $code ($owner) -> $tarfile"
  tar -czf "$tarfile" -C "$ROOT" \
    "token-services/keys/$owner" \
    token-services/keys/auditor/fsc/msp/signcerts/cert.pem \
    token-services/keys/issuer/fsc/msp/signcerts/cert.pem \
    network/organizations/ordererOrganizations/sworna.example.com/orderers/orderer.sworna.example.com/tls/ca.crt \
    network/organizations/ordererOrganizations/sworna.example.com/tlsca/tlsca.sworna.example.com-cert.pem
done

log_info "bundles ready in $OUT — copy each to its bank VM and extract under the repo root."
log_info "  scp $OUT/bank<CODE>.tar.gz sapiens@<BANK-IP>:~/CBDC/  &&  (cd ~/CBDC && tar xzf bank<CODE>.tar.gz)"