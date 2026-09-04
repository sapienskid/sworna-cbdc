# Issuer FSC node configuration — TEMPLATE.
# Rendered by scripts/render-owner-conf.py (owner-resolvers block comes from
# the SWORNA_OWNERS list). Rendered output: issuer/conf/core.yaml (gitignored).
logging:
  spec: info
  format: '%{color}%{time:2006-01-02 15:04:05.000 MST} [%{module}] %{shortfunc} -> %{level:.4s} %{id:03x}%{color:reset} %{message}'

# ------------------- FSC Node Configuration -------------------------
# The FSC node is responsible for the peer to peer communication with other token services.
fsc:
  identity:
    cert:
      file: /var/fsc/keys/issuer/fsc/msp/signcerts/cert.pem
    key:
      file: /var/fsc/keys/issuer/fsc/msp/keystore/priv_sk
  tls:
    enabled: false # TODO
  p2p:
    listenAddress: /ip4/@@LISTEN_IP@@/tcp/9101
    # If empty, this is a P2P boostrap node. Otherwise, it contains the name of the FSC node that is a bootstrap node.
    # The name of the FSC node that is a bootstrap node must be set under fsc.endpoint.resolvers
    bootstrapNode: auditor
  kvs: # key-value-store
    persistence:
      type: badger # badger or memory
      opts:
        path: /var/fsc/data/issuer/kvs

  # The endpoint section tells how to reach other FSC node in the network.
  # For each node, the name, the domain, the identity of the node, and its addresses must be specified.
  endpoint:
    resolvers:
      - name: auditor
        identity:
          id: auditor
          path: /var/fsc/keys/auditor/fsc/msp/signcerts/cert.pem
        addresses:
          P2P: @@CB_HOST@@:9001
@@OWNER_RESOLVERS@@

# ------------------- Fabric Configuration -------------------------
fabric: 
  enabled: true
  mynetwork:
    default: true
    mspConfigPath: /var/fsc/fabric/organizations/peerOrganizations/centralbank.sworna.example.com/users/User1@centralbank.sworna.example.com/msp
    defaultMSP: CentralBankMSP
    msps:
@@ALL_MSPS@@
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
      - address: peer0.centralbank.sworna.example.com:7051
        connectionTimeout: 10s
        tlsEnabled: true
        tlsRootCertFile: /var/fsc/fabric/organizations/peerOrganizations/centralbank.sworna.example.com/peers/peer0.centralbank.sworna.example.com/tls/ca.crt
        serverNameOverride: peer0.centralbank.sworna.example.com
    # Channel where the token chaincode is deployed
    channels:
      - name: settlement
        default: true
    # Configuration of the vault used to store the RW sets assembled by this node
    vault:
      persistence:
        type: badger
        opts:
          path: /var/fsc/data/issuer/vault

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
        issuers:
          - id: issuer # the unique identifier of this wallet. Here is an example of use: `ttx.GetIssuerWallet(context, "issuer)`
            default: true # is this the default issuer wallet
            path: /var/fsc/keys/issuer/iss/msp
  # Internal database to keep track of token transactions. 
  # It is used by auditors and token owners to track history
  ttxdb:
    persistence:
      # type can be badger (disk) or memory
      type: badger
      opts:
        path: /var/fsc/data/issuer/txdb