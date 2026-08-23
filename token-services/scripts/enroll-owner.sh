#!/usr/bin/env bash
#
# Enroll one bank's token identities at the token CA (on the CB host):
#   - the owner's FSC node identity (fsc owner{k})
#   - the owner's demo wallets (idemix), if any
#
# Usage (from token-services/):
#   ./scripts/enroll-owner.sh <OWNER_NODE> [DEMO_WALLETS_CSV]
#   e.g. ./scripts/enroll-owner.sh owner3
#        ./scripts/enroll-owner.sh owner1 alice,bob
set -Eeuo pipefail

OWNER="${1:?usage: enroll-owner.sh <OWNER_NODE> [DEMO_WALLETS_CSV]}"
DEMO="${2:-}"

cd "$(dirname "${BASH_SOURCE[0]}")/.."     # token-services/
mkdir -p "keys/${OWNER}"

fabric-ca-client register -u http://localhost:27054 \
  --id.name "fsc${OWNER}" --id.secret password --id.type client
fabric-ca-client enroll -u "http://fsc${OWNER}:password@localhost:27054" \
  -M "$(pwd)/keys/${OWNER}/fsc/msp"

# make the private key name predictable (the conf references priv_sk)
mv "$(pwd)/keys/${OWNER}/fsc/msp/keystore/"* "$(pwd)/keys/${OWNER}/fsc/msp/keystore/priv_sk"

IFS=',' read -ra WALLETS <<< "$DEMO"
for w in "${WALLETS[@]}"; do
  [ -z "$w" ] && continue
  fabric-ca-client register -u http://localhost:27054 --id.name "$w" --id.secret password \
    --id.type client --enrollment.type idemix --idemix.curve gurvy.Bn254
  fabric-ca-client enroll -u "http://$w:password@localhost:27054" \
    -M "$(pwd)/keys/${OWNER}/wallet/$w/msp" --enrollment.type idemix --idemix.curve gurvy.Bn254
done

echo "enrolled $OWNER (fsc identity + ${#WALLETS[@]} demo wallets)"