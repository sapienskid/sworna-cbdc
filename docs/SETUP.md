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
7. [Verification Checklist & Live Test Results](#7-verification-checklist--live-test-results)
8. [Normal Operations](#8-normal-operations)
9. [Troubleshooting & Solved Issues](#9-troubleshooting--solved-issues)
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

- **CB manages banks only** — mints/burns wholesale SWR into bank reserve vaults (`pool_00k_w1`); never touches retail customer accounts directly.
- **Banks manage customers** — disburse from reserve vault (`deposit`), withdraw (`redeem`), and facilitate P2P transfers.
- **Zero-knowledge transfers** — Idemix (Token-SDK) hides token amounts/owners; auditor validates ZK proofs without learning participant identities.
- **Every transfer** is endorsed by the relevant peers, ordered by the CB orderer, and committed to the distributed ledger.

### Token Lifecycle Flow

```
Central Bank --[POST /api/v1/admin/mint]--> Bank Reserve Vault (pool_00k_w1)
                                                    │
                                         [POST /api/v1/bank/deposit]
                                                    │
                                                    ▼
                                          Customer Wallet (pool_00k_w2)
                                                    │
                                   [POST /api/v1/payments/transfer]
                                        (Intra or Inter-bank P2P)
                                                    │
                                                    ▼
                                     Counterparty Customer Wallet (pool_00j_w2)
```

---

## 2. Prerequisites

**All VMs:**
- Ubuntu 22.04+ LTS, 4+ GB RAM (8 GB for CB)
- Docker Engine ≥ 26, Compose v2 (`docker compose` — never `docker-compose`)
- Tailscale installed and connected to the mesh network
- Git, Python 3.10+, Node.js 18+, `jq`

**Clone the repository:**
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

---

## 4. Central Bank Deployment

Run **once** on the CB VM:

```bash
cd ~/sworna-cbdc
./scripts/deploy-centralbank.sh --provision
```

This provisions: orderer, CB peer, `settlement` channel, token CA, Issuer FSC, Auditor FSC, backend API, and CB portal.

---

## 5. Onboarding Commercial Banks (Multi-Org Flow)

When adding a new bank org to a channel with existing members, Fabric requires **majority admin signatures** (`2-of-2`, `2-of-3`, etc.):

1. **New Bank VM generates org identity:**
   ```bash
   BANK_CODE=002 ./scripts/bank-network.sh identity
   # Exports network/bank2-org.json
   ```
2. **CB VM initiates channel config update & collects co-signatures:**
   ```bash
   # CB creates and signs update_envelope.pb
   ./scripts/onboard-bank.sh Bank2MSP network/bank2-org.json
   # Existing bank admins co-sign update_envelope.pb via peer channel signconfigtx
   # CB submits co-signed envelope to orderer
   ```
3. **CB exports join bundle:**
   ```bash
   ./scripts/export-join-bundles.sh
   # Packs Idemix wallet keys into dist-bank-bundles/bank002.tar.gz
   scp dist-bank-bundles/bank002.tar.gz bankpp@100.71.149.60:~/sworna-cbdc/
   ```
4. **New Bank VM joins channel & installs chaincode:**
   ```bash
   tar xzf bank002.tar.gz
   BANK_CODE=002 SWORNA_CB_HOST=100.72.112.29 ./scripts/bank-network.sh join
   ```
5. **All Orgs approve chaincode & CB commits:**
   ```bash
   ./scripts/commit-chaincode.sh
   # Endorsement policy: OR('CentralBankMSP.peer','Bank1MSP.peer','Bank2MSP.peer')
   ```

---

## 6. Deploying a Commercial Bank

### Systemd Backend Service (`/etc/systemd/system/sworna-backend.service`)

```ini
[Unit]
Description=Sworna CBDC Banking Backend
After=network.target

[Service]
Type=simple
User=bankpp
WorkingDirectory=/home/bankpp/sworna-cbdc/backend
Environment=PATH=/home/bankpp/sworna-cbdc/backend/.venv/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=/home/bankpp/sworna-cbdc/backend/.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

---

## 7. Verification Checklist & Live Test Results

### ✅ Live Verified Results (Session Log)

| Step | Operation | Result | Details |
|------|-----------|--------|---------|
| 1 | **CB Wholesale Mint** | **CONFIRMED** | Minted 25,000 SWR to Bank B Reserve (`txid: ae771171...`) |
| 2 | **Bank B Deposit** | **CONFIRMED** | Deposited 5,000 SWR from Reserve to Charlie (`txid: 8fb3de43...`) |
| 3 | **Alice → Charlie Transfer** | **CONFIRMED** | Alice (Bank A) sent 200 SWR to Charlie (Bank B) (`Block #43`, `txid: ea385293...`) |
| 4 | **Alice → Charlie Transfer** | **CONFIRMED** | Alice sent 50 SWR to Charlie in 8s (`txid: 2ad6803d...`) |
| 5 | **Charlie → Alice Return** | **CONFIRMED** | Charlie (Bank B) sent 100 SWR back to Alice (Bank A) in 8s (`txid: f9a11dd9...`) |

### Final Verified Balances

- **Alice (Bank A, `SWR-001-00000001`):** `1,100.00 SWR`
- **Charlie (Bank B, `SWR-002-00000001`):** `5,150.00 SWR`
- **Bank B Reserve Vault (`RESERVE-002`):** `20,000.00 SWR`

---

## 8. Normal Operations

### API Endpoints

| Endpoint | Method | Role | Description |
|----------|--------|------|-------------|
| `/api/v1/auth/login` | `POST` | Public | Authenticates user, returns JWT |
| `/api/v1/admin/mint` | `POST` | `cb_admin` | Mints wholesale SWR to a bank reserve vault |
| `/api/v1/bank/reserve` | `GET` | `bank_admin` | Queries bank reserve vault balance |
| `/api/v1/bank/deposit` | `POST` | `bank_admin` | Transfers SWR from reserve to customer wallet |
| `/api/v1/accounts` | `POST` | `bank_admin` | Onboards customer, assigns wallet from pool |
| `/api/v1/accounts/{acct}/balance` | `GET` | `customer` | Returns on-chain ZK token balance |
| `/api/v1/payments/transfer` | `POST` | `customer` | Executes intra or inter-bank P2P transfer |

---

## 9. Troubleshooting & Solved Issues

| Issue | Cause | Fix Applied |
|-------|-------|-------------|
| Multi-org channel update rejection | Fabric requires majority signatures (`2-of-2`) | Added multi-org co-signing relay flow to `onboard-bank.sh` |
| `reading from file /var/fsc/keys/owner1/fsc/.../cert.pem failed` | Sibling bank public cert missing on new bank node | Export join bundle with all sibling public certs |
| `failed getting recipient identity from owner2: all dials failed` | FSC announced local container IP instead of Tailscale IP | Configured `fsc.p2p.listenAddress: /ip4/<TAILSCALE_IP>/tcp/<PORT>` |
| `account not found` on interbank transfer | Local DB only stored local accounts | Added `InterbankAccount` virtual resolution in `payments.py` |
| `sufficient but partially locked funds` | In-flight timeout held in-memory UTXO lock | Restarted owner container to release locks; increased timeout to 120s |

---

## 10. Port Reference

| Service | Port | Protocol | VM |
|---------|------|----------|----|
| Fabric Orderer | 7050 | gRPC/TLS | Central Bank |
| Fabric Peer CB | 7051 | gRPC/TLS | Central Bank |
| Fabric Peer Bank A | 9051 | gRPC/TLS | Bank A |
| Fabric Peer Bank B | 11051 | gRPC/TLS | Bank B |
| Issuer FSC HTTP / P2P | 9100 / 9101 | HTTP / libp2p | Central Bank |
| Auditor FSC HTTP / P2P | 9000 / 9001 | HTTP / libp2p | Central Bank |
| Owner1 FSC HTTP / P2P | 9200 / 9201 | HTTP / libp2p | Bank A |
| Owner2 FSC HTTP / P2P | 9300 / 9301 | HTTP / libp2p | Bank B |
| Backend API | 8000 | HTTP | All VMs |
| Web Portal | 5173 | HTTP | All VMs |