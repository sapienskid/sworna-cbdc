#!/usr/bin/env bash
#
# Register + enroll a commercial bank's Fabric org identities against the
# bank's OWN Fabric CA (started on this VM via compose-bank-peer.yaml).
#
# Called by scripts/bank-network.sh (subcommand: identity). Run from the repo
# root's network/ directory. The private keys never leave this VM.
#
# Env (set by bank-network.sh):
#   BANK_ORG       bank{k}            (org domain)
#   BANK_MSP       Bank{k}MSP
#   BANK_CA_PORT   this bank's CA port (8054+1000(k-1))
#   BANK_CA_NAME   ca-bank{k}
set -Eeuo pipefail

ORG="$BANK_ORG"
ORG_DIR="${PWD}/organizations/peerOrganizations/${ORG}.sworna.example.com"
CA_HOSTPORT="localhost:${BANK_CA_PORT}"
CA_CERT="${PWD}/organizations/fabric-ca/${ORG}/ca-cert.pem"
ADMIN_PW=adminpw

log() { printf '[%s] %s\n' "$(date +'%H:%M:%S')" "$*"; }

mkdir -p "$ORG_DIR"
export FABRIC_CA_CLIENT_HOME="${ORG_DIR}"

fabric-ca-client enroll -u "https://admin:${ADMIN_PW}@${CA_HOSTPORT}" \
  --caname "$BANK_CA_NAME" --tls.certfiles "$CA_CERT"

cat > "${ORG_DIR}/msp/config.yaml" <<EOF
NodeOUs:
  Enable: true
  ClientOUIdentifier:
    Certificate: cacerts/localhost-${BANK_CA_PORT}-${BANK_CA_NAME}.pem
    OrganizationalUnitIdentifier: client
  PeerOUIdentifier:
    Certificate: cacerts/localhost-${BANK_CA_PORT}-${BANK_CA_NAME}.pem
    OrganizationalUnitIdentifier: peer
  AdminOUIdentifier:
    Certificate: cacerts/localhost-${BANK_CA_PORT}-${BANK_CA_NAME}.pem
    OrganizationalUnitIdentifier: admin
  OrdererOUIdentifier:
    Certificate: cacerts/localhost-${BANK_CA_PORT}-${BANK_CA_NAME}.pem
    OrganizationalUnitIdentifier: orderer
EOF

mkdir -p "${ORG_DIR}/msp/tlscacerts"
cp "$CA_CERT" "${ORG_DIR}/msp/tlscacerts/ca.crt"
mkdir -p "${ORG_DIR}/tlsca"
cp "$CA_CERT" "${ORG_DIR}/tlsca/tlsca.${ORG}.sworna.example.com-cert.pem"
mkdir -p "${ORG_DIR}/ca"
cp "$CA_CERT" "${ORG_DIR}/ca/ca.${ORG}.sworna.example.com-cert.pem"

PEER=peer0
register_enroll_peer() {
  log "registering + enrolling $PEER (msp + tls)"
  fabric-ca-client register --caname "$BANK_CA_NAME" --id.name "$PEER" --id.secret "${PEER}pw" \
    --id.type peer --tls.certfiles "$CA_CERT" || true
  fabric-ca-client enroll -u "https://${PEER}:${PEER}pw@${CA_HOSTPORT}" --caname "$BANK_CA_NAME" \
    -M "${ORG_DIR}/peers/${PEER}.${ORG}.sworna.example.com/msp" --tls.certfiles "$CA_CERT"
  cp "${ORG_DIR}/msp/config.yaml" "${ORG_DIR}/peers/${PEER}.${ORG}.sworna.example.com/msp/config.yaml"

  fabric-ca-client enroll -u "https://${PEER}:${PEER}pw@${CA_HOSTPORT}" --caname "$BANK_CA_NAME" \
    -M "${ORG_DIR}/peers/${PEER}.${ORG}.sworna.example.com/tls" --enrollment.profile tls \
    --csr.hosts "${PEER}.${ORG}.sworna.example.com" --csr.hosts localhost --tls.certfiles "$CA_CERT"

  cp "${ORG_DIR}/peers/${PEER}.${ORG}.sworna.example.com/tls/tlscacerts/"* \
     "${ORG_DIR}/peers/${PEER}.${ORG}.sworna.example.com/tls/ca.crt"
  cp "${ORG_DIR}/peers/${PEER}.${ORG}.sworna.example.com/tls/signcerts/"* \
     "${ORG_DIR}/peers/${PEER}.${ORG}.sworna.example.com/tls/server.crt"
  cp "${ORG_DIR}/peers/${PEER}.${ORG}.sworna.example.com/tls/keystore/"* \
     "${ORG_DIR}/peers/${PEER}.${ORG}.sworna.example.com/tls/server.key"
}

log "registering user1 + org admin"
fabric-ca-client register --caname "$BANK_CA_NAME" --id.name user1 --id.secret user1pw \
  --id.type client --tls.certfiles "$CA_CERT" || true
fabric-ca-client register --caname "$BANK_CA_NAME" --id.name orgadmin --id.secret orgadminpw \
  --id.type admin --tls.certfiles "$CA_CERT" || true

register_enroll_peer

log "enrolling user1"
fabric-ca-client enroll -u "https://user1:user1pw@${CA_HOSTPORT}" --caname "$BANK_CA_NAME" \
  -M "${ORG_DIR}/users/User1@${ORG}.sworna.example.com/msp" --tls.certfiles "$CA_CERT"
cp "${ORG_DIR}/msp/config.yaml" "${ORG_DIR}/users/User1@${ORG}.sworna.example.com/msp/config.yaml"

log "enrolling org admin"
fabric-ca-client enroll -u "https://orgadmin:orgadminpw@${CA_HOSTPORT}" --caname "$BANK_CA_NAME" \
  -M "${ORG_DIR}/users/Admin@${ORG}.sworna.example.com/msp" --tls.certfiles "$CA_CERT"
cp "${ORG_DIR}/msp/config.yaml" "${ORG_DIR}/users/Admin@${ORG}.sworna.example.com/msp/config.yaml"

log "org ${BANK_MSP} identities enrolled against the bank's own CA"