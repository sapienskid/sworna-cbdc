# ARCHITECTURE — Sworna CBDC Production Design

This document describes the architectural design of the Sworna CBDC platform. It reflects the decisions locked in the ADRs (see [docs/ADRs](ADRs/)) and the research in [REFERENCES.md](REFERENCES.md) (cited inline as `[R#]`).

Deeper as-built documentation lives in the topic deep dives:
- [BLIND-SIGNATURES-AND-PRIVACY.md](BLIND-SIGNATURES-AND-PRIVACY.md) (the ZK/blind-signature layer),
- [AML-COMPLIANCE.md](AML-COMPLIANCE.md) (off-chain rule engine),
- [BACKEND-INTERNALS.md](BACKEND-INTERNALS.md) (FastAPI walk-through),
- [SECURITY-MODEL.md](SECURITY-MODEL.md) (trust + auth + HSM), and
- [FRONTEND.md](FRONTEND.md) (the React portals).

---

## 1. Design Goals

1. **Two-Tier Sovereign CBDC Model**: Central bank issues wholesale SWR tokens to regulated commercial banks; commercial banks distribute retail SWR to customers. Interbank wholesale settlement runs on the same ledger — mirroring the architecture validated by **Project Agila** [R18][R19] and global standards (Project Hamilton, mBridge).
2. **Three Distinct Sovereign Systems**: Formal architectural separation between:
   - **Commercial Banks** (autonomous peers, local CAs, Go FSC engines, customer accounts);
   - **Regulatory Auditors** (ZK proof inspection, mandatory co-signing for finality, selective de-anonymization);
   - **Validator Nodes** (consortium-operated 4-node Byzantine Fault Tolerant consensus cluster).
3. **Privacy by Default with Regulatory Oversight**: On-ledger amounts and parties are shielded using Pedersen commitments and Idemix blind signatures, while authorized regulatory auditors retain selective de-anonymization capabilities via private audit opening keys (ADR-0004, ADR-0006) [R13].
4. **Institutional Admission Control**: No commercial bank joins automatically. Admission requires an asynchronous, 4-stage pipeline (Application -> Verification -> Dual-Control Approval -> On-Chain Channel Delta) with zero SSH or server-level access between participants.
5. **Scale to Hundreds of Banks**: Decoupled chaincode endorsement policies and dynamic P2P discovery eliminate the need for chaincode recompilation, sequence bumping, or network downtime when new banks onboard.

---

## 2. CBDC Monetary Model

- **Distribution: Two-Tier Hybrid (ADR-0008)**
  - **Tier 1 (Wholesale):** The Central Bank transacts *only* with regulated commercial banks (`Bank{k}MSP`). Wholesale currency is issued into commercial bank reserve vaults (`RESERVE-{k}`). The Central Bank does not manage retail citizen accounts.
  - **Tier 2 (Retail):** Commercial banks maintain retail customer accounts, enforce customer-level KYC/AML, and hold customer Idemix wallet keys on their owner nodes. Customers transact intra-bank or cross-bank through their commercial banks.
- **Money Representation: Token-Based UTXO (ADR-0006)**
  - Currency exists as individual spendable cryptographic tokens with change-splitting ($1000 	ext{ SWR} 	o 100 	ext{ to recipient} + 900 	ext{ change to sender}$).
  - Balances are derived dynamically from unspent transaction outputs owned by an Idemix credential.
- **Privacy Primitives: Zero-Knowledge Proofs (zkatdlog)**
  - **Pedersen Commitments:** Amounts $v$ are hidden on-ledger using homomorphic commitments $C = g_0^{H(	ext{SWR})} \cdot g_1^v \cdot g_2^r$ where $r$ is a blinding factor. Peers verify $\sum C_{	ext{in}} = \sum C_{	ext{out}}$ without learning $v$.
  - **ZKAT-DLOG Range Proofs:** Senders generate zero-knowledge range proofs proving $v \ge 0$ (preventing negative money creation) and proving spending rights without revealing persistent identity keys.
  - **Idemix Anonymity:** Account identities on-chain are one-time pseudonyms (nyms) derived from Camenisch-Lysyanskaya (CL) blind signatures over the `BN254` pairing curve.

---

## 3. The Three Operating Subsystems & Identities

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ 1. VALIDATOR / CONSENSUS SYSTEM (Consortium-Operated)                                  │
│    • 4-Node SmartBFT Ordering Cluster (BFT Consensus, tolerates 1 Byzantine fault)     │
│    • Operated by Central Bank (2 nodes), National Clearing House, Ministry of Finance  │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ 2. REGULATORY AUDITOR SYSTEM (Supervision & Compliance)                                │
│    • ZK Audit Gate (`token-services/auditor/service/audit.go`)                          │
│    • Mandatory Co-Signature for Transaction Finality                                   │
│    • Selective De-anonymization Opening (`token-services/auditor/service/history.go`)   │
│    • Multi-Agency Quorum (Central Bank + FIU / Tax Authority)                          │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ 3. COMMERCIAL BANK SYSTEM (Operational & Core Banking)                                 │
│    • Autonomous Fabric Peer & Local Fabric CA per bank (Bank private keys stay in HSM) │
│    • Go FSC Owner Node (`owner{k}`) managing customer UTXOs                            │
│    • FastAPI Banking Backend with AML gates, limits, and watchlist screening           │
│    • Core-Banking Adapter (ISO 20022 `pacs.008` / `camt.053`)                          │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

| Subsystem | Organization | Fabric MSP | Node / Service | Cryptographic Role |
|---|---|---|---|---|
| **Consensus Validators** | Central Bank & Clearing House | `OrdererMSP` | 4 SmartBFT Orderers (:7050) | Block ordering, consensus finality, BFT agreement |
| **Regulatory Auditor** | Central Bank / Regulatory Consortium | `AuditorMSP` | Auditor FSC (:9000/:9001) | ZK proof validation, mandatory co-signing, audit opening |
| **Currency Issuer** | Central Bank | `CentralBankMSP` | Issuer FSC (:9100/:9101) | Wholesale minting and redemption |
| **Commercial Bank `k`** | Commercial Bank `k` | `Bank{k}MSP` | Peer (:9051) + Owner FSC (:9200) | Peer validation, UTXO management, customer signing |
| **Retail Customers** | Custodied on Bank `k` | — | Web/Mobile Wallet | Idemix blind credentials, one-time pseudonyms |

---

## 4. Component Inventory

### 4.1 Layer 1 — Fabric Settlement & Consensus Network
- **Ordering Cluster:** 4-node SmartBFT consensus cluster operating with Fabric v3.1 BFT capability [R1][R2].
- **Peers:** Validating and committing peers for the Central Bank and each onboarded Commercial Bank (`peer0.bank{k}`). Peers maintain identical, immutable copies of the ledger.
- **Token Chaincode (CCAAS):** Deployed as Chaincode-as-a-Service on the `settlement` channel; verifies zero-knowledge proofs, Pedersen commitments, and the auditor's co-signature.

### 4.2 Layer 2 — Token Services (Go FSC Engine)
- **Issuer Node:** Mints tokens into commercial bank reserve vaults; records wholesale issuance history.
- **Auditor Node:** Validates transaction proofs, decrypts metadata for compliance checks, and provides the cryptographic co-signature required for block commit.
- **Owner Nodes (one per bank):** Manage customer wallet credentials, negotiate recipient one-time pseudonyms over libp2p, assemble transactions with ZK proofs, and submit to the network.

### 4.3 Off-Chain Banking & Integration Layer
- **Banking Backend (FastAPI):** Customer onboarding, account management, daily transfer limits, watchlist screening, and payment orchestration.
- **Database:** Clustered PostgreSQL with row-level locking (upgraded from dev SQLite) and asynchronous Fabric block-event finality confirmation.
- **Portals (React + Vite):**
  - Central Bank Console (`:5173`): Monetary supply dashboard, reserve management, bank admission approval, and ledger inspection.
  - Commercial Bank Portals (`:5173` or `:8001+`): Customer account onboarding, retail deposits, interbank transfers, and compliance alerts.

---

## 5. Institutional Admission & Verification Architecture

In production, banks cannot be added via direct SSH pushes. The architecture enforces an **asynchronous 4-stage admission gateway**:

```
[Commercial Bank]
       │
       ▼ (1) POST /api/v1/onboarding/apply (Public MSP JSON, Endpoints, Legal BIC)
[Central Bank Admission API]
       │
       ▼ (2) Regulatory Due Diligence + Automated Network Probe
[Verification Engine]
       │
       ▼ (3) Dual-Control Approval (Four-Eyes Principle: Monetary Officer + CISO)
[Central Bank Board]
       │
       ▼ (4) Compute & Sign Channel Delta Config Block
[SmartBFT Ordering Cluster]
       │
       ▼ (5) Webhook / Block Event Notification
[Commercial Bank Peer] ──► Executes `peer channel join` independently
```

### Emergency Circuit Breakers (Kill Switch):
1. **Application Router Gate:** The Central Bank marks a bank `SUSPENDED`; the backend API immediately rejects any payment routing involving that bank.
2. **Auditor Cryptographic Gate:** The Auditor node refuses to co-sign any transaction bearing the suspended bank's MSP ID, halting on-chain movement.
3. **Channel Expulsion:** The Central Bank issues a channel configuration update removing the bank's MSP from the channel.

---

## 6. Scalability: Decoupled Endorsement for 100+ Banks

In the original prototype, adding a bank required updating the chaincode endorsement policy to include the new bank (`OR('CentralBankMSP', ..., 'BankNMSP')`), requiring network-wide approvals and sequence bumps.

In the production architecture:
1. **Role-Based Endorsement Policy:**
   $$\text{AND}('CentralBankMSP.peer', 'AuditorMSP.peer') \quad \text{or} \quad \text{MAJORITY('Application.peer')}$$
2. **Dynamic P2P Discovery:**
   FSC owner nodes discover counterparties dynamically over libp2p using on-chain endpoint registrations rather than static configuration files (`core.yaml.tpl`).
3. **Zero Downtime Onboarding:**
   The $N$-th commercial bank joins the channel via standard channel configuration delta. The chaincode definition remains unchanged, and existing banks experience **zero downtime and zero restarts**.

---

## 7. Security Architecture Matrix

| Domain | Prototype Status | Production Architecture |
|---|---|---|
| **Key Custody** | Plaintext files on disk (`token-services/keys/`). | **Hardware Security Modules (HSM):** FIPS 140-2/3 Level 3 via PKCS#11 for all root, bank, and auditor keys. |
| **Engine REST** | Unauthenticated HTTP on ports 9000, 9100, 9200. | **Strict Mutual TLS (mTLS) + Zero-Trust Network Policy:** Internal microservice access only. |
| **Session Auth** | JWT in browser `localStorage`. | **HttpOnly, SameSite=Strict, Encrypted Cookies** with Redis session revocation. |
| **Ledger Finality** | Optimistic "Confirmed" log on submit. | **Block Event Listeners:** Transactions remain `PENDING` until a Fabric block event confirms commit. |
| **AML Screening** | Python substring search. | **Real-Time Fuzzy Matching (Jaro-Winkler)** with live OFAC/UN sanctions XML feeds. |

---

## 8. Deployment Targets

- **Target A: Single-Node 5-Bank Sandbox (`compose-sandbox-5banks.yaml`):**
  A self-contained Docker Compose stack for development, demonstration, and automated CI testing. Runs 1 Central Bank + 5 Commercial Banks with distinct internal ports, isolated networks, and pre-seeded wallets. Zero Tailscale, zero SSH, zero manual configuration.
- **Target B: Distributed Production Multi-Host Package:**
  Multi-cloud / multi-datacenter deployment managed via Terraform and Ansible. Encrypted IPsec / leased-line interconnects, external PostgreSQL databases, and HSM key protection.
