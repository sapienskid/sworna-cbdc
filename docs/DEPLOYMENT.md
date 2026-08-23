# DEPLOYMENT — how Sworna is deployed

One repository; a machine's role is decided by **which script it runs** and
**which keys it holds**.

```
Central-bank host   orderer · peer0.centralbank · ca_org1 · ca_orderer · token CA · issuer/auditor · backend · CB portal
Bank A host         ca_org2 · peer0.banka · chaincode · owner1 · bank portal
Bank B host         ca_org3 · peer0.bankb · chaincode · owner2 · bank portal
Customer machines   a browser only (the bank portal)
```

> **Operational runbook:** [SETUP.md](SETUP.md) is the step-by-step, agent-runnable
> guide for standing up any host (preflight → clone → Fabric tools → deploy →
> verify). Read it before running the scripts below.

## 1. The one repo, roles by script

| Script | Runs on | Starts |
|---|---|---|
| `scripts/deploy-centralbank.sh --provision --distributed` | CB host | network + chaincode + **identity enrollment** + issuer/auditor + backend + CB portal; then **removes the bank peers/CAs/chaincode** and exports the join bundles |
| `scripts/deploy-banka.sh` | Bank A host | ca_org2 + peer0.banka + chaincode (joins `settlement`) + owner1 + bank A portal |
| `scripts/deploy-bankb.sh` | Bank B host | ca_org3 + peer0.bankb + chaincode (joins `settlement`) + owner2 + bank B portal |

Every host clones the same repo and installs the Fabric binaries/images into the
repo's own `bin/`/`config/` (`./scripts/install-fabric-tools.sh`). Each bank is
fully self-contained on its own VM: it receives a **join bundle** from the CB
(`scripts/export-join-bundles.sh` → `dist-bank-bundles/<bank>.tar.gz`) containing
the owner's idemix wallets, the org crypto (peer + admin + Fabric CA data), the
orderer TLS CA and the channel genesis block.

## 2. Provisioning (the CB is the trust anchor)

The CB generates each bank's idemix wallets from its UI or API:

```
POST /api/v1/admin/banks/{code}/provision     # generate wallet pool keys
PATCH /api/v1/banks/{code}/status             # registered -> active
```

The generated keys live under `token-services/keys/<owner_node>/` and are
copied to the bank VM (the join bundle). The bank then starts its owner service.
Provisioning is idempotent — re-run to top up a pool.

## 3. Fresh-clone gotchas (now handled)

- `token-services/keys/` is **gitignored** — a fresh clone has no identities.
  `deploy-centralbank.sh` now enrolls them automatically (runs
  `token-services/scripts/enroll-users.sh` once, guarded) before the engine starts.
- The deploy scripts require **Docker Compose v2** (`docker compose`).
- Backend paths derive from the repo location (`backend/app/paths.py`) — no
  hardcoded absolute paths, so any clone path works.

## 4. Bring-up sequence

**The deployment — distributed (3 VMs):**

```bash
# CB VM
./scripts/deploy-centralbank.sh --provision --distributed    # network + chaincode + engine + portal; then:
#   - removes the bank peers/CAs/chaincode from the CB host
#   - exports dist-bank-bundles/banka.tar.gz + bankb.tar.gz

# copy the bundles to each bank VM, extract under the repo root, then:
# Bank A VM
export SWORNA_CB_HOST=<CB-IP> SWORNA_BANKB_HOST=<BANK-B-IP>
./scripts/deploy-banka.sh
# Bank B VM
export SWORNA_CB_HOST=<CB-IP> SWORNA_BANKA_HOST=<BANK-A-IP>
./scripts/deploy-bankb.sh
```

**Dev-laptop testing only (NOT a deployment):** on a single dev laptop, run
`./scripts/deploy-centralbank.sh --provision` (no `--distributed`) to keep
everything local for testing, then run the owners locally:

```bash
cd token-services && docker compose -f docker-compose.bank.yaml up -d --build owner1 owner2
./scripts/demo.sh                             # issue -> transfers -> redeem
```

The demo's cross-bank flows need owner1/owner2 running somewhere (bank VMs in a
deployment, or locally for dev testing).

## 5. Distributed networking

Cross-host DNS is handled by compose `extra_hosts` derived from
`SWORNA_CB_HOST` / sibling bank IPs; peers and owners connect **out** to the CB
host. The full hostname map, the join-bundle contents and the validation
checklist live in
[docs/token-network/09-distributed-deployment.md](token-network/09-distributed-deployment.md)
(**implemented, pending live validation**).

## 6. Ports

| Port | Service | Host |
|---|---|---|
| 7050 · 7053 | orderer | CB |
| 7051 | peer0.centralbank | CB |
| 9051 / 11051 | peers (banka / bankb) | banka / bankb |
| 7054 · 9054 | ca_org1 · ca_orderer | CB |
| 8054 / 9054 | ca_org2 / ca_org3 | banka / bankb |
| 27054 | token CA | CB |
| 9000 · 9100 | auditor / issuer | CB |
| 9200 / 9300 | owner1 / owner2 | banka / bankb |
| 8000 | backend | CB |
| 5173 | portals (web dev) | each host |

Services bind `0.0.0.0`, so on lab VMs the portals/backend are reachable at
`http://<tailnet-ip>:<port>` from any laptop on the tailnet.

## 7. Progression

- **Dev (this repo, one laptop):** all-in-one is used **only for local testing**
  on a dev laptop (run `deploy-centralbank.sh` without `--distributed`). It is
  never a deployment — the CB and every bank are always separated onto their own
  hosts.
- **Lab demo (3 VMs):** the deployment — CB host + one VM per bank; each bank
  runs its own peer/CA/owner. Cross-host DNS is
  [09-distributed-deployment.md](token-network/09-distributed-deployment.md).
- **Comprehensive (up to 25 machines):** more orderers, CouchDB, monitoring,
  Ansible — Phase 4.

## 8. References

- Runbook: [SETUP.md](SETUP.md)
- Distributed validation: [docs/token-network/09-distributed-deployment.md](token-network/09-distributed-deployment.md)
- Provisioning model: [docs/token-network/08-provisioning.md](token-network/08-provisioning.md)
- Token network design: [docs/token-network/](token-network/)
- API: [docs/API.md](API.md)