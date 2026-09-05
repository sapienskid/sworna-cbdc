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

## 3. Network Topology & Computer Lab / Workshop Setup

| Node | Default Host | Role |
|------|-------------|------|
| `centralcbdc` | `100.72.112.29` | Central Bank — orderer, peer, token engine, backend, portal |
| `bank001` (Bank 001) | `100.x.y.z` or LAN | Commercial Bank A — peer, owner FSC, web portal |
| `bank002` (Bank 002) | `100.x.y.z` or LAN | Commercial Bank B — peer, owner FSC, web portal |

### Computer Lab & Workshop Networking (Zero Configuration)

In university computer labs and multi-machine workshops, campus Wi-Fi and managed Ethernet switches often restrict device-to-device communication (AP client isolation and 802.1X MAC filtering). To guarantee 100% reliable connectivity:

1. **VirtualBox NAT Mode (Recommended):**
   - Keep VirtualBox VMs in default **NAT** mode. Do **not** use "Bridged Adapter" over Wi-Fi, as the 802.11 protocol rejects multiple MAC addresses on a single Wi-Fi association.
2. **Tailscale Mesh with a Reusable Auth Key:**
   - Students **do not need to create individual Tailscale accounts**.
   - As the organizer, generate a single **Reusable Auth Key** from your [Tailscale Admin Console](https://login.tailscale.com/admin/settings/keys) (`tskey-auth-xxxx`).
   - On each student VM, joining the network is literally one command:
     ```bash
     curl -fsSL https://tailscale.com/install.sh | sh
     sudo tailscale up --authkey tskey-auth-xxxx
     ```
   - All VMs immediately join the encrypted mesh network and receive routable `100.x.y.z` IPs.

---

## 4. Central Bank Deployment

### Recommended: Unified CLI
Run on the Central Bank VM:
```bash
./bin/sworna cb init --provision
```

### Script Fallback:
```bash
./scripts/deploy-centralbank.sh --provision
```

This provisions entirely within Docker (`network_mode: host`):
- Fabric Orderer (`orderer.sworna.example.com:7050`)
- Central Bank Peer (`peer0.centralbank.sworna.example.com:7051`)
- Settlement Channel (`settlement`) with Token Chaincode sequence committed
- Token CA (Idemix Issuer CA on `:27054`)
- Issuer FSC Engine (`:9100` REST, `:9101` P2P)
- Auditor FSC Engine (`:9000` REST, `:9001` P2P)
- Central Bank Banking Backend (`sworna-cb-backend` container on `:8100`)
- Central Bank Web Portal (`sworna-cb-web` container on `:5273`)

Verify Central Bank services:
```bash
./bin/sworna cb status
```

---

## 5. Onboarding Commercial Banks (100% Dockerized)

### 5.0 The 1-Step Automated Join Flow (Recommended)

Commercial banks self-provision their Fabric org on their own VM and join the network via HTTP API and web portal admission.

**Step 1: On the Commercial Bank VM (e.g. Bank 001):**
```bash
./bin/sworna bank join --code 001 --cb-host <CB_HOST_IP>
```
*(Script fallback: `./scripts/bank-docker.sh up 001 <CB_HOST_IP>`)*

What happens automatically:
1. Enrolls local Bank CA and Peer TLS credentials (private keys stay on the bank VM).
2. Submits an onboarding application with public MSP definitions to the Central Bank API (`POST /api/v1/onboarding/apply`).
3. Polls the CB API waiting for administrative approval.

**Step 2: On the Central Bank Web Portal (`http://<CB_HOST_IP>:5273`):**
- Log in as `cbadmin` / `sworna-cb`.
- Navigate to **Bank Management**.
- Under **Pending Bank Admissions**, the incoming application from Bank 001 is displayed.
- Click **Approve & Admit to Network** (or enable auto-admission with `SWORNA_AUTO_ADMIT=1`).

**Step 3: Automated Completion:**
- The bank VM receives its admission status and streams its Idemix wallet credentials and Orderer TLS certificates via `GET /api/v1/onboarding/applications/{code}/credentials`.
- The bank joins the `settlement` channel, starts its local peer, runs the containerized FSC owner engine, and launches the commercial bank web portal at:
  ```
  http://<BANK_HOST_IP>:5173
  ```

---

### 5.1 Push Flow via SSH Script (Optional)

From the **central-bank host**, after `sworna cb init`:

```bash
./scripts/add-bank.sh 002 <BANK-VM-IP>     # remote bank, driven over SSH
./scripts/add-bank.sh 002                  # or all-in-one: bank on the CB VM
```

That single idempotent command performs the entire flow: registers the
bank in the CB registry, provisions its token wallets, syncs the repo to the
bank VM over SSH (`ssh-copy-id <user>@<ip>` first), runs the bank's identity phase, pulls back its org JSON, admits
the org to the channel (collecting co-signatures), joins the peer, starts the
owner engine, and commits the chaincode policy. Host IPs of all banks are recorded in `network/bank-hosts.env`.

The manual steps below remain as the reference for what the tooling automates.

### 5.1 Manual flow

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

---

## 7. Verification Checklist & Live Test Results

### Automated Verification via Unified CLI
```bash
./bin/sworna test e2e
```

### Live Verified Results (5-Bank Network Session Log)

| Step | Operation | Result | Details |
|------|-----------|--------|---------|
| 1 | **CB Wholesale Mint** | **CONFIRMED** | Minted 10,000 SWR to Bank 001 (`txid: 8fea91f9...`) and 5,000 SWR in automated E2E (`txid: 3c43360a...`) |
| 2 | **Customer Onboarding** | **CONFIRMED** | Onboarded Alice (`SWR-001-00000001`) and Bob (`SWR-002-00000001`) with Idemix wallet assignments |
| 3 | **Interbank ZKP Settlement (B1 → B2)** | **CONFIRMED** | Bank 001 sent 2,500 SWR to Bank 002 (`txid: 00fc85bd...`) verified by Auditor node |
| 4 | **Interbank ZKP Settlement (B2 → B5)** | **CONFIRMED** | Bank 002 sent 500 SWR to Bank 005 (`txid: 0f96759f...`) verified by Auditor node |
| 5 | **Customer Retail Payment (Alice → Bob)** | **CONFIRMED** | Alice (Bank 001) paid Bob (Bank 002) 100 SWR (`txid: f5399348...`) |
| 6 | **Customer Token Redemption (Bob)** | **CONFIRMED** | Bob redeemed 100 SWR (`txid: 3607ce2a...`) verified and burned by Auditor node |
| 7 | **Automated E2E Transfer (B1 → B3)** | **CONFIRMED** | Bank 001 sent 1,500 SWR to Bank 003 (`txid: 1c4726d1...`) via `./bin/sworna test e2e` |

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
| `/api/v1/payments/redeem` | `POST` | `bank_staff` | Burns tokens and redeems to fiat/cash |

---

## 9. Troubleshooting & Solved Issues

| Issue | Cause | Fix Applied |
|-------|-------|-------------|
| VirtualBox Bridged mode gets no IP on lab Wi-Fi | 802.11 Wi-Fi standard rejects multiple MAC addresses on single link; university AP isolation blocks DHCP | Revert VirtualBox to default **NAT** mode; connect machines via **Tailscale** using a Reusable Auth Key |
| Multi-VM Tailscale without individual accounts | Students don't have or want individual Tailscale accounts | Generate a single **Reusable Auth Key** from Tailscale Admin Console; join via `sudo tailscale up --authkey <KEY>` |
| Connecting single VM to multiple Tailscale accounts | Tailscale connects to 1 account at a time | Use Tailscale **Node Sharing** (Admin console $\rightarrow$ Share Machine link) or a shared Reusable Auth Key |
| `permission denied` on `token-services/keys/issuer` | Docker daemon auto-created root-owned directory during CA volume mount | Pre-created volume directories in `deploy-centralbank.sh` with non-root ownership and `chmod 777` fallback |
| Channel or anchor peer update failure on re-run (`already exists`) | Ledger state preserved across runs | Made `createChannel.sh`, `setAnchorPeer.sh`, and `deployCCAAS.sh` idempotent to tolerate existing channel and anchor states |
| ZKP Public Parameters mismatch (`invalid proof`) | Re-generated Idemix CA produced fresh issuer key hash differing from checked-in `zkatdlog_pp.json` | Compiled native `tokengen` from Fabric Token-SDK v0.3.0, generated fresh public parameters, committed chaincode sequence on-chain |
| Chaincode upgrade error: `already initialized but called as init` | Fabric v2/v3 rejects `--isInit` on already initialized chaincode definitions | Upgraded chaincode definition, then invoked regular `init` transaction without `--isInit` flag |
| `failed getting recipient identity: all dials failed` | FSC announced local loopback IP instead of routable container network | Configured container DNS overrides and bridge network routing in `scripts/gen-net-overrides.py` |
| `sufficient but partially locked funds` | In-flight transaction temporarily locked UTXO inputs | Waited for ledger commit (~8-10s) for token collector to release change outputs; increased client timeout to 120s |

---

## 10. Port Reference

| Service | Port | Protocol | Scope |
|---------|------|----------|-------|
| Fabric Orderer | 7050 | gRPC/TLS | Central Bank |
| Fabric Peer CB | 7051 | gRPC/TLS | Central Bank |
| Fabric Peers (Bank 1..5) | 9051, 11051, 13051, 15051, 17051 | gRPC/TLS | Commercial Banks 001–005 |
| Token CA (Idemix Issuer) | 27054 | HTTP | Central Bank |
| Issuer FSC HTTP / P2P | 9100 / 9101 | HTTP / libp2p | Central Bank |
| Auditor FSC HTTP / P2P | 9000 / 9001 | HTTP / libp2p | Central Bank |
| Owner 1 FSC HTTP / P2P | 9200 / 9201 | HTTP / libp2p | Bank 001 |
| Owner 2 FSC HTTP / P2P | 9300 / 9301 | HTTP / libp2p | Bank 002 |
| Owner 3 FSC HTTP / P2P | 9400 / 9401 | HTTP / libp2p | Bank 003 |
| Owner 4 FSC HTTP / P2P | 9500 / 9501 | HTTP / libp2p | Bank 004 |
| Owner 5 FSC HTTP / P2P | 9600 / 9601 | HTTP / libp2p | Bank 005 |
| Central Bank Backend API | 8100 | HTTP | Central Bank (`sworna-cb-backend`) |
| Central Bank Web Portal | 5273 | HTTP | Central Bank (`sworna-cb-web`) |
| Commercial Bank Web Portal | 5173 | HTTP | Commercial Bank (`sworna-bank-web-00k`) |