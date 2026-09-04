# Token network — distributed deployment (N hosts)

> **Status: IMPLEMENTED — pending live validation.** Each bank self-provisions
> its own Fabric org on its own VM; the CB host owns only the central-bank org.
> The scripts below pass static validation; run §6 before go-live.

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

## 4. Deployment sequence with `sworna-cli`

All steps can be driven using `./bin/sworna` (or `pip install -e ./cli`).

1. **CB VM (Central Bank Stack):**
   ```bash
   ./bin/sworna cb init --provision
   #   -> Orderer + CB peer + settlement channel + CCaaS chaincode
   #   -> Token CA + issuer (:9100) + auditor (:9000)
   #   -> Backend (:8100) + Central Bank Web Portal (:5273)
   ```
2. **CB VM — Register Bank at runtime:**
   - Either via the Portal (`http://<CB-IP>:5273/banks`), or via CLI.
   - Central Bank mints the wallet pool and exports the join bundle.

3. **Bank `k` VM — Generate Local MSP & Identity:**
   ```bash
   ./bin/sworna bank init --code 00k --cb-host <CB-IP>
   #   -> Starts local Bank CA + peer
   #   -> Enrolls bank identity, generates keys locally
   #   -> Exports network/bank{k}-org.json
   ```

4. **CB VM — Onboard Bank (Channel Update):**
   - Submit `bank{k}-org.json` through the Central Bank Web Portal (`http://<CB-IP>:5273/onboarding`) or script.
   - Central Bank executes 4-Eyes approval to commit the channel delta admitting `Bank{k}MSP`.

5. **Bank `k` VM — Join Channel & Start Services:**
   ```bash
   ./bin/sworna bank start --code 00k --cb-host <CB-IP>
   #   -> Joins settlement channel, approves chaincode
   #   -> Launches CCaaS container and FSC Owner engine (:9200+100*(k-1))
   ```

6. **Automated Verification:**
   ```bash
   ./bin/sworna test e2e
   #   -> Verifies minting, interbank ZKP transfers, and ledger reconciliation
   ```

## 5. Join bundle (shrunk — no secrets leak)

`scripts/export-join-bundles.sh` exports `dist-bank-bundles/bank<CODE>.tar.gz`
containing ONLY:
- `token-services/keys/<owner_node>` — the bank's token identities (its fsc
  node identity + provisioned pool wallets), minted by the CB's token CA;
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