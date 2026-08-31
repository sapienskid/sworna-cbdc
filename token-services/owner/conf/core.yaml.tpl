# Owner FSC node configuration — TEMPLATE.
# Rendered per bank by scripts/render-owner-conf.py into
# token-services/owner/conf/<owner_node>/core.yaml (see scripts/bank-network.sh).
# Scalar placeholders: @@OWNER_NODE@@ @@OWNER_P2P@@ @@BANK_ORG@@ @@BANK_MSP@@ @@PEER_PORT@@
logging:
  spec: info
  format: '%{color}%{time:2006-01-02 15:04:05.000 MST} [%{module}] %{shortfunc} -> %{level:.4s} %{id:03x}%{color:reset} %{message}'

# ------------------- FSC Node Configuration -------------------------
# The FSC node is responsible for the peer to peer communication with other token services.
fsc:
  identity:
    cert:
      file: /var/fsc/keys/@@OWNER_NODE@@/fsc/msp/signcerts/cert.pem
    key:
      file: /var/fsc/keys/@@OWNER_NODE@@/fsc/msp/keystore/priv_sk
  tls:
    enabled: false # TODO
  p2p:
    listenAddress: /ip4/0.0.0.0/tcp/@@OWNER_P2P@@
    # If empty, this is a P2P boostrap node. Otherwise, it contains the name of the FSC node that is a bootstrap node.
    # The name of the FSC node that is a bootstrap node must be set under fsc.endpoint.resolvers
    bootstrapNode: auditor
  kvs: # key-value-store
    persistence:
      type: badger # badger or memory
      opts:
        path: /var/fsc/data/@@OWNER_NODE@@/kvs

  # The endpoint section tells how to reach other FSC node in the network.
  # For each node, the name, the domain, the identity of the node, and its addresses must be specified.
  endpoint:
    resolvers:
      - name: auditor
        identity:
          id: auditor
          path: /var/fsc/keys/auditor/fsc/msp/signcerts/cert.pem
        addresses:
          P2P: /dns4/auditor.sworna.example.com/tcp/9001
      - name: issuer
        identity:
          id: issuer
          path: /var/fsc/keys/issuer/fsc/msp/signcerts/cert.pem
        addresses:
          P2P: /dns4/issuer.sworna.example.com/tcp/9101
@@OWNER_RESOLVERS@@

# ------------------- Fabric Configuration -------------------------
fabric: 
  enabled: true
  mynetwork:
    default: true
    mspConfigPath: /var/fsc/fabric/organizations/peerOrganizations/@@BANK_ORG@@.sworna.example.com/users/User1@@@BANK_ORG@@.sworna.example.com/msp
    defaultMSP: @@BANK_MSP@@
    msps:
      - id: @@BANK_MSP@@
        mspType: bccsp
        mspID: @@BANK_MSP@@
        path: /var/fsc/fabric/organizations/peerOrganizations/@@BANK_ORG@@.sworna.example.com/users/User1@@@BANK_ORG@@.sworna.example.com/msp
    tls:
      enabled: true
    # If the keepalive values are too low, Fabric peers will complain with: ENHANCE_YOUR_CALM, debug data: "too_many_pings"
    keepalive:
      interval: 300s
      timeout: 600s
    # List of orderer nodes this node can connect to. There must be at least one orderer node. Others are discovered.
    orderers:
      - address: orderer.sworna.example.com:7050
        connectionTimeout: 10s
        tlsEnabled: true
        tlsRootCertFile: /var/fsc/fabric/organizations/ordererOrganizations/sworna.example.com/orderers/orderer.sworna.example.com/tls/ca.crt
        serverNameOverride: orderer.sworna.example.com
    # List of trusted peers this node can connect to. There must be at least one trusted peer. Others are discovered.
    peers:
      - address: peer0.@@BANK_ORG@@.sworna.example.com:@@PEER_PORT@@
        connectionTimeout: 10s
        tlsEnabled: true
        tlsRootCertFile: /var/fsc/fabric/organizations/peerOrganizations/@@BANK_ORG@@.sworna.example.com/peers/peer0.@@BANK_ORG@@.sworna.example.com/tls/ca.crt
        serverNameOverride: peer0.@@BANK_ORG@@.sworna.example.com
    # Channel where the token chaincode is deployed
    channels:
      - name: settlement
        default: true
    # Configuration of the vault used to store the RW sets assembled by this node
    vault:
      persistence:
        type: badger
        opts:
          path: /var/fsc/data/@@OWNER_NODE@@/vault

# ------------------- Token SDK Configuration -------------------------
token:
  enabled: true
  tms:
    mytms: # unique name of this token management system
      network: mynetwork # the name of the fabric network as configured above
      channel: settlement # the name of the network's channel this TMS refers to, if applicable
      namespace: tokenchaincode # chaincode name
      driver: zkatdlog # privacy preserving driver (zero knowledge asset transfer)
      wallets:
        defaultCacheSize: 3 # how many idemix keys to pre-generate
        owners:
@@WALLETS@@

  # Internal database to keep track of token transactions. 
  # It is used by auditors and token owners to track history
  ttxdb:
    persistence:
      # type can be badger (disk) or memory
      type: badger
      opts:
        path: /var/fsc/data/@@OWNER_NODE@@/txdb