# Sworna CBDC — Setup & Operations Guide

> **Two-Tier CBDC Architecture:** Central Bank (CB) ↔ Commercial Banks ↔ Retail Customers  
> All token transfers are zero-knowledge (Idemix/ZKP), audited on Hyperledger Fabric, settled on a private blockchain.

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

---

## 1. Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                       CENTRAL BANK VM                            │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────────────────┐ │
│  │   Orderer   │  │  Peer (CB)  │  │  Token Engine            │ │
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
│                  BANK A VM  (Bank1MSP)                 │
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
│                  BANK B VM  (Bank2MSP)                 │
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

### Token Flow

```
CB mints SWR → Bank Reserve Wallet (pool_00k_w1)
                    ↓ bank deposit (zero-knowledge token transfer)
                Customer Wallet (pool_00k_w2..w10)
                    ↓ P2P transfer (intra or inter-bank)
                Another Customer Wallet
```

Every token transfer is:
1. **Audited** by the CB Auditor FSC node (ZK proof validated)
2. **Endorsed** by the relevant Fabric peer(s)
3. **Ordered** by the CB Orderer and **committed** to the `settlement` channel

---

## 2. Prerequisites

**All VMs:**
- Ubuntu 22.04 / 24.04 LTS
- Docker Engine ≥ 26, Docker Compose v2 (`docker compose`, never `docker-compose`)
- Tailscale installed and connected to the same tailnet
- Git, Python 3.10+, Node.js 18+

**Central Bank VM only:**
- At least 8 GB RAM (Fabric peer + orderer + 2 FSC nodes + token chaincode + CA + backend)

**Bank VMs:**
- At least 4 GB RAM

### Clone the repo (all VMs)

```bash
git clone https://github.com/<org>/sworna-cbdc.git
cd sworna-cbdc
```

---

## 3. Network Topology

| Node | Tailscale IP | Role |
|------|-------------|------|
| `centralcbdc` | `100.72.112.29` | Central Bank — orderer, peer, token engine, backend |
| `bankpt` (Bank 1) | `100.111.120.73` | Commercial Bank A — peer, owner FSC, backend |
| `bankpp` (Bank 2) | `100.71.149.60` | Commercial Bank B — peer, owner FSC, backend |

### /etc/hosts (Central Bank VM)

```
127.0.0.1 orderer.sworna.example.com peer0.centralbank.sworna.example.com
127.0.0.1 auditor.sworna.example.com issuer.sworna.example.com

# Commercial Banks (update IPs as banks join)
100.111.120.73 peer0.bank1.sworna.example.com owner1.sworna.example.com
100.71.149.60  peer0.bank2.sworna.example.com owner2.sworna.example.com
```

### /etc/hosts (Bank A VM)

```
127.0.0.1 peer0.bank1.sworna.example.com owner1.sworna.example.com

100.72.112.29 orderer.sworna.example.com peer0.centralbank.sworna.example.com
100.72.112.29 auditor.sworna.example.com issuer.sworna.example.com
100.71.149.60 peer0.bank2.sworna.example.com owner2.sworna.example.com
```

### /etc/hosts (Bank B VM)

```
127.0.0.1 peer0.bank2.sworna.example.com owner2.sworna.example.com

100.72.112.29 orderer.sworna.example.com peer0.centralbank.sworna.example.com
100.72.112.29 auditor.sworna.example.com issuer.sworna.example.com
100.111.120.73 peer0.bank1.sworna.example.com owner1.sworna.example.com
```

---

## 4. Central Bank Deployment

Run **once** on the CB VM:

```bash
cd ~/sworna-cbdc
./scripts/deploy-centralbank.sh --provision
```

This performs:
1. Starts Fabric network (orderer + CB peer + settlement channel)
2. Installs and approves token chaincode (CCAAS)
3. Starts token CA, enrolls issuer + auditor identities
4. Starts Issuer FSC + Auditor FSC (Docker Compose)
5. Starts backend API + CB portal

### After Banks Are Onboarded

```bash
./scripts/commit-chaincode.sh   # commit with all bank endorsements
```

### Update CB network overrides (when a bank is added)

```bash
SWORNA_OWNERS="owner1 owner2" \
  SWORNA_OWNER_OWNER1_HOST=100.111.120.73 \
  SWORNA_OWNER_OWNER2_HOST=100.71.149.60 \
  python3 scripts/gen-net-overrides.py cb token-services/docker-compose.net.yaml

docker compose -f token-services/docker-compose.yaml \
               -f token-services/docker-compose.net.yaml \
               up -d --force-recreate auditor issuer
```

---

## 5. Onboarding a Commercial Bank

Run **on the CB VM** after the bank sends its `bankN-org.json`:

```bash
cd ~/sworna-cbdc
./scripts/onboard-bank.sh Bank1MSP network/bank1-org.json
# or for Bank 2:
./scripts/onboard-bank.sh Bank2MSP network/bank2-org.json
```

Then export bundles for the bank:

```bash
./scripts/export-join-bundles.sh
# delivers dist-bank-bundles/bank001.tar.gz, dist-bank-bundles/bank002.tar.gz
scp dist-bank-bundles/bank002.tar.gz bankpp@100.71.149.60:~/sworna-cbdc/
```

---

## 6. Deploying a Commercial Bank

Run **on the Bank VM** after receiving the join bundle from the CB:

```bash
cd ~/sworna-cbdc
tar -xzf bank002.tar.gz   # extract issuer keys + wallet pool

# Set environment
export SWORNA_CB_HOST=100.72.112.29
export SWORNA_OWNERS="owner1 owner2"
export SWORNA_OWNER_OWNER1_HOST=100.111.120.73
export SWORNA_OWNER_OWNER2_HOST=100.71.149.60

./scripts/deploy-bank.sh 002
```

This performs:
1. Starts bank CA
2. Enrolls bank Fabric org identities (peer, admin, user1)
3. Exports `bank2-org.json` → send to CB for onboarding
4. Bank peer joins `settlement` channel
5. Installs and approves token chaincode (CCAAS)
6. Starts Owner FSC node (owner2)
7. Starts backend API + bank portal

### Deploy Order (Critical)

```
CB deploy-centralbank.sh
    ↓
Bank: deploy-bank.sh <CODE>  (generates bank-org.json)
    ↓
CB: onboard-bank.sh BankNMSP bank-org.json  (adds bank to channel)
    ↓
Bank: deploy-bank.sh <CODE>  (re-run to join channel + install CC)
    ↓
CB: commit-chaincode.sh  (after all banks are onboarded)
```

### Seed the Bank Backend DB

```bash
cd ~/sworna-cbdc/backend
PYTHONPATH=. .venv/bin/python3 -c "
from app.seed import seed_bank_db
seed_bank_db(bank_code='002', bank_name='bankpp', owner_node='owner2')
"
```

Start the backend:

```bash
nohup .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000 \
  --app-dir ~/sworna-cbdc/backend > /tmp/sworna-backend.log 2>&1 &
```

---

## 7. Verification Checklist

### ✅ CB Verified Working

```bash
# Check all containers up
docker ps | grep -E 'orderer|peer0\.(centralbank|bank)|auditor|issuer|ca_token'

# Check chaincode committed
FABRIC_CFG_PATH=~/sworna-cbdc/config \
CORE_PEER_TLS_ENABLED=true \
CORE_PEER_LOCALMSPID=CentralBankMSP \
CORE_PEER_ADDRESS=localhost:7051 \
CORE_PEER_TLS_ROOTCERT_FILE=~/sworna-cbdc/network/organizations/peerOrganizations/centralbank.sworna.example.com/peers/peer0.centralbank.sworna.example.com/tls/ca.crt \
CORE_PEER_MSPCONFIGPATH=~/sworna-cbdc/network/organizations/peerOrganizations/centralbank.sworna.example.com/users/Admin@centralbank.sworna.example.com/msp \
~/sworna-cbdc/bin/peer lifecycle chaincode querycommitted -C settlement -n tokenchaincode
# Expected: Version: 1, Sequence: N, Approvals: [Bank1MSP: true, Bank2MSP: true, CentralBankMSP: true]

# Check issuer FSC health
curl -sf http://localhost:9100/healthz && echo OK

# Check auditor FSC health
curl -sf http://localhost:9000/healthz && echo OK

# Check backend API
curl http://localhost:8000/api/v1/banks
```

### ✅ Bank Verified Working

```bash
# Chaincode responds on bank peer
curl -sf http://localhost:9200/api/v1/owner/accounts/pool_001_w1
# Expected: {"message":"got balances for pool_001_w1","payload":{"balance":[...]}}

# Backend login
curl -s -X POST http://localhost:8000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"bankadmin","password":"sworna-bank"}' | jq .token
```

### ✅ End-to-End Token Transfer Test

```bash
# Mint to Bank A reserve (from CB VM)
curl -s -X POST http://localhost:8000/api/v1/admin/mint \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <CB_ADMIN_TOKEN>' \
  -d '{"bank_code":"001","amount":"10000.00","reference":"Initial allocation"}'

# Deposit to Alice (from Bank A VM backend)
curl -s -X POST http://localhost:8000/api/v1/bank/deposit \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <BANK_ADMIN_TOKEN>' \
  -d '{"account_number":"SWR-001-00000001","amount":"1500.00","reference":"Initial deposit"}'

# Alice transfers to Bob
curl -s -X POST http://localhost:8000/api/v1/payments/transfer \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <ALICE_TOKEN>' \
  -d '{"from_account":"SWR-001-00000001","to_account":"SWR-001-00000002","amount":"250.00","reference":"Payment"}'
```

---

## 8. Normal Operations

### Central Bank Portal

- URL: `http://100.72.112.29:5173`
- Login as `cbadmin` / `sworna-admin`
- Functions: **Mint SWR to banks**, view bank network, revoke/freeze accounts

> **CB only manages banks, not retail customers.** Issuing money goes to a bank's reserve wallet only.

### Bank Portal

- URL: `http://<BANK_IP>:5173`
- Login as `bankadmin` / `sworna-bank`
- Functions: Create customer accounts, deposit, withdraw, view transactions

### Customer Access

- Login with `username` / `password` created by bank admin
- Functions: View balance, transfer to other accounts (intra/inter-bank)

### Mint New SWR (CB Admin Only)

```bash
POST /api/v1/admin/mint
{
  "bank_code": "001",
  "amount": "50000.00",
  "reference": "Q4 liquidity injection"
}
```

### Create Customer Account (Bank Admin Only)

```bash
POST /api/v1/accounts
{
  "full_name": "Jane Doe",
  "username": "jane",
  "password": "secure123",
  "kyc_level": 3,
  "transfer_limit": 10000.00
}
```

### Inter-Bank Transfer

Transfers between Bank A and Bank B customers go through the token SDK automatically — the owner FSC node resolves the counterparty wallet using the `counterparty.node` field.

---

## 9. Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `failed obtaining auditor signature: timeout reached` | Owner FSC can't reach Auditor's P2P port (9001) | Check `extra_hosts` in `docker-compose.bank.net.yaml`; verify `100.72.112.29:9001` is reachable |
| `chaincode registration failed: timeout expired` | `peer0bankN_tokenchaincode_ccaas` container has wrong CHAINCODE_ID | Re-run `docker rm -f peer0bank1_tokenchaincode_ccaas` then recreate with the exact package ID from `peer lifecycle chaincode queryinstalled` |
| `currently defined sequence N is larger than requested sequence 1` | Trying to approve with wrong sequence number | Query `peer lifecycle chaincode querycommitted -C settlement -n tokenchaincode` to get current sequence, then approve with `--sequence N` |
| `Identity X is already registered` | `registerEnroll-bank.sh` run twice on same CA | Safe to ignore — register calls now have `|| true` (idempotent) |
| `communication service not ready` | FSC node bootstrapping (takes ~20s) | Wait and retry the request. Do NOT restart. |
| Backend returns `insufficient role` on transfer | Customer accounts need `customer` role in `payments/transfer` | Already fixed — `deps.customer` used in transfer endpoint |
| `no free wallets` | Wallet pool exhausted for a bank | Increase `POOL_SIZE` and redeploy the owner FSC node |
| `account not found` | Wrong account number or bank mismatch | Verify account exists at `GET /api/v1/accounts/{account_number}` |
| CB portal shows accounts, not banks | Legacy `to_account` endpoint used | Use `bank_code` field in mint request |
| Bank B deploy fails with path errors | `ORG_DIR` was relative in `registerEnroll-bank.sh` | Fixed — now uses `${PWD}/...` absolute path |
| Tailscale IP mismatch | Bank VM's Tailscale IP changed | Run `tailscale status` on CB to get current IPs; update `/etc/hosts` on all VMs |

### Log Locations

| Service | Log |
|---------|-----|
| Backend (all VMs) | `/tmp/sworna-backend.log` |
| Portal (all VMs) | `/tmp/sworna-web.log` |
| Owner FSC | `docker logs token-services-owner-1` |
| Auditor FSC | `docker logs token-services-auditor-1` |
| Issuer FSC | `docker logs token-services-issuer-1` |
| Fabric Peer | `docker logs peer0.bank1.sworna.example.com` |
| Token Chaincode | `docker logs peer0bank1_tokenchaincode_ccaas` |

### Key Debug Commands

```bash
# Check owner FSC balances
curl http://owner1.sworna.example.com:9200/api/v1/owner/accounts/pool_001_w1

# Check auditor logs for transaction status
docker logs token-services-auditor-1 2>&1 | strings | grep -E 'valid|committed|failed' | tail -20

# Check owner logs for transfer errors
docker logs token-services-owner-1 2>&1 | strings | grep -v DEBU | tail -30

# Verify chaincode is running on bank peer
docker inspect peer0bank1_tokenchaincode_ccaas | jq '.[0].Config.Env'
# CHAINCODE_ID must exactly match `peer lifecycle chaincode queryinstalled` output

# Network overrides inside owner container
docker exec token-services-owner-1 cat /etc/hosts
```

### CCAAS Container Package ID Mismatch (Most Common Issue)

When Bank A/B deploys chaincode, the CCAAS container must be started with the exact `CHAINCODE_ID` that matches what's installed on the peer:

```bash
# 1. Get the actual package ID
PEER_ENV docker exec peer0.bank1.sworna.example.com peer lifecycle chaincode queryinstalled

# 2. Stop old container
docker rm -f peer0bank1_tokenchaincode_ccaas

# 3. Start with exact ID
docker run --restart always -d --name peer0bank1_tokenchaincode_ccaas \
  --network fabric_test \
  -e CHAINCODE_SERVER_ADDRESS=0.0.0.0:9999 \
  -e CHAINCODE_ID=tokenchaincode_1:<EXACT_HASH> \
  -e CORE_CHAINCODE_ID_NAME=tokenchaincode_1:<EXACT_HASH> \
  tokenchaincode_ccaas_image:latest
```

---

## Appendix: Port Reference

| Service | Port | Protocol | Notes |
|---------|------|----------|-------|
| Fabric Orderer | 7050 | gRPC/TLS | CB VM only |
| Fabric Peer CB | 7051 | gRPC/TLS | CB VM only |
| Fabric Peer B1 | 9051 | gRPC/TLS | Bank A VM |
| Fabric Peer B2 | 11051 | gRPC/TLS | Bank B VM |
| Issuer FSC HTTP | 9100 | HTTP | CB VM |
| Issuer FSC P2P | 9101 | libp2p | CB VM |
| Auditor FSC HTTP | 9000 | HTTP | CB VM |
| Auditor FSC P2P | 9001 | libp2p | CB VM |
| Owner1 FSC HTTP | 9200 | HTTP | Bank A VM |
| Owner1 FSC P2P | 9201 | libp2p | Bank A VM |
| Owner2 FSC HTTP | 9300 | HTTP | Bank B VM |
| Owner2 FSC P2P | 9301 | libp2p | Bank B VM |
| Backend API | 8000 | HTTP | All VMs |
| Web Portal | 5173 | HTTP | All VMs |
| Token CA | 27054 | HTTPS | CB VM |
| Fabric CA (CB) | 7054 | HTTPS | CB VM |
| Fabric CA (B1) | 8054 | HTTPS | Bank A VM |
| Fabric CA (B2) | 9054 | HTTPS | Bank B VM |