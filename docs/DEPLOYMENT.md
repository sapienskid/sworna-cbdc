# DEPLOYMENT — Sworna CBDC Deployment Guide

This document outlines the deployment topology, roles, and operational procedures for Sworna CBDC, covering both the **Single-Node 5-Bank Sandbox** (for rapid evaluation and testing) and the **Distributed Production Architecture** (for real-world institutional multi-cloud deployment).

---

## 1. Deployment Models

```
┌───────────────────────────────────────────────────────────────────────────────────────┐
│ MODEL A: SINGLE-NODE 5-BANK SANDBOX (Development, Lab & Rapid Evaluation)             │
│ • Runs 1 Central Bank + 5 Commercial Banks on a single host or VM (16–32 GB RAM)      │
│ • Container bridge networking with internal DNS resolution                            │
│ • Zero SSH, zero Tailscale, zero /etc/hosts hacking                                   │
│ • Portals exposed on http://localhost:8000 (CB) and :8001–:8005 (Banks 001–005)      │
├───────────────────────────────────────────────────────────────────────────────────────┤
│ MODEL B: DISTRIBUTED PRODUCTION ARCHITECTURE (Institutional Real-World)               │
│ • Central Bank VPC: 4-Node SmartBFT Ordering Cluster, Token CA, Issuer, Auditor       │
│ • Commercial Bank VPCs (Banks 001..N): Autonomous Peers, Local Fabric CAs, FSC Engines│
│ • Interconnect: High-security IPsec VPN / dedicated financial extranet with mTLS      │
│ • Zero SSH access between institutions; API-driven pull-based admission pipeline       │
└───────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Institutional Roles & Separation

| Organization | Nodes & Services | Network Exposure | Key Custody |
|---|---|---|---|
| **Consensus Validators** | 4-Node SmartBFT Ordering Cluster (`orderer1..4`) | Port 7050 (mTLS only to peers) | Central Bank & Consortium HSM |
| **Central Bank** | CB Peer, Token CA, Issuer FSC, Auditor FSC, Admin Console | Ports 7051, 9000, 9100, 27054, 8000 | FIPS 140-2 Level 3 HSM |
| **Commercial Bank `k`** | Bank Peer (`peer0.bank{k}`), Local CA, Owner FSC (`owner{k}`), Core Banking Adapter | Ports 9051+2000(k-1), 9200+100(k-1), 8000 | Bank Internal HSM (never leaves Bank) |
| **Regulatory Auditor** | Auditor FSC (`:9000/:9001`) with selective de-anonymization | Port 9000 (REST), 9001 (P2P libp2p) | Regulatory Agency HSM |

---

## 3. Institutional Bank Admission Protocol (Production)

In production, banks are not provisioned via central SSH. The onboarding follows an **asynchronous 4-stage admission flow**:

### Step 1: Bank Submits Application (Autonomous Key Generation)
The commercial bank prepares its peer and local CA inside its own perimeter, generates its signing keys in an HSM, and submits its public organization definition:
```bash
curl -X POST https://centralbank.sworna.gov/api/v1/onboarding/apply \
  -H "Content-Type: application/json" \
  -d '{
    "legal_name": "Standard Chartered Demo Bank",
    "swift_bic": "SCBLUS33",
    "msp_id": "Bank003MSP",
    "endpoint": "peer0.bank003.sworna.example.com:13051",
    "ca_endpoint": "ca.bank003.sworna.example.com:10054",
    "public_msp_json": "<Base64_Encoded_Org_JSON>",
    "compliance_contact": "compliance@bank003.com"
  }'
```

### Step 2: Central Bank Compliance & Security Verification
The Central Bank automated verifier performs:
- License validation against the national banking register.
- TLS probing of the bank's endpoint (`peer0.bank003.sworna.example.com:13051`).
- Capital adequacy and reserve allocation validation.

### Step 3: Central Bank Board Dual-Approval (Four-Eyes Principle)
Two Central Bank executives sign the admission proposal using their hardware tokens:
1. **Monetary Policy Officer:** Approves reserve vault quota and interbank limits (`POST /api/v1/admin/onboarding/{id}/approve-monetary`).
2. **CISO:** Approves cryptographic MSP definition (`POST /api/v1/admin/onboarding/{id}/approve-security`).

### Step 4: Channel Delta & Autonomous Channel Join
1. Central Bank creates and signs the channel configuration update adding `Bank003MSP` to the `settlement` channel.
2. The ordering cluster commits the configuration block.
3. The bank receives an automated webhook with the channel update receipt.
4. The commercial bank executes `peer channel join` against the public orderer endpoint independently.

---

---

## 4. Single-Node & Multi-VM Operations with `sworna-cli`

All deployments are driven via the unified `sworna` CLI (`./bin/sworna` or `pip install -e ./cli`).

### Prerequisites:
- 16+ GB RAM, 4+ CPU cores.
- Docker Engine ≥ 26 with Docker Compose v2.
- Python 3.10+ (standard library only).

### Operations Workflow:

```bash
# 1. Central Bank initialization (Orderer, CB Peer, CCaaS, Issuer, Auditor, Backend, Portal)
./bin/sworna cb init --provision

# 2. Check Central Bank status
./bin/sworna cb status

# 3. Mint wholesale CBDC to a bank (e.g. 10,000 SWR to Bank 001)
./bin/sworna cb mint --bank 001 --amount 10000.0

# 4. Multi-VM Bank Onboarding (100% Dockerized 1-Step):
# On the Bank VM:
./bin/sworna bank join --code 001 --cb-host <CB_IP>
# Central Bank approves in 1 click via Portal (http://<CB_IP>:5273 -> Bank Management)

# 5. Automated End-to-End Verification (Mint, Interbank ZKP Transfer, Ledger Verification)
./bin/sworna test e2e
```

### Port Mapping Reference:

| Entity | Portal / UI | API Port | Fabric Peer | Owner FSC |
|---|---|---|---|---|
| **Central Bank** | `http://localhost:5273` | `:8100` | `:7051` | `:9100` (Issuer) / `:9000` (Auditor) |
| **Bank 001** | `http://localhost:5273/b/001` | `:8100` | `:9051` | `:9200` |
| **Bank 002** | `http://localhost:5273/b/002` | `:8100` | `:11051` | `:9300` |
| **Bank 003** | `http://localhost:5273/b/003` | `:8100` | `:13051` | `:9400` |
| **Bank 004** | `http://localhost:5273/b/004` | `:8100` | `:15051` | `:9500` |
| **Bank 005** | `http://localhost:5273/b/005` | `:8100` | `:17051` | `:9600` |

---

## 5. Security Hardening Checklist (Production Go-Live)

- [ ] **HSM Integration:** Bind all Fabric peer signing keys, Idemix issuer keys, and Auditor keys to PKCS#11 compliant Hardware Security Modules.
- [ ] **Engine mTLS:** Configure mutual TLS between FastAPI backend adapters and Go FSC owner/issuer/auditor engines (`:9000`, `:9100`, `:9200`).
- [ ] **Ordering Cluster:** Deploy a 4-node SmartBFT ordering cluster across at least 3 distinct availability zones or institutions.
- [ ] **PostgreSQL Cluster:** Migrate off-chain registries from local SQLite to high-availability clustered PostgreSQL with row-level locks.
- [ ] **Event-Driven Finality:** Configure backend block-event listeners to confirm transactions only after Fabric block commitment.
- [ ] **Session Security:** Enforce encrypted, HttpOnly, SameSite=Strict cookies with short-lived JWTs and Redis session blacklisting.
