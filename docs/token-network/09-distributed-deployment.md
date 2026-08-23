# Token network — distributed deployment (3 hosts)

> **Status: IMPLEMENTED — pending live validation.** The scripts, compose files
> and join-bundle flow below are in the repo and pass static validation, but the
> cross-host run (bank peers on their own VMs reaching the CB host) has not yet
> been exercised on real VMs. Until the §4 checklist passes, the dev-laptop
> all-in-one (testing only) remains the validated reference — see
> [SETUP.md](../SETUP.md).

## 1. Host → role map

Every bank is **fully self-contained** on its own VM (CA + peer + chaincode +
owner + portal). The CB host keeps the orderer, the central-bank peer, the token
CA, issuer/auditor, backend and CB portal.

| Host | Runs | Ports (host) |
|---|---|---|
| Central bank VM | orderer · peer0.centralbank · ca_org1 · ca_orderer · ca_token_network · issuer · auditor · swagger-ui · backend · CB portal | 7050/7053, 7051, 7054/9054, 27054, 9000, 9100, 8000, 5173 |
| Bank A VM | ca_org2 · peer0.banka · token chaincode (peer0org2) · owner1 · bank portal | 8054, 9051, 9200, 5173 |
| Bank B VM | ca_org3 · peer0.bankb · token chaincode (peer0org3) · owner2 · bank portal | 9054, 11051, 9300, 5173 |

## 2. Cross-host DNS (handled by compose `extra_hosts`)

Containers cannot use the host's `/etc/hosts`. Each host's compose files map the
remote `*.sworna.example.com` names to the owning VM's Tailscale IP:

- **Bank peer** (`network/compose/compose-bank-peer.yaml`): maps
  `orderer.sworna.example.com` and `peer0.centralbank.sworna.example.com` to
  `SWORNA_CB_HOST`.
- **Bank owner** (`token-services/docker-compose.bank.net.yaml`): maps
  orderer/auditor/issuer → `SWORNA_CB_HOST`, and the other bank's owner →
  `SWORNA_OTHER_BANK_HOST`.
- **CB issuer/auditor** (`token-services/docker-compose.net.yaml`): maps
  owner1/owner2 → `SWORNA_BANKA_HOST` / `SWORNA_BANKB_HOST`.

The peers/owners connect **out** to the CB host; no inbound firewall rules are
needed on the CB beyond the published ports. The orderer does not dial peers.

## 3. Bring-up sequence

### 3.1 CB host (distributed mode)

```bash
export SWORNA_BANKA_HOST=<bank-A-IP> SWORNA_BANKB_HOST=<bank-B-IP>   # optional, for cross-bank
./scripts/deploy-centralbank.sh --provision --distributed
```

This brings up the full network (all 3 orgs + channel + chaincode committed),
then **stops/removes the bank peers/CAs/chaincode from the CB host** and exports
each bank's join bundle:

```bash
ls dist-bank-bundles/        # banka.tar.gz, bankb.tar.gz
```

### 3.2 Copy join bundles to the bank VMs

```bash
scp dist-bank-bundles/banka.tar.gz sapiens@<BANK-A-IP>:~/CBDC/
scp dist-bank-bundles/bankb.tar.gz sapiens@<BANK-B-IP>:~/CBDC/
# on each bank VM, extract under the repo root:
#   cd ~/CBDC && tar xzf banka.tar.gz
```

The bundle (see `scripts/export-join-bundles.sh`) contains everything a bank
needs that isn't in git: the owner's idemix wallets, the org's peer/admin
crypto, the orderer TLS CA, the org's Fabric CA data, and the channel genesis
block.

### 3.3 Bank VMs

```bash
# Bank A
export SWORNA_CB_HOST=<CB-IP> SWORNA_BANKB_HOST=<BANK-B-IP>
./scripts/deploy-banka.sh

# Bank B
export SWORNA_CB_HOST=<CB-IP> SWORNA_BANKA_HOST=<BANK-A-IP>
./scripts/deploy-bankb.sh
```

Each bank script: installs the bundle, starts CA + peer, joins `settlement`,
installs the token chaincode package and runs its CCAAS container
(`scripts/bank-network.sh up`), starts the owner service, and starts the portal.

## 4. Validation checklist (run once, record the result)

- [ ] Bank A VM: `docker ps` shows `ca_org2`, `peer0.banka.sworna.example.com`, `peer0org2_tokenchaincode_ccaas`, `owner1` healthy
- [ ] Bank B VM: `docker ps` shows `ca_org3`, `peer0.bankb.sworna.example.com`, `peer0org3_tokenchaincode_ccaas`, `owner2` healthy
- [ ] CB host: `docker ps` shows NO bank peer/CA/chaincode containers
- [ ] Bank A: `peer channel list` (as Admin@banka) shows `settlement`
- [ ] Bank A VM: `curl http://<BANK-A-IP>:9200/api/v1/readyz` → ready
- [ ] CB issues SWR to a Bank A customer → balance appears on the bank portal
- [ ] Cross-bank transfer A → B commits and shows on both portals + auditor
- [ ] Redeem from Bank B works

When this checklist passes, promote the status at the top of this file.

## 5. Related docs

- [SETUP.md](../SETUP.md) — the dev-laptop testing runbook (validated)
- [DEPLOYMENT.md](../DEPLOYMENT.md) — roles, ports, progression
- [08-provisioning.md](08-provisioning.md) — wallet pools & the join bundle
- [05-engine-deep-dive.md](05-engine-deep-dive.md) — the Go engine's hostnames