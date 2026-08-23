# SETUP — step-by-step host bring-up

> **Status: v3 — distributed N-bank.** This is the authoritative runbook for
> standing up the Sworna system: one central-bank host + any number of
> commercial-bank hosts, each on its own VM. Written so a human **or an AI
> agent** can execute it verbatim; agent guidance is in §10.

One repository; a machine's role is decided by **which script it runs** and
**which keys it holds**. The deployment is **always distributed** — the CB and
every bank are separated onto their own hosts, and the registry starts empty:
banks are created and onboarded at runtime while the network stays up.

| Host | Script | Runs |
|---|---|---|
| Central bank | `scripts/deploy-centralbank.sh --provision` | orderer · peer0.centralbank · ca_org1 · ca_orderer · token CA · issuer/auditor · backend · CB portal |
| Bank `k` | `scripts/deploy-bank.sh 00k` | ca_bank{k} · peer0.bank{k} · chaincode · owner{k} · bank portal |

Bank naming is numeric: code `001`→`owner1`/`bank1`/`Bank1MSP`, `002`→`owner2`/
`bank2`/`Bank2MSP`, … (friendly display names are free-form strings stored in the
banking registry). Ports per bank `k`: peer `9051+2000(k−1)`, CA
`8054+1000(k−1)`, owner REST/P2P `9200+100(k−1)` / `9201+100(k−1)`.

> **Before you start — do not skip.** `token-services/keys/` and the org crypto
> under `network/organizations/` are **gitignored**; a fresh clone has no
> identities. The CB deploy enrolls the CB's own identities automatically. Banks
> receive their **token wallets** (minted by the CB's token CA) via a *join
> bundle* (`scripts/export-join-bundles.sh`), but **generate their own Fabric org
> identity** on their own VM.

---

## 1. Preflight (all hosts)

### 1.1 OS packages

```bash
sudo apt update && sudo apt install -y \
  git curl jq python3 python3-venv python3-pip tar \
  ca-certificates gnupg lsb-release
```

### 1.2 Docker + compose (v2 plugin required)

```bash
docker --version
docker compose version          # must print "Docker Compose version v2..."
sudo usermod -aG docker "$USER" # re-login (or newgrp docker) after this
docker run --rm hello-world     # sanity check
```

> Do not install the old `docker-compose` v1 binary.

### 1.3 Node.js ≥ 18 (for the portal)

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v    # >= 18
```

### 1.4 Time sync

```bash
sudo timedatectl set-ntp true
timedatectl status   # "System clock synchronized: yes"
```

### 1.5 `/etc/hosts` (required — a blank one breaks every Fabric CA call)

```bash
grep -q "localhost" /etc/hosts || sudo bash -c 'echo "127.0.0.1 localhost
::1 localhost ip6-localhost ip6-loopback" >> /etc/hosts'
```

### 1.6 Swap (recommended for 8 GB hosts)

```bash
sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

### 1.7 Reachability (lab VMs over Tailscale)

```bash
ping 100.72.112.29              # CB VM example
ssh sapiens@100.72.112.29
```

---

## 2. Get the code + Fabric tools (all hosts)

```bash
git clone https://github.com/sapienskid/sworna-cbdc.git ~/CBDC
cd ~/CBDC
./scripts/install-fabric-tools.sh     # Fabric 3.1.5 + CA 1.5.22 binaries/images
bin/fabric-ca-client version          # verify
```

---

## 3. Central-bank host bring-up

Run on the CB VM:

```bash
cd ~/CBDC
./scripts/deploy-centralbank.sh --provision
```

The script does:

| Step | What happens |
|---|---|
| 1/4 | Fabric network: **central-bank org only** — orderer + peer0.centralbank + CAs, channel `settlement` |
| 2/4 | Token chaincode **installed + approved** for the CB org (not committed yet) |
| 3/4 | Token CA up → **enroll identities** (auto, one-time) → issuer + auditor |
| 4/4 | Banking backend (:8000) + CB portal (:5173) + export join bundles |

> `--provision` mints each registered bank's wallet pool (idempotent; also
> runnable from the CB portal "Generate keys").

### 3.1 First-run identity enrollment (automatic)

`token-services/scripts/enroll-users.sh` enrolls the CB's own identities only:
the issuer + auditor FSC node identities and their wallets. Bank owners are
enrolled later, per bank, by provisioning. Guarded — safe to re-run.

> The registry starts **empty** — no banks exist until you create them (§4.1).
> There are no demo banks or demo accounts in a production deployment.

### 3.2 Wait conditions

- The engine nodes join the FSC bootstrap in ~20 s; `communication service not
  ready` means **wait and retry**, never restart.
- If `--provision` ran before the backend was ready, provision later from the
  portal (idempotent).

### 3.3 Verify the CB host

```bash
docker ps --format 'table {{.Names}}\t{{.Status}}'
curl -s http://localhost:8000/healthz          # {"status":"ok"}
curl -s http://localhost:9000/api/v1/readyz    # auditor ready
```

Expected: orderer, `peer0.centralbank`, `ca_org1`, `ca_orderer`,
`ca_token_network`, `issuer`, `auditor`, `swagger-ui`. **No bank containers.**

From your laptop over Tailscale: `http://<CB-IP>:5173` (CB portal,
`cbadmin`/`sworna-cb`), `:8000/docs` (backend), `:8080` (engine swagger).
Check the CB portal **Ledger** page shows `settlement` with blocks.

---

## 4. Onboarding a bank (live — the network keeps running)

Every step below happens while the central bank is up; nothing restarts the
orderer, the ledger, or any existing bank.

### 4.1 Create the bank in the registry

From the CB portal (Banks → new) or `POST /api/v1/banks` with `code`, `name`,
`msp_id` (e.g. `Bank3MSP`), `owner_node` (e.g. `owner3`) and optionally
`staff_username` (creates that bank's staff console login).

### 4.2 Provision + export

```bash
curl -X POST http://localhost:8000/api/v1/admin/banks/<CODE>/provision \
  -H "Authorization: Bearer $TOKEN"     # mints the owner identity + wallet pool
./scripts/export-join-bundles.sh        # dist-bank-bundles/bank<CODE>.tar.gz
```

### 4.3 Bank `k` VM — provision its Fabric identity

Extract the bank's join bundle under the repo root, then:

```bash
ls ~/CBDC/token-services/keys/owner${k}        # token wallets from the bundle
export SWORNA_CB_HOST=<CB-IP>
export SWORNA_OWNERS="owner1 owner2 ..."       # ALL owner nodes
export SWORNA_OWNER_OWNER1_HOST=<bank1-IP> ... # every bank VM IP
cd ~/CBDC && ./scripts/deploy-bank.sh 00k
```

This starts the bank's **own CA + peer**, enrolls the bank's org identity
(private keys stay on this VM), renders the owner conf and exports its **public**
org MSP JSON to `network/bank{k}-org.json`.

### 4.4 CB — add the bank to the channel (live)

```bash
cd ~/CBDC
./scripts/onboard-bank.sh Bank{k}MSP <path-to-bank{k}-org.json>
```

Admits the org via a channel config update, refreshes the CB engine's owner
resolvers + DNS, and rolling-recreates issuer/auditor (~10–20 s). The ledger,
peers and existing banks are unaffected throughout.

### 4.5 Bank `k` VM — join + start

Re-run `./scripts/deploy-bank.sh 00k` — it fetches the genesis block from the
orderer, joins `settlement`, installs + approves the chaincode, runs the bank's
chaincode container, starts the owner service and the portal.

### 4.6 CB — update the endorsement policy

```bash
cd ~/CBDC && ./scripts/commit-chaincode.sh
```

Upgrade-aware: it bumps the sequence and re-commits with
`OR(CentralBankMSP, Bank1MSP, ..., BankNMSP)`. Run it after each new bank is
onboarded so the new bank can endorse its customers' transactions.

---

## 5. Join bundles

`deploy-centralbank.sh` (and `scripts/export-join-bundles.sh`) exports
`dist-bank-bundles/bank<CODE>.tar.gz` per registered bank. Each contains ONLY:

- `token-services/keys/<owner_node>` — the bank's token identities (its fsc
  node identity + provisioned pool wallets), minted by the CB's token CA;
- the **public** orderer TLS CA cert + tlsca cert.

No bank Fabric keys, no CA data, no genesis block, no orderer private keys.

```bash
scp dist-bank-bundles/bank001.tar.gz sapiens@<BANK-IP>:~/CBDC/
# on the bank VM: cd ~/CBDC && tar xzf bank001.tar.gz
```

---

## 6. DNS across hosts

Containers cannot read the host's `/etc/hosts`; compose `extra_hosts` are
**generated** per deploy by `scripts/gen-net-overrides.py` from
`SWORNA_CB_HOST` and `SWORNA_OWNER_<NAME>_HOST`. Additionally:

- **Every bank VM** `/etc/hosts`: `orderer.sworna.example.com <CB-IP>`
- **CB host** `/etc/hosts`: `owner{k}.sworna.example.com <bank-k-IP>` for every
  bank (the backend reaches owner REST services through it)

---

## 7. Verification checklists

### 7.1 Central-bank host

- [ ] `docker ps`: orderer, peer0.centralbank, ca_org1, ca_orderer, token CA, issuer, auditor healthy — no bank containers
- [ ] `curl :8000/healthz` → `{"status":"ok"}`
- [ ] CB portal `:5173` logs in (`cbadmin` / `sworna-cb`); Ledger shows `settlement`
- [ ] Banks show pool manifests (provisioned); `dist-bank-bundles/` has the bundles

### 7.2 Bank `k` host

- [ ] `docker ps`: `ca_bank{k}`, `peer0.bank{k}...`, `peer0bank{k}_tokenchaincode_ccaas`, `owner` healthy
- [ ] `peer channel list` shows `settlement`
- [ ] Owner API up: `curl http://localhost:9200/api/v1/readyz`
- [ ] Bank portal `:5173/b/<CODE>` logs in (staff / `sworna-bank`)

### 7.3 End-to-end (once banks are up)

Exercise the money flow through the APIs (from the CB host):

```bash
# issue SWR to a customer account of an onboarded bank
curl -X POST http://localhost:8000/api/v1/admin/issue \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"to_account":"SWR-003-00000001","amount":"100.00","reference":"first issue"}'
```

Then from the portals: the customer pays another customer (same bank), across
banks, and the CB redeems — balances update after each commit, and every
transaction is visible (commitments only) to the auditor.

---

## 8. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `communication service not ready` | FSC nodes need ~20 s to join the auditor bootstrap. Wait and retry. |
| `no free wallets; provision more` | Pool exhausted. `POST /admin/banks/{code}/provision` (portal "Generate keys"). |
| Engine containers restart | Missing identities. Ensure `token-services/keys/issuer/fsc` exists; re-run `deploy-centralbank.sh` (enroll step is idempotent). |
| `fabric-ca-client failed` during provisioning | `bin/` not installed or token CA not up. `./scripts/install-fabric-tools.sh`; `docker ps` for `ca_token_network`. |
| Bank `deploy-bank.sh` prints "not onboarded" | Run `./scripts/onboard-bank.sh Bank{k}MSP bank{k}-org.json` on the CB, then re-run. |
| Bank peer won't start | `SWORNA_CB_HOST` not set (peer compose requires it). Re-export and re-run. |
| Bank owner can't reach the CB | `SWORNA_CB_HOST` / `SWORNA_OWNER_<NAME>_HOST` missing; regenerate the net override and re-run. |
| Backend can't reach an owner (balance/overview 500) | CB `/etc/hosts` missing `owner{k}.sworna.example.com <bank-IP>`. |
| `localhost` doesn't resolve | Blank `/etc/hosts` (§1.5). |
| OOM during `docker compose up --build` | Add swap (§1.6). |

Logs: `/tmp/sworna-backend.log`, `/tmp/sworna-web.log`, `docker logs <container>`.

---

## 9. Full reset

```bash
cd ~/CBDC
./network/network.sh down
rm -rf token-services/{keys,data} backend/sworna.db dist-bank-bundles
# re-run: ./scripts/deploy-centralbank.sh --provision
```

---

## 10. For AI agents

- **Idempotency:** scripts and provisioning calls may be re-run safely; enroll
  and pool-provisioning only create what is missing.
- **Detection:** success = §7 checks; failure = exit non-zero, a container in
  `Restarting`, or a curl timeout. Read `/tmp/sworna-*.log` + `docker logs`.
- **Do not restart on `communication service not ready`** — wait ~20 s.
- **Fresh clones have no identities:** the CB enrolls its own automatically;
  never start the engine before `token-services/keys/issuer/fsc` exists.
- **Paths:** derived from the repo location (`backend/app/paths.py`); do not
  export `SWORNA_BIN`/`SWORNA_NETWORK_HOME` unless overriding deliberately.
- **Banks self-provision their Fabric org** (keys never leave their VM); the CB
  mints their **token wallets** (token CA is the idemix issuer — inherent).
- **Bank deploy needs IPs:** `SWORNA_CB_HOST` + `SWORNA_OWNER_<NAME>_HOST`;
  the generated `extra_hosts` + `/etc/hosts` are the cross-host DNS.
- **Deploy order:** CB → bank identity → `onboard-bank.sh` → bank join →
  `commit-chaincode.sh`.