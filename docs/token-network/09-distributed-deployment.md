# Token network — distributed deployment (N hosts)

> **Status: IMPLEMENTED — pending live validation.** Each bank self-provisions
> its own Fabric org on its own VM; the CB host owns only the central-bank org.
> The scripts below pass static validation; run §6 before the demo day.

## 1. Trust model (why it looks like this)

- The **CB host** is the network founder: it runs the orderer, creates the
  `settlement` channel with the central-bank org, and **adds** each bank's org
  via a channel config update. It also runs the token CA, issuer and auditor —
  so the CB mints all wallets and sees every transaction.
- Each **bank** runs its own Fabric CA and generates its own peer/admin
  identity **on its own VM**; only its public CA cert is shared with the CB.
  The bank never holds another org's keys, and the CB never holds the bank's
  Fabric private keys.

## 2. Host → role map (scales to N banks)

| Host | Runs | Ports (host) |
|---|---|---|
| Central bank VM | orderer · peer0.centralbank · ca_org1 · ca_orderer · ca_token_network · issuer · auditor · swagger-ui · backend · CB portal | 7050/7053, 7051, 7054, 9054, 27054, 9000, 9100, 8000, 5173 |
| Bank `k` VM | ca_bank{k} · peer0.bank{k} · chaincode (peer0bank{k}) · owner{k} · bank portal | 8054+1000(k−1), 9051+2000(k−1), 9200+100(k−1), 5173 |

Naming (numeric, friendly display names live in the DB):

| Bank index `k` | code | owner node | org | MSP | peer port | CA port | owner REST/P2P |
|---|---|---|---|---|---|---|---|
| 1 | 001 | owner1 | bank1.sworna.example.com | Bank1MSP | 9051 | 8054 | 9200 / 9201 |
| 2 | 002 | owner2 | bank2.sworna.example.com | Bank2MSP | 11051 | 9054 | 9300 / 9301 |
| 3 | 003 | owner3 | bank3.sworna.example.com | Bank3MSP | 13051 | 10054 | 9400 / 9401 |
| … | … | … | … | … | … | … | … |

## 3. Cross-host DNS

Containers cannot use the host's `/etc/hosts`. Compose `extra_hosts` files are
**generated** per deploy (`scripts/gen-net-overrides.py`):

- **Bank host:** the owner + peer containers resolve `orderer/auditor/issuer`
  → `SWORNA_CB_HOST`, and every other `owner{j}` → `SWORNA_OWNER_<J>_HOST`.
- **CB host:** the issuer/auditor containers resolve every `owner{k}` →
  `SWORNA_OWNER_<K>_HOST`.

Host-level `/etc/hosts` (for host-run CLI + the backend):

- **Every bank VM:** `orderer.sworna.example.com <CB-IP>` (the peer CLI needs it
  for fetch/join/approve).
- **CB host:** `owner{k}.sworna.example.com <bank-k-IP>` for every bank (the
  FastAPI backend reaches the owner REST services through it).
- **All hosts:** verify `localhost` resolves (a blank `/etc/hosts` breaks every
  Fabric CA call).

## 4. Deployment sequence (the whole story)

1. **CB VM:**
   ```bash
   ./scripts/deploy-centralbank.sh --provision
   #   -> org1 network + channel `settlement` + chaincode installed/approved for the CB
   #   -> token CA + issuer + auditor + backend + portal
   #   -> per-bank join bundles in dist-bank-bundles/ (token wallets + orderer public certs)
   ```
2. **Bank `k` VM:** install the Fabric tools, extract its bundle, run:
   ```bash
   export SWORNA_CB_HOST=<CB-IP>
   export SWORNA_OWNERS="owner1 owner2"              # all banks
   export SWORNA_OWNER_OWNER1_HOST=<bank1-IP> SWORNA_OWNER_OWNER2_HOST=<bank2-IP> ...
   ./scripts/deploy-bank.sh 00k
   #   -> starts its own CA + peer, enrolls its org, renders the owner conf,
   #      exports network/bank{k}-org.json, prints "send this to the CB"
   ```
3. **CB VM:** add the bank to the channel:
   ```bash
   ./scripts/onboard-bank.sh Bank{k}MSP bank{k}-org.json
   ```
4. **Bank `k` VM:** re-run `./scripts/deploy-bank.sh 00k` — it joins the
   channel, installs + approves the chaincode, runs its CCAAS container, starts
   the owner service and the portal.
5. **CB VM:** once all banks are on, commit the chaincode:
   ```bash
   ./scripts/commit-chaincode.sh        # OR policy over the CB + all banks
   ```

## 5. Join bundle (shrunk — no secrets leak)

`scripts/export-join-bundles.sh` exports `dist-bank-bundles/bank<CODE>.tar.gz`
containing ONLY:
- `token-services/keys/<owner_node>` — the bank's token wallets (its fsc
  identity + demo wallets + provisioned pool wallets), minted by the CB's token CA;
- the **public** orderer TLS CA cert + tlsca cert.

No bank Fabric keys, no CA data, no genesis block, no orderer private keys.

## 6. Validation checklist

- [ ] CB: `docker ps` shows orderer, `peer0.centralbank`, `ca_org1`, `ca_orderer`, token CA, issuer, auditor — and **no** bank containers
- [ ] Bank `k`: `docker ps` shows `ca_bank{k}`, `peer0.bank{k}...`, `peer0bank{k}_tokenchaincode_ccaas`, `owner` healthy
- [ ] `peer channel list` (Admin@bank{k}) shows `settlement`
- [ ] Bank `k` owner: `curl http://<bank-k-IP>:<owner-rest>/api/v1/readyz` → ready
- [ ] CB issues SWR to a Bank `k` customer → balance on the bank portal
- [ ] Cross-bank transfer A → B commits and shows on both portals + the auditor
- [ ] Redeem works

## 7. Related docs

- [SETUP.md](../SETUP.md) — the runbook (dev-laptop testing included)
- [DEPLOYMENT.md](../DEPLOYMENT.md) — roles, ports, progression
- [08-provisioning.md](08-provisioning.md) — wallet pools & the join bundle
- [05-engine-deep-dive.md](05-engine-deep-dive.md) — the Go engine's hostnames