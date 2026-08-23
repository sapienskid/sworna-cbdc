#!/usr/bin/env python3
"""Render a bank's owner FSC conf from token-services/owner/conf/core.yaml.tpl.

Usage: render-owner-conf.py <template> > <out>
Env:  OWNER_NODE   owner{k} (e.g. owner1)
      OWNER_INDEX  k (1-based bank index)
      BANK_ORG     bank{k}
      BANK_MSP     Bank{k}MSP
      PEER_PORT    the bank's Fabric peer port
      OWNER_P2P    the bank's FSC P2P listen port
      BANK_CODE    3-digit code (e.g. 001)
      POOL_SIZE    wallet pool size (default 10)
      DEMO_WALLETS comma-separated demo wallet ids (default empty)
      OWNERS       space-separated list of ALL owner nodes (resolvers)
"""
import os
import re
import sys


def req(name: str) -> str:
    v = os.environ.get(name, "")
    if not v:
        print(f"render-owner-conf: {name} not set", file=sys.stderr)
        sys.exit(1)
    return v


def owner_p2p_port(node: str) -> int:
    m = re.fullmatch(r"owner(\d+)", node)
    return 9201 + 100 * (int(m.group(1)) - 1) if m else 9201


owner_node = req("OWNER_NODE")
bank_org = req("BANK_ORG")
bank_msp = req("BANK_MSP")
peer_port = req("PEER_PORT")
owner_p2p = req("OWNER_P2P")
bank_code = req("BANK_CODE")
pool_size = int(os.environ.get("POOL_SIZE", "10"))
demo = [w for w in os.environ.get("DEMO_WALLETS", "").split(",") if w]
owners = [o for o in os.environ.get("OWNERS", "").split() if o]

resolvers = []
for node in owners:
    if node == owner_node:
        continue
    resolvers.append(
        "      - name: %s\n"
        "        identity:\n"
        "          id: %s\n"
        "          path: /var/fsc/keys/%s/fsc/msp/signcerts/cert.pem\n"
        "        addresses:\n"
        "          P2P: %s.sworna.example.com:%d\n"
        "        aliases:\n"
        "          - %s" % (node, node, node, node, owner_p2p_port(node), node)
    )

wallets = []
for w in demo:
    wallets.append(
        "          - id: %s\n            path: /var/fsc/keys/%s/wallet/%s/msp" % (w, owner_node, w)
    )
for i in range(1, pool_size + 1):
    wid = "pool_%s_w%d" % (bank_code, i)
    wallets.append(
        "          - id: %s\n            path: /var/fsc/keys/%s/wallet/%s/msp" % (wid, owner_node, wid)
    )

with open(sys.argv[1]) as f:
    tpl = f.read()

out = tpl
out = out.replace("@@OWNER_NODE@@", owner_node)
out = out.replace("@@OWNER_P2P@@", owner_p2p)
out = out.replace("@@BANK_ORG@@", bank_org)
out = out.replace("@@BANK_MSP@@", bank_msp)
out = out.replace("@@PEER_PORT@@", peer_port)
out = out.replace("@@OWNER_RESOLVERS@@", "\n".join(resolvers))
out = out.replace("@@WALLETS@@", "\n".join(wallets))

sys.stdout.write(out)