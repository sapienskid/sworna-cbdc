#!/usr/bin/env bash
#
# Enroll the CENTRAL BANK's token identities at the token CA:
#   - FSC node identities for issuer + auditor
#   - the issuer / auditor wallet users
#
# Bank owners are NOT enrolled here — each bank's identity + wallets are minted
# by the CB when the bank is created and provisioned
# (`POST /api/v1/admin/banks/{code}/provision` -> app/provisioning.py).
#
# Run from token-services/ with the token CA up.
set -Exeuo pipefail

# enroll the token-CA admin
fabric-ca-client enroll -u http://admin:adminpw@localhost:27054

# CB FSC node identities (issuer + auditor)
for node in issuer auditor
do
  fabric-ca-client register -u http://localhost:27054 --id.name fsc${node} --id.secret password --id.type client || true
  fabric-ca-client enroll -u http://fsc${node}:password@localhost:27054 -M "$(pwd)/keys/${node}/fsc/msp"
  if [ -d "$(pwd)/keys/${node}/fsc/msp/keystore" ]; then
    find "$(pwd)/keys/${node}/fsc/msp/keystore" -type f ! -name "priv_sk" -exec mv {} "$(pwd)/keys/${node}/fsc/msp/keystore/priv_sk" \; || true
  fi
done

# issuer + auditor wallet users (non-anonymous)
fabric-ca-client register -u http://localhost:27054 --id.name auditor --id.secret password --id.type client || true
fabric-ca-client enroll -u http://auditor:password@localhost:27054 -M "$(pwd)/keys/auditor/aud/msp"
fabric-ca-client register -u http://localhost:27054 --id.name issuer --id.secret password --id.type client || true
fabric-ca-client enroll -u http://issuer:password@localhost:27054 -M "$(pwd)/keys/issuer/iss/msp"