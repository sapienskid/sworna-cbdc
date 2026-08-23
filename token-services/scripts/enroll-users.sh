#!/usr/bin/env bash
#
# Register and enroll all identities needed for the CB's token network:
#   - the CB's own: FSC node identities (issuer, auditor) + their wallet users
#   - the demo banks' owners + wallets (via ./enroll-owner.sh)
#
# Run from token-services/ with the token CA up (deploy-centralbank.sh does this
# automatically on a fresh clone).
set -Exeuo pipefail

# enroll the token-CA admin
fabric-ca-client enroll -u http://admin:adminpw@localhost:27054

# CB FSC node identities (issuer + auditor)
for node in issuer auditor
do
  fabric-ca-client register -u http://localhost:27054 --id.name fsc${node} --id.secret password --id.type client
  fabric-ca-client enroll -u http://fsc${node}:password@localhost:27054 -M "$(pwd)/keys/${node}/fsc/msp"
  mv "$(pwd)/keys/${node}/fsc/msp/keystore/"* "$(pwd)/keys/${node}/fsc/msp/keystore/priv_sk"
done

# issuer + auditor wallet users (non-anonymous)
fabric-ca-client register -u http://localhost:27054 --id.name auditor --id.secret password --id.type client
fabric-ca-client enroll -u http://auditor:password@localhost:27054 -M "$(pwd)/keys/auditor/aud/msp"
fabric-ca-client register -u http://localhost:27054 --id.name issuer --id.secret password --id.type client
fabric-ca-client enroll -u http://issuer:password@localhost:27054 -M "$(pwd)/keys/issuer/iss/msp"

# demo banks' owners + wallets (the CB mints all token identities)
./scripts/enroll-owner.sh owner1 alice,bob
./scripts/enroll-owner.sh owner2 carlos,dan