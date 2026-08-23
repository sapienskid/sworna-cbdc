# DEPLOYMENT — how Sworna is deployed

One repository; a machine's role is decided by **which script it runs** and
**which keys it holds**. The deployment is **distributed**: the central bank and
every commercial bank run on their own hosts, and any number of banks are
supported.

```
Central-bank host   orderer · peer0.centralbank · ca_org1 · ca_orderer · token CA · issuer/auditor · backend · CB portal
Bank k host         ca_bank{k} · peer0.bank{k} · chaincode · owner{k} · bank portal
Customer machines   a browser only (the bank portal)
```

> **Operational runbook:** [SETUP.md](SETUP.md) is the step-by-step,
> agent-runnable guide. Read it before running the scripts below.

## 1. Roles by script

| Script | Runs on | Starts |
|---|---|---|
| `scripts/deploy-centralbank.sh --provision` | CB host | org1 network + channel `settlement` + chaincode (approved, not committed) + identity enrollment + issuer/auditor + backend + portal + join bundles |
| `scripts/onboard-bank.sh <MSP> <org-json>` | CB host | adds a bank's org to `settlement` (channel config update) |
| `scripts/commit-chaincode.sh` | CB host | commits the chaincode with an OR endorsement policy over the CB + all banks |
| `scripts/deploy-bank.sh <CODE>` | each bank host | the bank's own CA + peer + chaincode + owner + portal |
| `scripts/bank-network.sh up\|identity\|join\|down` | each bank host | low-level bank peer bring-up, org enrollment, channel join |
| `scripts/export-join-bundles.sh` | CB host | exports `dist-bank-bundles/bank<CODE>.tar.gz` (token wallets + orderer public certs) |

## 2. Trust model

- The **CB is the network founder**: it runs the orderer, creates `settlement`
  with the central-bank org, and adds each bank's org via a channel config
  update. It also runs the **token CA** (idemix issuer — all wallets come from
  it), the **issuer** (mint/burn) and the **auditor** (approves + sees every
  transaction).
- Each **bank self-provisions its Fabric org** (peer + admin) against its **own
  Fabric CA** on its own VM. Only its public CA cert is shared with the CB. The
  CB never holds a bank's Fabric private keys, and a bank never holds another
  org's keys.
- The join bundle carries only the bank's **token wallets** (minted by the CB's
  token CA) + public orderer TLS certs — never bank Fabric keys or orderer
  private keys.

## 3. Fresh-clone gotchas (now handled)

- `token-services/keys/` and `network/organizations/` are gitignored — the CB
  deploy enrolls identities automatically; banks self-provision their Fabric org.
- Deploy scripts require **Docker Compose v2** (`docker compose`).
- Backend paths derive from the repo location (`backend/app/paths.py`); owner
  REST URLs derive from the owner node name (`app/owner_urls.py`) and resolve
  on the CB host via `/etc/hosts`.

## 4. Deployment sequence

```bash
# CB VM
./scripts/deploy-centralbank.sh --provision
#   -> org1 network + chaincode approved + engine + portal (registry starts empty)

# CB VM — register a bank at runtime (while everything is up)
curl -X POST http://localhost:8000/api/v1/banks -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"code":"001","name":"my bank","msp_id":"Bank1MSP","owner_node":"owner1","staff_username":"mybank_admin"}'
./scripts/export-join-bundles.sh        # -> dist-bank-bundles/bank001.tar.gz

# Bank k VM (after extracting its bundle)
export SWORNA_CB_HOST=<CB-IP> SWORNA_OWNERS="owner1 ..." SWORNA_OWNER_OWNER1_HOST=<bank1-IP> ...
./scripts/deploy-bank.sh 001            # identity phase -> bank1-org.json

# CB VM — add the bank to the channel (live, no downtime)
./scripts/onboard-bank.sh Bank1MSP bank1-org.json

# Bank k VM — re-run to join + start
./scripts/deploy-bank.sh 001

# CB VM — update the endorsement policy (after each new bank)
./scripts/commit-chaincode.sh
```

## 5. Ports

| Port | Service | Host |
|---|---|---|
| 7050 · 7053 | orderer | CB |
| 7051 | peer0.centralbank | CB |
| 9051+2000(k−1) | peer0.bank{k} | bank k |
| 7054 · 9054 | ca_org1 · ca_orderer | CB |
| 8054+1000(k−1) | ca_bank{k} | bank k |
| 27054 | token CA | CB |
| 9000 · 9100 | auditor / issuer | CB |
| 9200+100(k−1) | owner{k} REST | bank k |
| 9201+100(k−1) | owner{k} P2P | bank k |
| 8000 | backend | CB |
| 5173 | portals (web dev) | each host |

Services bind `0.0.0.0`, reachable at `http://<tailnet-ip>:<port>`.

## 6. Progression

- **Dev (this repo, one laptop):** all-in-one is **testing only**, never a
  deployment — the CB and every bank are always separated onto their own hosts.
- **Lab demo (N VMs):** the flow in §4; cross-host DNS via generated
  `extra_hosts` + `/etc/hosts` — see
  [docs/token-network/09-distributed-deployment.md](token-network/09-distributed-deployment.md).
- **Comprehensive (up to 25 machines):** more orderers, CouchDB, monitoring,
  Ansible — Phase 4.

## 7. References

- Runbook: [SETUP.md](SETUP.md)
- Distributed validation: [docs/token-network/09-distributed-deployment.md](token-network/09-distributed-deployment.md)
- Provisioning model: [docs/token-network/08-provisioning.md](token-network/08-provisioning.md)
- Token network design: [docs/token-network/](token-network/)
- API: [docs/API.md](API.md)