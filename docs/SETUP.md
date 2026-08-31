# Sworna CBDC — Setup & Operations Guide

> **Two-Tier CBDC on Hyperledger Fabric + Token-SDK**  
> Central Bank ↔ Commercial Banks ↔ Retail Customers  
> All token transfers are zero-knowledge (Idemix/ZKP), settled on the `settlement` channel.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Prerequisites](#2-prerequisites)
3. [Network Topology](#3-network-topology)
4. [Central Bank Deployment](#4-central-bank-deployment)
5. [Onboarding a Commercial Bank](#5-onboarding-a-commercial-bank)
6. [Deploying a Commercial Bank](#6-deploying-a-commercial-bank)
7. [Verification Checklist](#7-verification-checklist)
8. [Normal Operations](#8-normal-operations)
9. [Troubleshooting](#9-troubleshooting)
10. [Port Reference](#10-port-reference)

---

## 1. Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                       CENTRAL BANK VM                            │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────────────────┐ │
│  │   Orderer   │  │  CB Peer    │  │  Token Engine            │ │
│  │  :7050      │  │  :7051      │  │  Issuer FSC  :9100/9101  │ │
│  └─────────────┘  └─────────────┘  │  Auditor FSC :9000/9001  │ │
│  ┌─────────────────────────────┐   └──────────────────────────┘ │
│  │  Token CA   :27054          │   ┌──────────────────────────┐ │
│  │  Fabric CA  :7054           │   │  Backend API  :8000      │ │
│  └─────────────────────────────┘   │  CB Portal    :5173      │ │
│                                    └──────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
           ↕ Tailscale mesh (encrypted, private)
┌────────────────────────────────────────────────────────┐
│               BANK A VM  (Bank1MSP)                    │
│  ┌──────────────┐  ┌──────────────────────────────┐   │
│  │  Peer (B1)   │  │  Owner FSC (owner1)          │   │
│  │  :9051       │  │  REST  :9200  P2P :9201      │   │
│  └──────────────┘  └──────────────────────────────┘   │
│  ┌──────────────┐  ┌───────────────┐                  │
│  │  Bank CA     │  │  Backend API  │                  │
│  │  :8054       │  │  :8000        │                  │
│  └──────────────┘  └───────────────┘                  │
└────────────────────────────────────────────────────────┘
           ↕ Same Tailscale mesh
┌────────────────────────────────────────────────────────┐
│               BANK B VM  (Bank2MSP)                    │
│  ┌──────────────┐  ┌──────────────────────────────┐   │
│  │  Peer (B2)   │  │  Owner FSC (owner2)          │   │
│  │  :11051      │  │  REST  :9300  P2P :9301      │   │
│  └──────────────┘  └──────────────────────────────┘   │
│  ┌──────────────┐  ┌───────────────┐                  │
│  │  Bank CA     │  │  Backend API  │                  │
│  │  :9054       │  │  :8000        │                  │
│  └──────────────┘  └───────────────┘                  │
└────────────────────────────────────────────────────────┘
```

### Design Principles

- **CB manages banks only** — mints/burns wholesale SWR into bank reserve wallets; never touches retail accounts
- **Banks manage customers** — deposit from reserve, withdraw, facilitate P2P transfers
- **Zero-knowledge transfers** — Idemix (Token-SDK) hides token amounts/owners; auditor validates ZK proofs
- **Every transfer** is endorsed by the relevant peers, ordered by the CB orderer, committed to ledger

### Token Flow

```
CB --[mint]--> Bank Reserve Wallet (pool_00k_w1)
                    |
               [bank deposit]
                    |
               Customer Wallet (pool_00k_w2..w10)
                    |
          [P2P transfer — intra or inter-bank]
                    |
               Another Customer Wallet
```

---

## 2. Prerequisites

**All VMs:**
- Ubuntu 22.04+ LTS, 4+ GB RAM (8 GB for CB)
- Docker Engine ≥ 26, Compose v2 (`docker compose` — never `docker-compose`)
- Tailscale installed and joined to the same tailnet
- Git, Python 3.10+, Node.js 18+, `jq`

**Clone the repo (all VMs):**
```bash
git clone https://github.com/sapienskid/sworna-cbdc.git
cd sworna-cbdc
```

---

## 3. Network Topology

| Node | Tailscale IP | Role |
|------|-------------|------|
| `centralcbdc` | `100.72.112.29` | Central Bank — orderer, peer, token engine, backend |
| `bankpt` (Bank 001) | `100.111.120.73` | Commercial Bank A — peer, owner FSC, backend |
| `bankpp` (Bank 002) | `100.71.149.60` | Commercial Bank B — peer, owner FSC, backend |

### /etc/hosts (Central Bank VM)

```
127.0.0.1  localhost
127.0.0.1  orderer.sworna.example.com
127.0.0.1  peer0.centralbank.sworna.example.com
127.0.0.1  auditor.sworna.example.com
127.0.0.1  issuer.sworna.example.com
127.0.0.1  ca.centralbank.sworna.example.com

100.111.120.73  peer0.bank1.sworna.example.com  owner1.sworna.example.com
100.71.149.60   peer0.bank2.sworna.example.com  owner2.sworna.example.com
```

### /etc/hosts (Bank A VM — `bankpt`)

```
127.0.0.1  localhost
127.0.0.1  peer0.bank1.sworna.example.com  owner1.sworna.example.com

100.72.112.29  orderer.sworna.example.com
100.72.112.29  peer0.centralbank.sworna.example.com
100.72.112.29  auditor.sworna.example.com
100.72.112.29  issuer.sworna.example.com
100.71.149.60  peer0.bank2.sworna.example.com  owner2.sworna.example.com
```

### /etc/hosts (Bank B VM — `bankpp`)

```
127.0.0.1  localhost
127.0.0.1  peer0.bank2.sworna.example.com  owner2.sworna.example.com

100.72.112.29  orderer.sworna.example.com
100.72.112.29  peer0.centralbank.sworna.example.com
100.72.112.29  auditor.sworna.example.com
100.72.112.29  issuer.sworna.example.com
100.111.120.73  peer0.bank1.sworna.example.com  owner1.sworna.example.com
```

---

## 4. Central Bank Deployment

Run **once** on the CB VM:

```bash
cd ~/sworna-cbdc
./scripts/deploy-centralbank.sh --provision
```

This starts: orderer, CB peer, settlement channel, token CA, Issuer FSC, Auditor FSC, backend API, CB portal.

### After All Banks Are Onboarded

```bash
# Commit chaincode with all bank MSPs in the endorsement policy
./scripts/commit-chaincode.sh
```

### Refresh CB Network Overrides (After Each New Bank)

```bash
SWORNA_OWNERS="owner1 owner2" \
  SWORNA_OWNER_OWNER1_HOST=100.111.120.73 \
  SWORNA_OWNER_OWNER2_HOST=100.71.149.60 \
  python3 scripts/gen-net-overrides.py cb token-services/docker-compose.net.yaml

cd token-services
docker compose -f docker-compose.yaml -f docker-compose.net.yaml \
  up -d --force-recreate --no-deps issuer auditor
```

---

## 5. Onboarding a Commercial Bank

**Deploy order is critical:**

```
CB: deploy-centralbank.sh
       ↓
Bank: deploy-bank.sh <CODE>          ← generates bank-org.json
       ↓
CB: onboard-bank.sh BankNMSP <org.json>
       ↓                              ← needs ALL existing bank signatures
Bank: deploy-bank.sh <CODE>  (re-run) ← joins channel, installs CC, starts owner
       ↓
CB: commit-chaincode.sh              ← includes new bank in endorsement policy
```

### Run on CB After Receiving Bank's `bankN-org.json`

```bash
cd ~/sworna-cbdc

# Set ALL owner host vars before running
SWORNA_OWNERS="owner1 owner2" \
  SWORNA_OWNER_OWNER1_HOST=100.111.120.73 \
  SWORNA_OWNER_OWNER2_HOST=100.71.149.60 \
  ./scripts/onboard-bank.sh Bank2MSP network/bank2-org.json
```

> **Multi-org signing:** When there are already banks on the channel, `onboard-bank.sh` automatically collects co-signatures from existing bank peers via SSH before submitting to the orderer (Fabric Application/Admins = majority required).

### Export Join Bundles to Banks

```bash
./scripts/export-join-bundles.sh
# Produces: dist-bank-bundles/bank001.tar.gz, bank002.tar.gz, ...

scp dist-bank-bundles/bank002.tar.gz bankpp@100.71.149.60:~/sworna-cbdc/
```

### After All Banks Joined — Commit Chaincode

```bash
./scripts/commit-chaincode.sh
# Commits with OR('CentralBankMSP.peer','Bank1MSP.peer','Bank2MSP.peer')
```

---

## 6. Deploying a Commercial Bank

Run on the Bank VM after receiving the join bundle from CB:

```bash
cd ~/sworna-cbdc
tar xzf bank002.tar.gz   # extract Idemix wallet keys

export SWORNA_CB_HOST=100.72.112.29
export SWORNA_OWNERS="owner1 owner2"
export SWORNA_OWNER_OWNER1_HOST=100.111.120.73
export SWORNA_OWNER_OWNER2_HOST=100.71.149.60

./scripts/deploy-bank.sh 002
```

This performs in order:
1. Start bank CA
2. Enroll bank Fabric org identities (peer, admin, User1) — idempotent on re-run
3. Export `bank2-org.json` → send to CB for onboarding
4. Join `settlement` channel + fetch genesis block
5. Install + approve token chaincode (CCAAS)
6. Start Owner FSC node (owner2) in Docker
7. Start backend API + bank portal (Vite dev server)

### Start Bank Backend

```bash
cd ~/sworna-cbdc/backend
nohup .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000 \
  > /tmp/sworna-backend.log 2>&1 &
```

### Owner FSC also needs a peer cert from each sibling bank

If `token-services-owner-1` keeps restarting with `reading from file .../owner1/fsc/.../cert.pem failed`:

```bash
# On Bank B — copy owner1's public cert from CB
mkdir -p ~/sworna-cbdc/token-services/keys/owner1/fsc/msp/signcerts
scp sapiens@100.72.112.29:~/sworna-cbdc/token-services/keys/owner1/fsc/msp/signcerts/cert.pem \
    ~/sworna-cbdc/token-services/keys/owner1/fsc/msp/signcerts/cert.pem

docker restart token-services-owner-1
```

---

## 7. Verification Checklist

### ✅ CB Checks

```bash
# All containers up
docker ps --format '{{.Names}}\t{{.Status}}'
# Expected: orderer, peer0.centralbank, ca_token_network, token-services-{issuer,auditor}-1

# Chaincode committed with all banks
cd ~/sworna-cbdc
export PATH=$PATH:~/sworna-cbdc/bin
export FABRIC_CFG_PATH=~/sworna-cbdc/config
export CORE_PEER_TLS_ENABLED=true
export CORE_PEER_LOCALMSPID=CentralBankMSP
export CORE_PEER_ADDRESS=localhost:7051
export CORE_PEER_MSPCONFIGPATH=~/sworna-cbdc/network/organizations/peerOrganizations/centralbank.sworna.example.com/users/Admin@centralbank.sworna.example.com/msp
export CORE_PEER_TLS_ROOTCERT_FILE=~/sworna-cbdc/network/organizations/peerOrganizations/centralbank.sworna.example.com/peers/peer0.centralbank.sworna.example.com/tls/ca.crt
peer lifecycle chaincode querycommitted -C settlement -n tokenchaincode
# Expected: Version: 1, Sequence: N, Approvals: [Bank1MSP: true, Bank2MSP: true, CentralBankMSP: true]

# FSC health
curl -sf http://localhost:9100/healthz && echo "Issuer OK"
curl -sf http://localhost:9000/healthz && echo "Auditor OK"

# Backend
curl http://localhost:8000/api/v1/banks
```

### ✅ Bank Checks

```bash
# Owner FSC running (not restarting)
docker ps | grep owner
docker logs token-services-owner-1 2>&1 | grep "FSC node is ready"

# CCAAS container running
docker ps | grep tokenchaincode_ccaas

# Backend login
curl -s -X POST http://localhost:8000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"bankadmin","password":"sworna-bank"}' | python3 -m json.tool
```

### ✅ End-to-End Token Transfer

```bash
# 1. CB mints SWR to Bank A reserve
CB_TOKEN=$(curl -s -X POST http://100.72.112.29:8000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"cbadmin","password":"sworna-cb"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")

curl -s -X POST http://100.72.112.29:8000/api/v1/admin/mint \
  -H "Authorization: Bearer $CB_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"bank_code":"001","amount":"10000.00","reference":"Demo allocation"}' | python3 -m json.tool

# 2. Bank A deposits to customer Alice
BANK_TOKEN=$(curl -s -X POST http://100.111.120.73:8000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"bankadmin","password":"sworna-bank"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")

curl -s -X POST http://100.111.120.73:8000/api/v1/bank/deposit \
  -H "Authorization: Bearer $BANK_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"account_number":"SWR-001-00000001","amount":"1500.00","reference":"Initial deposit"}' | python3 -m json.tool

# 3. Alice P2P transfer to Bob
ALICE_TOKEN=$(curl -s -X POST http://100.111.120.73:8000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"alice","password":"alice123"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")

curl -s -X POST http://100.111.120.73:8000/api/v1/payments/transfer \
  -H "Authorization: Bearer $ALICE_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"from_account":"SWR-001-00000001","to_account":"SWR-001-00000002","amount":"250.00","reference":"Coffee"}' | python3 -m json.tool
```

---

## 8. Normal Operations

### Central Bank Portal (`http://100.72.112.29:5173`)

Login: `cbadmin` / `sworna-cb`

| Action | API | Notes |
|--------|-----|-------|
| Mint SWR to bank | `POST /api/v1/admin/mint` | Goes to bank's reserve wallet only |
| View banks | `GET /api/v1/banks` | All registered commercial banks |
| View ledger blocks | `GET /api/v1/ledger/blocks` | Settlement channel blocks |

### Bank Portal (`http://<BANK_IP>:5173`)

Login: `bankadmin` / `sworna-bank`

| Action | API | Notes |
|--------|-----|-------|
| Create customer account | `POST /api/v1/accounts` | Assigns wallet from pool |
| Deposit to customer | `POST /api/v1/bank/deposit` | Moves from reserve to customer wallet |
| View reserve balance | `GET /api/v1/bank/reserve` | Bank's own SWR holding |
| View all accounts | `GET /api/v1/accounts` | All customers at this bank |

### Customer Access (`http://<BANK_IP>:5173/login`)

| Action | API | Notes |
|--------|-----|-------|
| View balance | `GET /api/v1/accounts/{acct}` | Own wallet balance |
| Transfer | `POST /api/v1/payments/transfer` | Intra or inter-bank |
| View history | `GET /api/v1/payments/history` | Own transactions |

### Inter-Bank Transfer

Transfers between Bank A and Bank B are transparent to the customer — they just use the destination account number (e.g. `SWR-002-00000001`). The owner FSC node resolves the counterparty wallet and routes the token transfer through the auditor.

---

## 9. Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `failed obtaining auditor signature: timeout reached` | Owner FSC can't reach Auditor P2P port 9001 | Check `extra_hosts` in `docker-compose.bank.net.yaml`; verify `100.72.112.29:9001` is reachable from bank VM |
| `peer will not accept external chaincode connection` | CCAAS container has wrong `CHAINCODE_ID` | Get exact ID via `peer lifecycle chaincode queryinstalled`, restart CCAAS container with matching ID |
| `currently defined sequence N is larger than requested sequence 1` | Approving with wrong sequence number | Query committed sequence first: `peer lifecycle chaincode querycommitted -C settlement -n tokenchaincode` |
| `Identity X is already registered` | Re-running `registerEnroll-bank.sh` on same CA | Safe to ignore — `register` calls are now idempotent (`|| true`) |
| `communication service not ready` | FSC node bootstrapping (~20s) | **Do NOT restart.** Wait and retry. |
| `reading from file /var/fsc/keys/owner1/fsc/msp/signcerts/cert.pem failed` | Bank B missing sibling owner's public cert | Copy cert from CB: `scp sapiens@CB_IP:~/sworna-cbdc/token-services/keys/owner1/fsc/msp/signcerts/cert.pem ~/sworna-cbdc/token-services/keys/owner1/fsc/msp/signcerts/cert.pem` |
| `User1bankN.sworna.example.com/msp ... no such directory` | `@` missing in `core.yaml` path | `sed -i 's\|User1bank2\.sworna\.example\.com\|User1@bank2.sworna.example.com\|g' token-services/owner/conf/owner2/core.yaml` then restart owner |
| `policy for /Channel/Application not satisfied: 1 sub-policies satisfied, requires 2` | Channel update needs co-signatures from existing bank admins | `onboard-bank.sh` now auto-collects SSH co-signatures; ensure `SWORNA_OWNER_OWNER1_HOST` is set |
| `insufficient role` on transfer | Customer calling bank-staff-only endpoint | Fixed — `payments/transfer` now uses `deps.customer` role |
| `no free wallets` | Wallet pool exhausted | Increase `POOL_SIZE` env var and re-deploy owner FSC |
| `account not found` | Wrong account number or cross-bank mismatch | Verify with `GET /api/v1/accounts/{account_number}` |
| Blank `/etc/hosts` | Docker networking broken | Always keep `127.0.0.1 localhost` at top of `/etc/hosts` |
| OOM during build | Low RAM | Use `--no-cache` and build one service at a time |

### Log Locations

| Service | Log Location |
|---------|-------------|
| Backend (all VMs) | `/tmp/sworna-backend.log` |
| Portal (all VMs) | `/tmp/sworna-web.log` |
| Owner FSC | `docker logs token-services-owner-1` |
| Auditor FSC | `docker logs token-services-auditor-1` |
| Issuer FSC | `docker logs token-services-issuer-1` |
| Fabric Peer | `docker logs peer0.bank1.sworna.example.com` |
| Token Chaincode | `docker logs peer0bank1_tokenchaincode_ccaas` |

### Key Debug Commands

```bash
# Check owner FSC balance for a wallet
curl http://owner1.sworna.example.com:9200/api/v1/owner/accounts/pool_001_w1

# Check if Bank2MSP is in the channel
peer lifecycle chaincode querycommitted -C settlement -n tokenchaincode 2>&1 | grep Approv

# Verify CCAAS package ID matches committed
docker inspect peer0bank2_tokenchaincode_ccaas | python3 -c \
  "import sys,json; env=[e for e in json.load(sys.stdin)[0]['Config']['Env'] if 'CHAINCODE_ID' in e]; print(env)"

# Check cross-VM DNS from inside owner container
docker exec token-services-owner-1 cat /etc/hosts
docker exec token-services-owner-1 nc -zv auditor.sworna.example.com 9001 && echo "Auditor reachable"
```

---

## 10. Port Reference

| Service | Port | Protocol | VM |
|---------|------|----------|----|
| Fabric Orderer | 7050 | gRPC/TLS | CB |
| Fabric Peer CB | 7051 | gRPC/TLS | CB |
| Fabric Peer B1 | 9051 | gRPC/TLS | Bank A |
| Fabric Peer B2 | 11051 | gRPC/TLS | Bank B |
| Issuer FSC HTTP | 9100 | HTTP | CB |
| Issuer FSC P2P | 9101 | libp2p | CB |
| Auditor FSC HTTP | 9000 | HTTP | CB |
| Auditor FSC P2P | 9001 | libp2p | CB |
| Owner1 FSC HTTP | 9200 | HTTP | Bank A |
| Owner1 FSC P2P | 9201 | libp2p | Bank A |
| Owner2 FSC HTTP | 9300 | HTTP | Bank B |
| Owner2 FSC P2P | 9301 | libp2p | Bank B |
| Backend API | 8000 | HTTP | All |
| Web Portal | 5173 | HTTP | All |
| Token CA | 27054 | HTTPS | CB |
| Fabric CA (CB) | 7054 | HTTPS | CB |
| Fabric CA (B1) | 8054 | HTTPS | Bank A |
| Fabric CA (B2) | 9054 | HTTPS | Bank B |