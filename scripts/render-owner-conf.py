#!/usr/bin/env python3
"""Render FSC node conf templates by substituting @@PLACEHOLDER@@ values.

Serves all three node types:
  - owner   (token-services/owner/conf/core.yaml.tpl)
  - auditor (token-services/auditor/conf/core.yaml.tpl)
  - issuer  (token-services/issuer/conf/core.yaml.tpl)

Usage: render-owner-conf.py <template> [> output]

Env (only what the template needs):
  OWNER_NODE    owner{k}            OWNER_P2P      this node's P2P port
  BANK_ORG      bank{k}             BANK_MSP       Bank{k}MSP
  PEER_PORT     bank peer port      BANK_CODE      3-digit code
  POOL_SIZE     wallet pool size (default 10)
  DEMO_WALLETS  unused in production (kept for local tooling)
  OWNERS        space-separated list of ALL owner nodes -> @@OWNER_RESOLVERS@@
"""
import os
import re
import sys


def opt(name: str, default: str = "") -> str:
    return os.environ.get(name) or default


def owner_p2p_port(node: str) -> int:
    m = re.fullmatch(r"owner(\d+)", node)
    return 9201 + 100 * (int(m.group(1)) - 1) if m else 9201


cb_host = opt("SWORNA_CB_HOST", "127.0.0.1")
owner_node = opt("OWNER_NODE", "owner")
bank_org = opt("BANK_ORG")
bank_msp = opt("BANK_MSP")
peer_port = opt("PEER_PORT")
owner_p2p = opt("OWNER_P2P")
bank_code = opt("BANK_CODE")
pool_size = int(opt("POOL_SIZE", "10"))
demo = [w for w in opt("DEMO_WALLETS").split(",") if w]
owners = [o for o in (opt("OWNERS") or opt("SWORNA_OWNERS")).split() if o]

resolvers = []
for node in owners:
    if node == owner_node:
        continue
    cert_found = False
    for candidate in [
        os.path.join("keys", node, "fsc", "msp", "signcerts", "cert.pem"),
        os.path.join(opt("SWORNA_TOKEN_SERVICES"), "keys", node, "fsc", "msp", "signcerts", "cert.pem"),
        os.path.join(os.path.dirname(__file__), "..", "token-services", "keys", node, "fsc", "msp", "signcerts", "cert.pem"),
    ]:
        if candidate and os.path.exists(candidate):
            cert_found = True
            break
    if not cert_found:
        continue
    host = opt(f"SWORNA_OWNER_{node.upper()}_HOST", "127.0.0.1")
    resolvers.append(
        "      - name: %s\n"
        "        identity:\n"
        "          id: %s\n"
        "          path: /var/fsc/keys/%s/fsc/msp/signcerts/cert.pem\n"
        "        addresses:\n"
        "          P2P: %s:%d\n"
        "        aliases:\n"
        "          - %s" % (node, node, node, host, owner_p2p_port(node), node)
    )

wallets = []
for w in demo:
    wallets.append(
        "          - id: %s\n            path: /var/fsc/keys/%s/wallet/%s/msp\n            type: idemix" % (w, owner_node, w)
    )
if bank_code:
    for i in range(1, pool_size + 1):
        wid = "pool_%s_w%d" % (bank_code, i)
        is_default = "\n            default: true" if i == 1 else ""
        wallets.append(
            "          - id: %s%s\n            path: /var/fsc/keys/%s/wallet/%s/msp\n            type: idemix" % (wid, is_default, owner_node, wid)
        )

all_msps = [
    "      - id: CentralBankMSP\n"
    "        mspType: bccsp\n"
    "        mspID: CentralBankMSP\n"
    "        path: /var/fsc/fabric/organizations/peerOrganizations/centralbank.sworna.example.com/msp"
]
for node in owners:
    m = re.fullmatch(r"owner(\d+)", node)
    if m:
        k = m.group(1)
        all_msps.append(
            "      - id: Bank%sMSP\n"
            "        mspType: bccsp\n"
            "        mspID: Bank%sMSP\n"
            "        path: /var/fsc/fabric/organizations/peerOrganizations/bank%s.sworna.example.com/msp" % (k, k, k)
        )

with open(sys.argv[1]) as f:
    tpl = f.read()

listen_ip = "0.0.0.0"

out = tpl
out = out.replace("@@LISTEN_IP@@", listen_ip)
out = out.replace("@@CB_HOST@@", cb_host)
out = out.replace("@@OWNER_NODE@@", owner_node)
out = out.replace("@@OWNER_P2P@@", owner_p2p)
out = out.replace("@@BANK_ORG@@", bank_org)
out = out.replace("@@BANK_MSP@@", bank_msp)
out = out.replace("@@PEER_PORT@@", peer_port)
out = out.replace("@@OWNER_RESOLVERS@@", "\n".join(resolvers))
out = out.replace("@@WALLETS@@", "\n".join(wallets))
out = out.replace("@@ALL_MSPS@@", "\n".join(all_msps))

sys.stdout.write(out)