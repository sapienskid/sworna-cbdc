# DEMO — Scenario & runbook

> **Status: v2 (banking).** Verified on the dev laptop 2026-08-22. Requires the
> token engine **including owner1/owner2** to be running (on the bank VMs in a
> deployment, or locally for dev testing). Setup: [SETUP.md](SETUP.md).

## Demo objective

A guided ~10-minute walkthrough of the two-tier banking system with ZK privacy:

1. **Central bank** onboards banks (keys + permissions) and issues SWR.
2. **Banks** (each with its own portal) onboard customers and send payments
   **by account number** — including cross-bank.
3. **Central bank redeems** SWR and monitors the ledger.

## Scenario script

| Step | Actor | Action | Evidence on screen |
|---|---|---|---|
| 1 | CB admin | Login to the CB portal; see all banks; provision a bank's keys | Banks table: "Generate keys" |
| 2 | CB admin | Issue SWR to a customer account | Dashboard supply + circulation update |
| 3 | Bank staff | Onboard a customer (account number assigned) | Accounts table grows |
| 4 | Bank staff | Send by account number to another bank (cross-bank) | Balances update after commit |
| 5 | Customer | Login in their bank portal; view balance + statements | Statements show account numbers |
| 6 | Bank staff | Freeze a customer; attempt a transfer → rejected | Risk controls |
| 7 | CB admin | Revoke a bank's redeem permission → redeem rejected | Permissions |

## Running it

**Deployment (3 VMs):** deploy the CB (`./scripts/deploy-centralbank.sh --provision
--distributed`) and each bank on its own VM (`deploy-banka.sh` / `deploy-bankb.sh`).
Then run `./scripts/demo.sh` from the CB host (it talks to the backend on localhost).

**Dev-laptop testing only:** everything on a single dev laptop —

```bash
./scripts/deploy-centralbank.sh --provision   # network, chaincode, identities, issuer/auditor, backend, portal
cd token-services && docker compose -f docker-compose.bank.yaml up -d --build owner1 owner2   # owners needed for transfers/redeem
./scripts/demo.sh                             # issue → transfers → redeem
```

> Without owner1/owner2 the demo cannot run — the CB-only deployment supports
> provisioning and issuance setup, not retail transfers.

Portals (dev): `http://localhost:5173` with the path/route per portal —
logins below. For the production-built 3-portal mode use
`scripts/run-portals.sh` (ports 8081/8082/8083).

## Accounts & logins

| Account | Wallet | Owner |
|---|---|---|
| `SWR-001-00000001` (Alice Adhikari) | `alice` | owner1 (bank 001) |
| `SWR-001-00000002` (Bob Basnet) | `bob` | owner1 (bank 001) |
| `SWR-002-00000001` (Carlos Chhetri) | `carlos` | owner2 (bank 002) |
| `SWR-002-00000002` (Dan Dhakal) | `dan` | owner2 (bank 002) |

Logins: CB `cbadmin`/`sworna-cb` · bank staff `banka_admin`/`bankb_admin`/
`sworna-bank` · customers `alice`/`bob`/`carlos`/`dan`/`sworna-pass`.

## Port map

| Port | Service |
|---|---|
| 7050 / 7053 | orderer |
| 7051 / 9051 / 11051 | peers (centralbank / banka / bankb) |
| 7054 / 8054 / 9054 | Fabric CAs |
| 27054 | token CA |
| 9000 / 9100 / 9200 / 9300 | auditor / issuer / owner1 / owner2 |
| 8000 | FastAPI backend (`/docs`) |
| 5173 | portals (dev) |

## Troubleshooting

- **`communication service not ready`** — FSC nodes need ~20 s to join the
  bootstrap (auditor) after restart; wait and retry.
- **`no free wallets; provision more`** — run `POST /admin/banks/{code}/provision`
  from the CB portal to top up the bank's wallet pool.
- **Engine keeps restarting on a fresh clone** — identities not enrolled. Run
  `./scripts/deploy-centralbank.sh` again (enrolls automatically) or
  `token-services/scripts/enroll-users.sh` once the token CA is up.
- **Account not found** — account numbers look like `SWR-001-00000001` (bank
  code + 8 digits); paste exactly.
- Full reset: `./network/network.sh down`, remove `token-services/{keys,data}`,
  remove `backend/sworna.db`, re-run `deploy-centralbank.sh --provision`.